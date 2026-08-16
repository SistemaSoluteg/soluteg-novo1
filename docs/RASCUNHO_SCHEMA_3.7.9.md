# Rascunho de design — sub-fase 3.7.9 (notificações por tenant)

**Criado em:** 16/08/2026
**Status:** 📝 RASCUNHO EM PAPEL — nada aqui foi aplicado no banco nem commitado como código de runtime. Serve para revisão do desenho antes de a 3.7.9 começar (que só entra **depois** da 3.7.2 fechar).
**Base:** o levantamento em [`INVENTARIO_NOTIFICACOES_3.7.9.md`](./INVENTARIO_NOTIFICACOES_3.7.9.md) e as convenções reais de [`drizzle/schema.ts`](../drizzle/schema.ts) (`tenants`, `pushSubscriptions`, `notificationLogs`).

> ⚠️ Não aplicar. Números de coluna, nomes e tipos ainda estão sujeitos à revisão do Thiago (e do irmão arquiteto). O objetivo é ter o esqueleto pronto para discutir, não código final.

---

## 1. Tabela `tenantNotificationSettings` (3.7.9a) — 1:1 com `tenants`

Config de **envio** por tenant. Separada da tabela `tenants` de propósito: `tenants.whatsappNumber`/`contactEmail` são **identidade/exibição** (aparecem em rodapé, PDF); esta tabela é **infra de transporte** (credenciais, com segredos criptografados). Misturar as duas vazaria segredo em toda leitura de `tenants`.

```ts
export const tenantNotificationSettings = mysqlTable("tenantNotificationSettings", {
  id:                 int("id").autoincrement().primaryKey(),

  // 1:1 com tenants — UNIQUE embaixo garante um registro por tenant. Sem CASCADE.
  tenantId:           int("tenantId").notNull().references(() => tenants.id),

  // ── WhatsApp ──────────────────────────────────────────────────────────────
  // 0 = tenant não usa WhatsApp (nenhuma instância wwebjs é inicializada pra ele)
  whatsappEnabled:    tinyint("whatsappEnabled").notNull().default(0),
  // Substitui o número hardcoded 5513981301010 (destino "admin" do tenant)
  whatsappAdminNumber: varchar("whatsappAdminNumber", { length: 30 }),
  // Seam para a migração futura wwebjs → Cloud API, por tenant
  whatsappProvider:   mysqlEnum("whatsappProvider", ["wwebjs", "cloud-api"]).notNull().default("wwebjs"),

  // ── Email / SMTP ──────────────────────────────────────────────────────────
  emailEnabled:       tinyint("emailEnabled").notNull().default(0),
  smtpHost:           varchar("smtpHost", { length: 200 }),
  smtpPort:           int("smtpPort").default(587),
  smtpUser:           varchar("smtpUser", { length: 200 }),
  // ⚠️ CRIPTOGRAFADO AT-REST. Nunca retornado em leitura (ver §3). Guarda "iv:tag:ciphertext".
  smtpPassEncrypted:  text("smtpPassEncrypted"),
  emailFrom:          varchar("emailFrom", { length: 200 }),
  // Destinatário(s) dos alertas de admin. CSV simples ou 1 email; decidir na impl.
  emailToAdmin:       varchar("emailToAdmin", { length: 500 }),

  active:             tinyint("active").notNull().default(1),
  createdAt:          timestamp("createdAt").defaultNow().notNull(),
  updatedAt:          timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  // 1:1 — um registro de config por tenant
  uniqueIndex("uq_tenantNotifSettings_tenant").on(t.tenantId),
]);

export type TenantNotificationSettings = typeof tenantNotificationSettings.$inferSelect;
export type InsertTenantNotificationSettings = typeof tenantNotificationSettings.$inferInsert;
```

**Decisões em aberto pra discutir:**
- `emailToAdmin` como CSV vs. tabela filha de destinatários. CSV é mais simples e cobre o caso atual (1 admin). Recomendo CSV por ora — YAGNI.
- Só a senha SMTP é segredo hoje. Se a Cloud API entrar depois, o **token da Meta** também será segredo → talvez um `whatsappCredEncrypted` genérico no futuro. Não criar agora (seam já resolvido pelo enum `whatsappProvider`).

---

## 2. Tabela `messageTemplates` (3.7.9c)

Um registro por (tenant, evento, canal). Se o tenant não editou, **não há registro** e o renderizador cai no default hardcoded do Soluteg (fallback — ver §4).

```ts
export const messageTemplates = mysqlTable("messageTemplates", {
  id:        int("id").autoincrement().primaryKey(),
  tenantId:  int("tenantId").notNull().references(() => tenants.id),

  // Evento — as keys enumeradas no INVENTARIO (ex: "os.created", "water_tank.alarm1")
  templateKey: varchar("templateKey", { length: 60 }).notNull(),
  channel:     mysqlEnum("channel", ["whatsapp", "email"]).notNull(),

  // subject só se aplica a email; whatsapp ignora (fica NULL)
  subject:   varchar("subject", { length: 300 }),
  // corpo com placeholders {{campo}} whitelistados por template
  body:      text("body").notNull(),

  // 0 = tenant desativou este template específico → cai no default
  active:    tinyint("active").notNull().default(1),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  // Um template por (tenant, evento, canal)
  uniqueIndex("uq_msgTemplate_tenant_key_channel").on(t.tenantId, t.templateKey, t.channel),
  // Lookup no envio: "template do tenant X pra evento Y no canal Z"
  index("idx_msgTemplate_lookup").on(t.tenantId, t.templateKey),
]);

export type MessageTemplate = typeof messageTemplates.$inferSelect;
export type InsertMessageTemplate = typeof messageTemplates.$inferInsert;
```

**Decisão-chave:** o **default NÃO fica no banco** como registro do tenant. Os textos default (Soluteg) vivem em código (constante), e a tabela guarda só o que o tenant **sobrescreveu**. Vantagens: (1) atualizar um default beneficia todos sem migração; (2) tenant novo já funciona com zero linhas nesta tabela. Alternativa descartada: seed de defaults por tenant — cria N cópias e trava a evolução do texto padrão.

**A whitelist de placeholders por template** fica em código (mapa `templateKey → campos permitidos`), não no banco — é regra de validação, não dado editável. Fonte: seção 5 do INVENTARIO.

---

## 3. Criptografia dos segredos SMTP (3.7.9a)

- **Chave** em env (ex: `NOTIF_SECRET_KEY`, 32 bytes) — nunca no banco. Rotação = re-encriptar todos os registros (raro, script à parte).
- **Algoritmo:** AES-256-GCM (`node:crypto`). Guardar `iv:authTag:ciphertext` (hex/base64) no `smtpPassEncrypted`.
- **Na leitura (tRPC pro front):** a senha **nunca** volta. O endpoint de config retorna `smtpPassSet: boolean` (tem ou não tem senha), nunca o valor. Editar = enviar senha nova; deixar em branco = manter a atual.
- Helper isolado: `server/lib/secretBox.ts` com `encryptSecret(plain)` / `decryptSecret(stored)`. Só o `emailService` (no envio) chama `decryptSecret`.

---

## 4. Interface `WhatsappProvider` (3.7.9b)

O seam central. Uma interface, duas implementações (uma real agora, uma stub), e um manager que mantém uma instância por tenant.

```ts
// server/lib/whatsapp/WhatsappProvider.ts
export interface WhatsappStatus {
  isReady: boolean;
  qrCodeDataUrl: string | null; // QR pra parear, quando desconectado
}

export interface WhatsappProvider {
  /** Inicializa a sessão (lazy — chamado pelo manager só pra tenant ativo). */
  init(): Promise<void>;
  /** Envia texto puro pra um número E.164 (sem @c.us — o provider normaliza). */
  sendText(phone: string, message: string): Promise<void>;
  /** Envia PDF com legenda. */
  sendPdf(phone: string, message: string, pdf: Buffer, filename: string): Promise<void>;
  /** Status atual (pro painel do tenant: conectado? QR pendente?). */
  getStatus(): WhatsappStatus;
  /** Reconecta manualmente (botão no painel). */
  reconnect(): Promise<void>;
  /** Encerra a sessão e libera o Chromium (ao desativar o tenant). */
  destroy(): Promise<void>;
}
```

### Implementação real: `WwebjsProvider`
- Encapsula **o que hoje está solto em `whatsapp.ts`**: um `Client` com `LocalAuth({ dataPath: './sessions/tenant-${tenantId}' })`, os handlers de `qr`/`ready`/`disconnected`, o `handleInitError` (browser já rodando), o `triggerReconnect` (detached Frame) e a normalização de número (`getNumberId`, formato com/sem 9).
- Ou seja: **o `whatsapp.ts` atual vira essencialmente uma instância desta classe** — pouca lógica nova, muito recorte-e-cole com `this.client` no lugar do `client` global.

### Stub (seam): `CloudApiProvider`
- Implementa a interface lançando `NotImplementedError` em `sendText`/`sendPdf`. Existe só para provar que a troca `wwebjs → cloud-api` é uma implementação nova, sem tocar nos call sites. Não implementado na 3.7.9.

### Manager: `WhatsappManager`
```ts
// server/lib/whatsapp/WhatsappManager.ts
class WhatsappManager {
  private providers = new Map<number, WhatsappProvider>(); // tenantId → provider

  /** No boot: inicializa só tenants ativos com whatsappEnabled=1. */
  async initActiveTenants(): Promise<void> { /* … */ }

  /** Resolve (e cria lazy) o provider do tenant, escolhendo pela coluna whatsappProvider. */
  private get(tenantId: number): WhatsappProvider { /* wwebjs | cloud-api */ }

  async sendText(tenantId: number, phone: string, msg: string): Promise<void> {
    return this.get(tenantId).sendText(phone, msg);
  }
  // sendPdf, getStatus(tenantId), reconnect(tenantId)…
}
export const whatsappManager = new WhatsappManager();
```

**Política de RAM (do ROADMAP §3.7.9):** init **só** de tenant ativo com `whatsappEnabled=1`. Cada Chromium ≈ 300–500MB → monitorar no VPS ao crescer. Hoje só a JNC pareia de fato.

### Como os call sites mudam (depois da 3.7.2)
As 4 funções livres de `whatsapp.ts` viram métodos do manager, recebendo `tenantId`:

| Hoje | Depois |
|------|--------|
| `sendWhatsappAlert(msg)` | `whatsappManager.sendText(tenantId, tenant.whatsappAdminNumber, msg)` |
| `sendWhatsappAlertWithPDF(msg, pdf, f)` | `whatsappManager.sendPdf(tenantId, tenant.whatsappAdminNumber, msg, pdf, f)` |
| `sendWhatsappToNumber(phone, msg)` | `whatsappManager.sendText(tenantId, phone, msg)` |
| `sendWhatsappToNumberWithPDF(...)` | `whatsappManager.sendPdf(tenantId, phone, ...)` |

`tenantId` vem de `ctx.tenantId` nos routers e do `tenantId` do registro (sensor/OS) nos jobs/serviços — já disponível desde a fundação da 3.7.2.

---

## 5. Migração da JNC (tenant 1) — não pode quebrar

1. Inserir 1 linha em `tenantNotificationSettings` pro tenant 1: `whatsappEnabled=1`, `whatsappAdminNumber='5513981301010'`, `whatsappProvider='wwebjs'`, SMTP copiado do `.env` atual (criptografando a senha).
2. Sessão `./sessions` atual → mover para `./sessions/tenant-1` (ou re-scan do QR no primeiro boot).
3. `messageTemplates` do tenant 1 fica **vazia** — a JNC roda nos defaults (que são exatamente os textos atuais). Só cria linha se/quando editar.
4. Validar: alarme de caixa, OS criada, orçamento — todos idênticos ao de hoje.

---

## 6. Ordem de implementação sugerida (quando a 3.7.9 começar)

1. **3.7.9a** — tabelas + `secretBox.ts` + endpoints de config (com máscara na leitura). Sem tocar no envio ainda.
2. **3.7.9b** — extrair `WwebjsProvider` do `whatsapp.ts` + `WhatsappManager`; rewire dos ~15 call sites com `tenantId`; migração da JNC. **Aqui é onde o risco mora** (mexe no envio vivo).
3. **3.7.9c** — extrair os textos pra defaults em código + renderizador com whitelist + fallback; tabela `messageTemplates` + editor no painel.

Cada passo é deployável e reversível isoladamente. O 3.7.9b é o único que toca runtime de produção da JNC — fazer com o mesmo rito (staging + ghost-probe do envio) da 3.7.2.
