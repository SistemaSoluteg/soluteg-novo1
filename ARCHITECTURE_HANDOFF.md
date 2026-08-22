# Soluteg — Documento Técnico de Arquitetura e Handoff

> **Versão:** 1.4
> **Data:** 21 de agosto de 2026
> **Autor:** Thiago (com assessoria de Claude AI)
> **Audiência:** Arquiteto de software, desenvolvedores seniores, contributors técnicos
> **Status do projeto:** Em produção (JNC) | Refactor multi-tenant em andamento

---

## Índice

1. [Contexto de Negócio](#1-contexto-de-negócio)
2. [Stack Técnica](#2-stack-técnica)
3. [Infraestrutura](#3-infraestrutura)
4. [Arquitetura Atual (Single-Tenant)](#4-arquitetura-atual-single-tenant)
5. [Arquitetura Alvo (Multi-Tenant)](#5-arquitetura-alvo-multi-tenant)
6. [Decisões de Design e Trade-offs](#6-decisões-de-design-e-trade-offs)
7. [Roadmap e Status](#7-roadmap-e-status)
8. [O que foi feito até agora](#8-o-que-foi-feito-até-agora)
9. [O que vem pela frente](#9-o-que-vem-pela-frente)
10. [Dívida Técnica Conhecida](#10-dívida-técnica-conhecida)
11. [Padrões de Trabalho](#11-padrões-de-trabalho)
12. [Pontos para Revisão Arquitetural](#12-pontos-para-revisão-arquitetural)
13. [Apêndice: Glossário e Referências](#13-apêndice-glossário-e-referências)

---

## 1. Contexto de Negócio

### 1.1 Empresas envolvidas

**JNC Comércio e Serviços** — empresa familiar de serviços elétricos, hidráulicos e de bombeamento, atuante na Baixada Santista (litoral de São Paulo). Atende principalmente condomínios residenciais e empresas. Negócio tradicional, base de clientes pequena mas fiel (~30 clientes ativos).

**Soluteg** — plataforma de software desenvolvida originalmente para gerenciar a operação da JNC. Cresceu em escopo e funcionalidades a ponto de ter potencial de ser vendida como SaaS para outras empresas do mesmo nicho.

### 1.2 O problema

Hoje o Soluteg é **monolítico e single-tenant**: todos os dados pertencem implicitamente à JNC. Para virar SaaS, precisa suportar múltiplas empresas (tenants) com isolamento de dados, branding próprio, e diferentes modos de uso comercial.

Existem **dois cenários comerciais** previstos:

- **Cenário A (B2B clássico):** uma empresa de serviços (como a JNC) contrata o Soluteg para gerenciar seus clientes (condomínios). Os síndicos desses condomínios usam o portal do cliente; a empresa usa o portal admin.

- **Cenário B (B2C com técnico avulso):** um síndico contrata o Soluteg **diretamente** (sem intermediário), e indica um técnico de manutenção de sua confiança como "contato de notificação". Esse técnico **não loga** no sistema — só recebe alertas (WhatsApp/email) quando sensores disparam alarmes.

### 1.3 Características do produto

- **Portal Admin** (gestor/operacional): React, full-featured. CRUD de clientes, ordens de serviço (OS), orçamentos, PDV (vendas avulsas), estoque, técnicos, sensores de caixa d'água, laudos técnicos.
- **Portal Cliente** (síndico): React, simplificado. Visualiza suas OS, aprova orçamentos, recebe relatórios.
- **Portal Técnico** (PWA offline-capable): React. Recebe OS atribuídas, executa checklists, faz upload de fotos, captura assinatura digital, funciona offline e sincroniza depois.
- **Backend tRPC + WhatsApp + MQTT:** tRPC routers, integração WhatsApp Web.js para alertas, MQTT para receber dados de sensores ESP32 instalados em caixas d'água, geração de PDFs (OS, orçamentos, laudos).
- **Sensores físicos:** ESP32 com ultrassônico HC-SR04 medindo nível de caixa d'água, publicam via MQTT. Sistema detecta níveis críticos, dispara alarmes por zona com cooldown.

### 1.4 Restrições e contexto pessoal

Importante para entender decisões de design:

- **Equipe:** 1 desenvolvedor (Thiago), 3h/dia disponíveis em média.
- **Orçamento:** zero capital para investir. JNC paga as contas.
- **Pressão:** validação comercial precisa acontecer logo. Não há margem para over-engineering ou refactors longos sem retorno.
- **Filosofia:** preferir simplicidade testada vs novidades brilhantes. Cloudinary, MySQL, WhatsApp Web.js, MQTT são "boring tech" deliberadamente.

---

## 2. Stack Técnica

### 2.1 Frontend

- **React 19** + **TypeScript** + **Vite 7**
- **TanStack Router** (file-based routing)
- **Tailwind CSS** + componentes shadcn/ui
- **tRPC client** para chamadas ao backend (type-safe end-to-end)
- **PWA** (vite-plugin-pwa) com Workbox
- **IndexedDB** para cache offline (portal técnico)
- **Lucide React** para ícones

### 2.2 Backend

- **Node.js 22** + **TypeScript**
- **Express** como servidor HTTP
- **tRPC server** (routers organizados por domínio)
- **Drizzle ORM** com MySQL 8
- **Zod** para validação de schema
- **bcryptjs** para hash de senhas (cost 12)
- **JWT** para sessões (httpOnly cookies)
- **csurf** para proteção CSRF

### 2.3 Integrações

- **WhatsApp Web.js** (Puppeteer-based) — único serviço de alerta funcional hoje
- **MQTT** (mqtt.js) — broker hospedado, recebe dados dos sensores ESP32
- **Cloudinary** — armazenamento de imagens (fotos de OS, perfis, anexos)
- **PDFKit** — geração de PDFs server-side
- **Nodemailer** — email de fallback (pouco usado)
- **Web Push API** — push notifications via VAPID (recém implementado)

### 2.4 Build & Deploy

- **pnpm 10.4** (workspace simples, sem monorepo)
- **esbuild** para bundling do backend
- **Vite** para build do frontend
- **PM2** para process management
- **Nginx** como reverse proxy
- **Certbot/Let's Encrypt** para SSL

### 2.5 Banco de dados

- **MySQL 8.0** hospedado em servidor próprio do provedor (Hostgator VPS)
- **InnoDB**, charset **utf8mb4**, collation **utf8mb4_bin** (case-sensitive, byte-exato) — escolha deliberada para evitar problemas de comparação de strings em emails, slugs, usernames

---

## 3. Infraestrutura

### 3.1 Topologia

```
                            ┌──────────────────────────┐
                            │   Hostgator VPS Ubuntu   │
                            │                          │
                            │  Nginx (reverse proxy)   │
                            │     ↓                    │
                            │  ┌──────────────────┐    │
                            │  │ PM2 process mgr  │    │
                            │  │                  │    │
                            │  │ soluteg-sistema  │    │ porta 3000 (PROD)
                            │  │ soluteg-staging  │    │ porta 3001 (STG)
                            │  └──────────────────┘    │
                            │                          │
                            └──────────┬───────────────┘
                                       │
                                       │ TCP 3306
                                       ↓
                            ┌──────────────────────────┐
                            │   MySQL 8 (Hostgator)    │
                            │  69.6.213.57             │
                            │                          │
                            │  d5ea2e96_solutegdb  ←PROD│
                            │  d5ea2e96_tst        ←STG│
                            └──────────────────────────┘

                            ┌──────────────────────────┐
                            │  MQTT Broker externo     │
                            │  (sensores ESP32 publish)│
                            └──────────────────────────┘
```

### 3.2 Domínios

| Domínio | Aponta para | Conteúdo |
|---------|-------------|----------|
| `jnc.soluteg.com.br` | Astro static site | Landing page institucional da JNC |
| `app.soluteg.com.br` | PM2 `soluteg-sistema` :3000 | Sistema operacional (admin/client/technician portals) |
| `tst.soluteg.com.br` | PM2 `soluteg-staging` :3001 | Mesma codebase, ambiente de staging |
| `soluteg.com.br` | (planejado) | Landing comercial SaaS — não construído ainda |

### 3.3 Bancos de dados

**Produção (`d5ea2e96_solutegdb`):**
- Dados reais da JNC
- 29 clientes ativos
- 76 ordens de serviço históricas
- 270 produtos cadastrados
- User: `d5ea2e96_soluteg`

**Staging (`d5ea2e96_tst`):**
- Dump de produção (de 13/05/2026)
- Isolado por user MySQL diferente: `d5ea2e96_id_rsa` (sem acesso ao banco de produção)
- Onde todo o trabalho de multi-tenant está sendo testado antes de subir

### 3.4 Isolamento de ambientes

O staging foi explicitamente isolado de produção via flags no `.env`:

```env
PORT=3001                      # porta diferente
MQTT_DISABLED=true             # não consome MQTT (evita duplicação)
WHATSAPP_DISABLED=true         # não envia WhatsApp real
DB_NAME=d5ea2e96_tst          # banco separado
```

Código em `server/index.ts`, `server/mqttService.ts`, `server/whatsapp.ts` respeita essas flags. Há também `server/lib/environment.ts` com `assertStagingEnvironment()` que aborta scripts caso detecte `DB_NAME` de produção.

### 3.5 Backups

Backups manuais via `mysqldump` em `/var/backups/soluteg-staging/` e `/var/backups/soluteg-producao/`. Permissão `0600` (só root). **Não há backup automatizado configurado** — ver dívida técnica.

---

## 4. Arquitetura Atual (Single-Tenant)

### 4.1 Modelo de dados (simplificado)

```
┌──────────┐
│  admins  │  ← Thiago e qualquer outro admin (raro)
└──────────┘

┌──────────┐
│ clients  │  ← Síndicos/Administradoras (clientes da JNC)
└────┬─────┘
     │ 1:N
     ↓
┌────────────┐    ┌──────────────┐    ┌────────────┐
│ workOrders │────│ technicians  │    │  budgets   │
│   (OS)     │    │              │    │ (orçamentos)│
└────┬───────┘    └──────────────┘    └────┬───────┘
     │                                      │
     │ 1:N                                  │ 1:N
     ↓                                      ↓
┌──────────────────────┐         ┌──────────────────┐
│workOrderAttachments  │         │   budgetItems    │
│ workOrderPhotos      │         └──────────────────┘
│ workOrderChecklists  │
└──────────────────────┘

Sensores e alarmes:
┌─────────────────────┐    ┌──────────────────────┐
│  waterTankSensors   │────│ waterTankMonitoring  │
└─────────────────────┘    └──────────────────────┘
       │
       ↓
┌──────────────────────┐
│  waterTankAlertLog   │
└──────────────────────┘

PDV (vendas avulsas):
┌──────────┐   ┌────────────┐    ┌────────────────┐
│ products │←──│ saleItems  │←───│     sales      │
└──────────┘   └────────────┘    └────────────────┘
                                  ↑
                                  │ 1:N
                                  ↓
                          ┌──────────────────┐
                          │ cashTransactions │
                          └──────────────────┘

Laudos técnicos:
┌──────────────┐    ┌────────────────┐
│ laudoTipos   │    │ normasBiblioteca│
└──────┬───────┘    └─────────────────┘
       │
       ↓
┌──────────────┐    ┌──────────────┐
│   laudos     │←───│  laudoFotos  │
└──────────────┘    └──────────────┘
       │
       ↓
┌──────────────────┐
│ laudoCitacoes    │
│ normaTrechos     │
└──────────────────┘

Push notifications (recente):
┌──────────────────────┐    ┌────────────────────┐
│ pushSubscriptions    │    │ notificationLogs   │
└──────────────────────┘    └────────────────────┘

Auditoria (criado na 3.7.1a):
┌──────────────┐    ┌───────────────────┐    ┌─────────────────────┐
│  auditLog    │    │  loginAttempts    │    │ migrationAuditLog   │
└──────────────┘    └───────────────────┘    └─────────────────────┘
```

### 4.2 Camadas de aplicação

```
Frontend (React)
     ↓
tRPC Client (type-safe RPC)
     ↓
Express + tRPC routers (server/routers/*.ts)
     ↓
DB modules (server/budgetsDb.ts, etc) — funções que encapsulam queries Drizzle
     ↓
Drizzle ORM
     ↓
MySQL 8
```

**Não há separação formal entre domain/application/infrastructure.** É um monolito pragmático: routers chamam funções DB, funções DB usam Drizzle, Drizzle fala com MySQL. Para o tamanho do time e do produto hoje, é adequado.

### 4.3 Autenticação

- **Admin**: login via username/senha, JWT em cookie httpOnly
- **Client**: login via username/senha, JWT em cookie httpOnly separado
- **Technician**: login via username/senha, JWT em cookie httpOnly separado
- **Public budget approval**: link com token JWT de uso único, expira

Três tipos de cookie diferentes, três middlewares tRPC. Não há refresh token. Não há revogação ativa de sessão. JWT_SECRET único para todos.

### 4.4 Limitações arquiteturais conhecidas

- **Acoplamento JNC ↔ Soluteg:** UI e dados assumem que a empresa é a JNC (branding, número de WhatsApp hardcoded em `server/whatsapp.ts`).
- **`adminId` em workOrders:** referencia o admin que criou a OS, mas é usado como se fosse "dono da OS" — confunde papéis.
- **Sem `tenantId` em lugar nenhum:** tudo é implicitamente da JNC.
- **WhatsApp único:** uma única sessão de WhatsApp Web.js para todo o sistema, ligada ao número da JNC.

---

## 5. Arquitetura Alvo (Multi-Tenant)

### 5.1 Princípios

1. **Isolamento forte por tenant.** Nenhum admin de tenant pode ver dados de outro tenant. Garantido por filtro automático em toda query, não pela boa vontade do desenvolvedor.
2. **Plataforma como entidade separada.** Donos da plataforma (`platformAdmin`) são diferentes de admins de tenant. Visão global, mas explícita.
3. **Multi-tenancy via shared database + tenant_id.** Não vamos para schema-per-tenant nem database-per-tenant. Tenant_id em toda tabela operacional. Simples, performante, suficiente para a escala prevista (50–200 tenants).
4. **Soft delete via `active` flag.** Não usamos CASCADE em FKs. Exclusão é sempre lógica.
5. **Branding por tenant.** Logo, cor primária, número de WhatsApp, email de contato — tudo configurável.
6. **WhatsApp Multi-sessão (futuro).** Hoje uma sessão. Futuramente uma sessão por tenant (ou tenants compartilham se quiserem).

### 5.2 Novo modelo de dados (camadas a adicionar)

```
PLATAFORMA
┌──────────────────┐
│ platformAdmins   │  ← Donos do Soluteg (Thiago e quem mais entrar)
└──────────────────┘

TENANTS
┌──────────┐
│ tenants  │  ← JNC, Soluteg Direto, futuros parceiros
└────┬─────┘
     │ 1:N
     ↓
┌──────────┐         ┌──────────────┐
│ gestors  │←────────│ condominiums │
│(síndicos)│   N:1   │  (lugares)   │
└──────────┘         └──────┬───────┘
                            │ 1:N
                            ↓
                    ┌─────────────────────┐
                    │ notificationContacts│  ← técnicos avulsos (Cenário B)
                    └─────────────────────┘
```

### 5.3 Definição das novas tabelas

#### `tenants`
- `id` int PK
- `name` varchar(200)
- `slug` varchar(100) UNIQUE — identificador URL-friendly
- `isPlatformTenant` tinyint — flag para o tenant especial "Soluteg Direto"
- `logoUrl`, `primaryColor` (default `#D4A84B`), `whatsappNumber`, `contactEmail`, `cnpj`, `address`, `city`, `state`
- `active` tinyint default 1

#### `platformAdmins`
- Donos da plataforma, sem FK para tenant
- `id`, `name`, `email` UNIQUE, `passwordHash`, `active`, `lastLoginAt`, `mustResetPassword`

#### `gestors`
- Síndicos, administradoras, gerentes de manutenção
- `id`, `tenantId` FK, `name`, `email`, `whatsapp`, `username`, `passwordHash`
- `role` varchar — `sindico`, `subsindico`, `conselheiro`, `zelador`, `gerente_manutencao`, `administradora`, `outro`
- UNIQUE composto em `(tenantId, username)` — username único POR tenant, não globalmente
- `mustResetPassword` default 1 — gestores migrados devem trocar senha no 1º acesso

#### `condominiums`
- Lugares físicos
- `id`, `tenantId` FK, `gestorId` FK (nullable)
- `name`, `address`, `city`, `state`, `zipCode`, `units`
- `active`

#### `notificationContacts`
- Cenário B: técnicos avulsos que **não logam**, só recebem alertas
- `id`, `condominiumId` FK, `name`, `whatsapp`, `email`, `role`

### 5.4 Foreign keys e estratégia de delete

Todas as FKs com `ON DELETE NO ACTION ON UPDATE NO ACTION`. Soft delete via campo `active`. Razão: queremos manter histórico mesmo quando um gestor sai ou um tenant é desativado.

### 5.5 Plano de migração de dados existentes

Os 29 clients da JNC viram:
- 1 tenant ("JNC Comércio e Serviços") + N condominiums (1 por client, na maioria dos casos)
- 1 ou mais gestors por condomínio (deduplicando síndicos que aparecem em múltiplos clients)

Senhas dos gestores migrados ficam aleatórias (32 bytes) com `mustResetPassword=true`. Comunicação por WhatsApp para o primeiro acesso.

JWT_SECRET será **rotacionado** durante a migração para invalidar todas as sessões antigas.

### 5.6 Camada de autorização tRPC

Procedures novas serão adicionadas:

```typescript
platformAdminProcedure   // só platformAdmin loga
tenantAdminProcedure     // admin de um tenant específico
gestorProcedure          // síndico (loga no portal client)
technicianProcedure      // técnico
```

Cada procedure injeta `ctx.tenantId` (exceto platformAdmin que é cross-tenant). Toda query de tabela com `tenantId` DEVE filtrar por `ctx.tenantId` — sem confiar no developer lembrar.

### 5.7 Isolamento de queries

Estratégia escolhida: **helper centralizado** `forTenant(table, tenantId)` que retorna queries Drizzle já filtradas. Code review rejeita PRs que tocam queries sem usar o helper.

Alternativas consideradas e descartadas:
- **Row-Level Security do MySQL:** suporte fraco em MySQL 8, sem maturidade.
- **Schema-per-tenant:** complexo de operar com 100+ tenants, custo de migration cresce linear.
- **Database-per-tenant:** caro para uma operação 1-pessoa.

---

## 6. Decisões de Design e Trade-offs

### 6.1 Shared database + tenant_id

**Decisão:** uma tabela compartilhada com coluna `tenantId` em vez de schemas ou databases separados por tenant.

**Trade-offs:**
- ✅ Operação simples (1 banco, 1 backup, 1 migration)
- ✅ Performance adequada para a escala prevista (até ~200 tenants, milhares de clients por tenant)
- ✅ Queries cross-tenant possíveis quando necessário (relatórios da plataforma)
- ⚠️ Risco de vazamento se filtro de tenant_id for esquecido — mitigado pelo helper centralizado e auditoria
- ⚠️ Backup/restore não isola tenants — se um tenant pedir "apague tudo meu", é trabalho manual

### 6.2 Soft delete sempre

**Decisão:** nada de hard delete. Campo `active` em quase toda tabela.

**Trade-offs:**
- ✅ Histórico preservado (importante para LGPD e auditoria)
- ✅ Reativação simples
- ⚠️ Queries sempre precisam filtrar `WHERE active = 1` — risco de esquecer
- ⚠️ Tabelas crescem indefinidamente — mas com a escala prevista, não é problema

### 6.3 Collation `utf8mb4_bin` deliberada

**Decisão:** todas as tabelas do projeto em `utf8mb4_bin` (não a default `utf8mb4_0900_ai_ci`).

**Razão:**
- Comparação case-sensitive em emails, slugs, usernames evita bugs sutis ("JNC" vs "jnc" como slugs diferentes)
- Performance ligeiramente melhor (comparação byte-a-byte)
- Consistência com tabelas legacy que já estavam em `utf8mb4_bin`

**Trade-off:** Drizzle ORM não suporta collation por tabela no schema — precisamos editar SQL manual nas migrations. Documentado.

### 6.4 IDs `int` em vez de `bigint` ou UUID

**Decisão:** `int autoincrement` (4 bytes, ~2 bilhões de valores).

**Razão:**
- Mais que suficiente para a escala prevista
- Consistência com tabelas legacy
- UUIDs trazem overhead de 16 bytes + perda de localidade de cache + URLs feias
- Não vamos expor IDs em APIs públicas (orçamentos públicos usam token, não ID)

### 6.5 WhatsApp Web.js como canal principal de alerta

**Decisão:** continuar usando WhatsApp Web.js (via Puppeteer headless) como canal primário de alertas.

**Razão:**
- Custo zero (vs Twilio, Z-API, etc)
- Funciona com número pessoal da JNC, que já tem reputação
- Clientes preferem WhatsApp a SMS ou email

**Trade-offs:**
- ⚠️ Não-oficial. WhatsApp pode banir o número a qualquer momento.
- ⚠️ Sessão precisa de QR code para reautenticar quando cai
- ⚠️ Puppeteer é pesado em memória
- ⚠️ Stack frágil — bugs intermitentes como `detached Frame`

**Plano:** quando viável financeiramente, migrar para WhatsApp Business API oficial (Meta).

### 6.5.1 WhatsApp por tenant — abstração + wwebjs multi-instância (planejado, sub-fase 3.7.9)

**Contexto:** hoje o envio é global e da JNC — um único cliente `whatsapp-web.js` ([`server/whatsapp.ts`](./server/whatsapp.ts)) com o número da JNC **hardcoded** (`5513981301010`) e uma única sessão `./sessions`. Para o multi-tenant, cada tenant precisa usar o próprio número.

**Decisão (16/08/2026):** introduzir uma abstração `WhatsappProvider` e implementar `wwebjs` **multi-instância** (uma sessão/Chromium por tenant, em `./sessions/tenant-${id}`), com um seam pronto pra plugar a Cloud API oficial da Meta por tenant no futuro (`whatsappProvider: 'wwebjs' | 'cloud-api'`). Detalhe completo da sub-fase em [`ROADMAP.md`](./ROADMAP.md) (seção 3.7.9).

**Importante — hoje é só JNC.** O multi-tenant é estrutura preparatória; por enquanto roda **1 tenant real (JNC) = 1 sessão wwebjs**. A RAM só vira restrição quando/se escalar. O levantamento abaixo existe para dimensionar esse futuro, não é um problema atual.

#### Estimativa de RAM — quantos tenants o wwebjs comporta

O gargalo do wwebjs multi-instância é **memória**: cada sessão sobe um Chromium headless (Puppeteer). O Node em si por sessão é desprezível — o custo é o Chromium.

**Ainda não medido no VPS.** Os specs de RAM do VPS Hostgator não estão registrados na doc. Antes de prometer N tenants, **medir no servidor**:

```bash
# 1. RAM total e livre do VPS
free -h

# 2. Consumo atual do processo Node (app) e por processo
pm2 monit                      # visão ao vivo por processo PM2
ps aux --sort=-%mem | head -20 # top consumidores

# 3. RSS de UMA sessão wwebjs isolada (com o zap da JNC conectado):
#    somar o processo node + TODOS os processos chrome/chromium filhos
ps -o rss= -C chrome -C chromium | awk '{s+=$1} END {print s/1024 " MB (chromium total)"}'

# 4. Confirmar se o MySQL roda NESTE VPS ou em host separado (69.6.213.57)
#    — se for separado, libera RAM do VPS de app
mysqladmin -h 127.0.0.1 status 2>/dev/null && echo "MySQL local" || echo "MySQL provavelmente remoto"
```

**Fórmula:**

```
tenants_máx ≈ (RAM_total − RAM_base − RAM_reserva) ÷ RAM_por_sessão

RAM_base     = SO + Node app + Nginx (+ MySQL se local)
RAM_reserva  = folga p/ picos de sync/mídia do Chromium (~15–20% do total)
RAM_por_sessão ≈ 300–450 MB (Chromium headless wwebjs, steady-state; pica acima em sync)
```

**Estimativa por ordem de grandeza** (assumindo MySQL **remoto**, `RAM_base ≈ 1 GB`, reserva ~15%, `RAM_por_sessão = 400 MB` conservador):

| RAM do VPS | RAM p/ sessões | ~Sessões wwebjs | Leitura prática |
|------------|----------------|-----------------|-----------------|
| 2 GB | ~0,7 GB | **1–2** | Só JNC com folga. É o cenário de hoje. |
| 4 GB | ~2,4 GB | **~6** | Poucos tenants; ok pro curto prazo. |
| 8 GB | ~5,8 GB | **~14** | Teto realista do wwebjs num VPS único. |

> ⚠️ Números de **ordem de grandeza**, não medição. Se o MySQL rodar no mesmo VPS, subtrair a RAM dele da base e os números caem. Picos de sync/mídia do Chromium podem exigir margem maior. **Substituir esta tabela pela medição real assim que rodar os comandos acima.**

**Conclusão de arquitetura:** o wwebjs multi-instância escala para **dígitos únicos a ~baixa dezena** de tenants num VPS único — suficiente para o caso JNC + primeiros parceiros, insuficiente para SaaS de verdade. É exatamente por isso que a 3.7.9 investe na **abstração**: quando bater no teto de RAM, o caminho não é um VPS gigante, é migrar tenants para o `CloudApiProvider` (sem Chromium, RAM ~zero por tenant) — cada tenant em Cloud API **não conta** contra esse teto. Mitigações como `swap` degradam muito a latência do Puppeteer e não são saída real; evição de sessão ociosa também não ajuda (wwebjs precisa ficar conectado, e recarregar exige re-QR).

### 6.6 Cloudinary mantido

**Decisão:** Cloudinary continua sendo o storage de imagens.

**Razão:** alternativa Google Drive foi analisada e descartada por:
- Sem CDN, performance ruim em mobile
- Quotas imprevisíveis (Drive pode bloquear download por "uso comercial")
- URLs instáveis (problemas com PDFKit)
- Compartilhamento por link público vaza isolamento por tenant
- Conta pessoal vira gargalo de negócio

Cloudinary plano grátis suporta até ~20 condomínios sem custo. Pago US$89/mês cobre ~100 condomínios.

### 6.7 Cherry-pick em vez de PR para staging-isolation

**Decisão:** ajustes de staging (porta dinâmica, MQTT_DISABLED, WHATSAPP_DISABLED) vão para a branch `multi-tenant` sem PR. Quando merge na master, vão junto.

**Razão:** são "neutros" em produção (sem as flags no `.env`, comportamento é idêntico). Não justificam burocracia de PR separado.

---

## 7. Roadmap e Status

### 7.1 Fases gerais (do `ROADMAP.md`)

| Fase | Descrição | Status |
|------|-----------|--------|
| 1 | Alarmes funcionando (WhatsApp + retry queue + auto-OS) | ✅ CONCLUÍDA |
| 2 | Hardware (sensores ESP32) — feito em paralelo, fora do código | ⏭️ PULADA |
| 3 | Portal técnico PWA offline-capable | ✅ CONCLUÍDA |
| 3.6 | Web Push notifications | 🟡 INFRA PRONTA, ATIVAÇÃO ADIADA |
| 3.7 | Refactor multi-tenant | 🟡 EM ANDAMENTO |
| 4 | Validação comercial (3-5 condomínios pagantes) | ⏳ PENDENTE |
| 5 | Landing page comercial `soluteg.com.br` | ⏳ PENDENTE |

### 7.2 Detalhamento da Fase 3.7 (Multi-tenant)

| Sub-fase | Descrição | Status |
|----------|-----------|--------|
| 3.7.1a | Tabelas de segurança (auditLog, loginAttempts, migrationAuditLog) + helper de ambiente | ✅ CONCLUÍDA |
| 3.7.1b | Tabelas centrais (tenants, platformAdmins, gestors, condominiums, notificationContacts) | ✅ CONCLUÍDA |
| 3.7.1c | Adicionar coluna `tenantId` nas tabelas existentes (nullable) | ✅ CONCLUÍDA |
| 3.7.1d | Script de migração de dados (dry-run primeiro) | ✅ CONCLUÍDA |
| 3.7.1e | Executar migração real + criar conta platformAdmin | ✅ CONCLUÍDA |
| 3.7.2 | Isolamento de queries por tenant (helper centralizado + audit) | ✅ CONCLUÍDA (staging) |
| 3.7.1f | Tornar `tenantId` NOT NULL + FKs + índices + rotacionar JWT_SECRET — **só depois de 3.7.2** | ✅ CONCLUÍDA (staging) |
| 3.7.3 | Procedures tRPC tipadas por papel (platformAdmin/tenantAdmin/gestor/technician) | ⏳ PENDENTE |
| 3.7.4 | UI: portal platformAdmin (CRUD de tenants e admins) | ⏳ PENDENTE |
| 3.7.5 | UI: branding dinâmico por tenant (logo, cor, nome) | ⏳ PENDENTE |
| 3.7.6 | Fluxo de "primeiro acesso" do gestor migrado (link WhatsApp único) | ⏳ PENDENTE |
| 3.7.7 | Auditoria ativa (registrar ações sensíveis em `auditLog`) | ⏳ PENDENTE |
| 3.7.8 | Testes end-to-end de isolamento (tenant A NÃO acessa tenant B) | ⏳ PENDENTE |
| 3.7.9 | Notificações por tenant (WhatsApp multi-instância c/ abstração + Email + Templates editáveis) — **só depois de 3.7.2** | ⏳ PENDENTE |

---

## 8. O que foi feito até agora

### 8.1 Sub-fase 3.7.1a — Tabelas de segurança

**Objetivo:** preparar infraestrutura de auditoria antes de mexer em dados.

**Entregue:**
- Tabela `auditLog` (eventos sensíveis: criação de tenant, login admin, mudança de senha, etc)
- Tabela `loginAttempts` (rate limiting futuro)
- Tabela `migrationAuditLog` (rastreabilidade da migração de dados)
- Helper `server/lib/environment.ts`:
  - `assertStagingEnvironment()` aborta scripts se `DB_NAME` for de produção
  - `assertProductionEnvironment()` análogo
  - `maskPhone()`, `maskEmail()`, `maskString()` para logs sem dados sensíveis

**Migração:** `drizzle/0032_illegal_shinobi_shaw.sql`

**Achado importante:** durante o push para staging, o Drizzle Kit reportou 14 divergências entre schema e banco — dívida técnica acumulada de meses (UNIQUEs não aplicados, tipos diferentes, NOT NULLs sem default).

Todas as 14 foram analisadas, classificadas como seguras, e aplicadas via `scripts/sync-schema-staging.sql`. Documentadas em `drizzle/PENDENCIAS_DEPLOY_PRODUCAO.md` para replicar em produção.

### 8.2 Sub-fase 3.7.1b — Tabelas centrais multi-tenant

**Objetivo:** criar o esqueleto do modelo multi-tenant (sem migrar dados ainda).

**Entregue:**
- 5 tabelas criadas: `tenants`, `platformAdmins`, `gestors`, `condominiums`, `notificationContacts`
- Todas com `utf8mb4_bin` (consistente com tabelas de negócio)
- 4 foreign keys (NO ACTION, soft delete via `active`)
- 18 índices (incluindo UNIQUE composto `gestors_tenantId_username_unique`)
- IDs `int autoincrement`

**Migração:** `drizzle/0033_giant_tomorrow_man.sql` + `drizzle/migrations/0042_collation_fix_audit_tables.sql`

**Problema enfrentado durante aplicação:**

O arquivo de migration gerado pelo Drizzle Kit tem marcadores `--> statement-breakpoint` que não são SQL válido. Ao tentar aplicar via `mysql < arquivo.sql`, o parser quebrou. Solução: pipe via `grep -v "statement-breakpoint"`. Mas isso aplicou apenas os CREATE TABLE — as 4 foreign keys e 17 índices que vinham depois foram silenciosamente ignorados.

Foi necessário **detectar isso via validação pós-aplicação** (comparando `information_schema.TABLE_CONSTRAINTS` e `STATISTICS` contra o esperado) e aplicar manualmente os ALTERs e CREATE INDEX faltantes.

Lição: Drizzle Kit + `mysql` CLI nativo não conversam bem. Para produção, **toda migration multi-statement deve ser aplicada via DBeaver ou script Node.js que entende `statement-breakpoint`**.

### 8.3 Isolamento staging vs produção (ortogonal ao multi-tenant)

Durante o trabalho, foi necessário garantir que o staging não interferisse em produção. Implementado:

- `PORT` dinâmica via env (staging 3001, produção 3000)
- `MQTT_DISABLED=true` no staging (evita duplicar leituras de sensores)
- `WHATSAPP_DISABLED=true` no staging (evita mandar WhatsApp para clientes reais)
- `sessions/` no `.gitignore` (sessões WhatsApp Web.js não vão para o repo)

Todos os ajustes são "neutros" para produção (sem as flags no `.env`, comportamento padrão).

### 8.4 Bugfix paralelo de aprovação de orçamento

Durante o multi-tenant, surgiu um bug crítico em produção:

**Sintoma:** aprovação de orçamento falhava ao tentar criar a OS (Ordem de Serviço) automaticamente. O `status` do orçamento mudava para "aprovado" mas a OS nunca era gerada.

**Causa raiz:** `getBudgetByToken` em `server/budgetsDb.ts` não incluía `adminId` nem `priority` no SELECT. Quando `approveBudget` tentava criar a OS, esses campos chegavam como `undefined`. Drizzle traduz `undefined` para `default`, e como `workOrders.adminId` é `NOT NULL` sem default, o INSERT falhava silenciosamente.

A função "irmã" `getBudgetById` (usada pelo fluxo de admin) já incluía esses campos — foi uma inconsistência entre dois "getters" que evoluíram em momentos diferentes.

**Fix:** 2 linhas adicionadas ao SELECT. Commit `51a18a7`, branch `fix/budget-approval`, mergeado em master e deployado em produção. Validado.

### 8.4 Sub-fase 3.7.1c — `tenantId` nullable em tabelas existentes (18/05/2026)

**Objetivo:** preparar todas as tabelas operacionais para receber o identificador de tenant, sem quebrar a aplicação em produção e sem migrar dados ainda.

**Entregue:**

38 tabelas operacionais receberam `ADD COLUMN tenantId INT NULL` via migration `drizzle/0034_wonderful_vulcan.sql`. As tabelas incluem todas as entidades de negócio: `clients`, `workOrders`, `budgets`, `technicians`, `products`, `sales`, `saleItems`, `cashTransactions`, `laudos`, `waterTankSensors`, `waterTankAlertLog`, `waterTankFaultLog`, `documents`, `checklists`, `pushSubscriptions`, entre outras.

Total de tabelas com `tenantId` no banco após esta sub-fase:
- 1 tabela (3.7.1a): `migrationAuditLog`
- 2 tabelas (3.7.1b): `gestors`, `condominiums` (FKs referenciam `tenants`)
- 38 tabelas (3.7.1c): todas as tabelas operacionais restantes
- **Total: 41 tabelas**

**Decisão de design — denormalização deliberada:**

A coluna `tenantId` foi adicionada a **todas** as tabelas operacionais, inclusive às "filhas" (`workOrderTasks`, `workOrderMaterials`, `budgetItems`, etc), mesmo que o `tenantId` pudesse ser derivado pela cadeia de FKs (ex: `workOrderTasks → workOrders → tenantId`).

Razão: performance e simplicidade. Com `tenantId` direto em cada tabela, qualquer query pode ser filtrada por tenant em uma única cláusula `WHERE tenantId = ?`, sem JOINs adicionais. Esse padrão é chamado de **"denormalização defensiva"** e é a abordagem standard em shared-database multi-tenancy de alta performance.

Trade-off aceito: redundância de dados (risco de inconsistência se `tenantId` for atualizado em uma tabela sem atualizar nas filhas). Mitigado porque: (a) `tenantId` nunca muda após criação, e (b) o helper `forTenant()` da sub-fase 3.7.2 será a única forma de fazer queries nessas tabelas.

**Bug encontrado e resolvido durante aplicação:**

O Drizzle Kit gerou o arquivo de migration com marcadores `--> statement-breakpoint` **inline** (na mesma linha dos statements SQL), não em linhas separadas. Isso fez com que o método documentado até então (`grep -v "statement-breakpoint"`) **não funcionasse** — o `grep -v` remove linhas inteiras, mas quando o marcador está embutido no meio do SQL, a linha inteira era descartada junto.

Solução: usar `sed` para remover apenas o texto do marcador, preservando o statement:

```bash
sed 's|--> statement-breakpoint||g' drizzle/0034_wonderful_vulcan.sql | \
  mysql -h 69.6.213.57 -u <user> -p <database>
```

Essa diferença de comportamento entre arquivos de migration depende de como o Drizzle Kit os gera (varia com o número e tipo de statements). **A partir de agora, `sed` é o método padrão recomendado para todos os arquivos de migration.**

**Validação pós-aplicação:**

Dados existentes intactos. Confirmado via:
```sql
SELECT COUNT(*) FROM clients;      -- 29 ✅
SELECT COUNT(*) FROM workOrders;   -- 76 ✅
SELECT COUNT(*) FROM products;     -- 270 ✅
```

Coluna `tenantId` presente em todas as 38 tabelas, valor `NULL` para todos os registros existentes (esperado — dados serão populados na 3.7.1e).

**Migração:** `drizzle/0034_wonderful_vulcan.sql`

**Pendências para produção:** ver `PENDENCIAS_DEPLOY_PRODUCAO.md` seção "3.7.1c".

### 8.5 Sub-fase 3.7.1d — Script de migração de dados (05/08/2026)

**Objetivo:** escrever e validar o script de migração em dry-run antes de qualquer alteração no banco.

**Entregue:**
- Script `scripts/migrate-to-multi-tenant.ts` com 6 etapas:
  - **Etapa 0:** pré-validações (ambiente staging, tabelas de auditoria e multi-tenant, 38 colunas `tenantId`, contagens mínimas)
  - **Etapa 1:** ALTERs estruturais (`condominiums.type`, `clients.gestorId`) — DDL fora da transação (causa commit implícito no MySQL)
  - **Etapa 2:** criar tenants (JNC + Soluteg Direto) — idempotente (pula se já existe por `slug`)
  - **Etapa 3:** popular `tenantId=1` nas 38 tabelas via `UPDATE WHERE tenantId IS NULL`
  - **Etapa 4:** criar conta `platformAdmin` — idempotente (pula se já existe por email)
  - **Etapa 5:** validações finais (NULLs residuais, integridade referencial, contagens mínimas)
- Modos: sem flag = dry-run (zero escrita); `--apply` = execução real com transação MySQL

**Bug corrigido durante o desenvolvimento:**
`db.execute()` do mysql2 retorna `[linhas, metadata]` — formato aninhado. As helpers do script liam `rows[0]` (array de linhas) em vez de `rows[0][0]` (primeira linha), fazendo todas as contagens retornarem 0 e `colunaExiste()` sempre retornar `true` (pulava os ALTERs da Etapa 1 incorretamente). Corrigido nas quatro funções: `contar()`, `contarNulos()`, `tabelaExiste()`, `colunaExiste()`.

O script também passou a usar `getDb()` de `server/db.ts` (pool com `timezone: 'Z'`) em vez de `drizzle(url)` direto, alinhando com o padrão do projeto.

**Migration:** nenhuma — script de dados, não DDL.

### 8.6 Sub-fase 3.7.1e — Migração real em staging (05/08/2026)

**Objetivo:** executar `--apply` no banco staging e validar o resultado.

**Entregue:**
- Backup pré-migração: `/var/backups/soluteg-staging/backup-pre-3.7.1e-*.sql`
- Script executado com `--apply` sem erros; transação com COMMIT automático ao final
- **Tenants criados:**
  - `jnc` (id=1): JNC Comércio e Serviços, Praia Grande/SP, `isPlatformTenant=0`
  - `soluteg-direto` (id=2): `isPlatformTenant=1`
- **PlatformAdmin criado:** Thiago Lopes (id=1, `mustResetPassword=0`)
- **ALTERs estruturais:** `condominiums.type varchar(40) NOT NULL DEFAULT 'condominio'` e `clients.gestorId int NULL` adicionados
- **Dados populados:** `tenantId=1` em 109.230 linhas distribuídas nas 38 tabelas operacionais (29 clients, 75 workOrders, 270 products, 19 budgets, 187 sales, 107.290 waterTankMonitoring, entre outros)
- **Validações pós-migração:** zero NULLs residuais; todos os `tenantId` apontam para tenant existente
- Backup pós-migração: `/var/backups/soluteg-staging/backup-pos-3.7.1e-*.sql`
- Cada passo registrado em `migrationAuditLog` com `migrationName='3.7.1e-populate-tenants'`

**Migration:** nenhuma DDL nova — dados populados via script.

### 8.7 Sub-fase 3.7.2 — Fundação e Piloto do Isolamento de Queries (10/08/2026)

**Objetivo:** Implementar a camada de isolamento de queries, a parte mais crítica de segurança do multi-tenant, antes de "travar" a coluna `tenantId` como `NOT NULL`.

**Decisão de arquitetura (reordenação):** A sub-fase 3.7.2 foi movida para ANTES da 3.7.1f. A razão é que o código da aplicação ainda não populava `tenantId` nos `INSERT`s. Primeiro, o código precisa ser refatorado para lidar com `tenantId` em todas as operações; só depois a coluna pode se tornar `NOT NULL`.

**Entregue (Fundação):**
- **Helper centralizado:** Criado o `server/_core/tenant.ts` com as funções `forTenant` e `withTenant`. Elas são "fail-closed": lançam um erro se o `tenantId` do contexto for nulo, garantindo que nenhuma query seja executada sem o filtro de tenant.
- **Contexto tRPC:** O `createContext` agora resolve o `tenantId` do usuário logado (seja `admin`, `client` ou `technician`) através de uma query no banco e o injeta no `ctx.tenantId`. A decisão foi de não colocar o `tenantId` no JWT para evitar *staleness*.
- **Procedures tRPC:** Os procedures `adminLocalProcedure`, `protectedClientProcedure` e `protectedTechnicianProcedure` foram atualizados para usar o `ctx.tenantId` e falhar se ele não for encontrado.
- **Schema:** A coluna `tenantId INT NULL` foi adicionada à tabela `admins` e populada com `tenantId=1` para os admins existentes em staging.

**Entregue (Piloto):**
- O router `technicians` foi o primeiro a ser 100% isolado usando os novos helpers:
  - `list`: agora filtra por `ctx.tenantId`.
  - `create`: agora carimba o `tenantId` do admin que está criando o técnico.
  - `getById`, `update`, `updatePassword`, `delete`: agora são escopados pelo `tenantId`, garantindo que um admin só possa operar em técnicos do seu próprio tenant.
- O input schema de `list` e `create` foi limpo, removendo `adminId` (que agora vem do `ctx`).

**Validação:** Fundação e piloto validados em `tst.soluteg.com.br` com sucesso.

### 8.8 Sub-fase 3.7.2 — Router `clients` isolado (11/08/2026)

**Objetivo:** Segundo router isolado, aplicando o padrão validado no piloto `technicians`. `clients` foi escolhido por ser a tabela mais acessada do sistema (login de cliente, portal, OS, orçamentos).

**Entregue:**
- `server/db.ts`: nova função `getClientsByTenant(tenantId)` (usa `forTenantId`) e nova função `getClientEquipmentById(id)` (suporte à guarda de posse do equipamento). Nenhuma função existente teve assinatura alterada — evita quebrar os outros ~8 arquivos que chamam `getClientById`/`getClientByUsername`/etc fora deste router (`index.ts`, `budgets.router.ts`, `clientProfile.router.ts`, `technicianPortal.router.ts`, `workOrders.router.ts`).
- `clients.router.ts`:
  - `list`/`broadcastMessage`: `getClientsByTenant(ctx.tenantId)` em vez de `getClientsByAdminId(ctx.adminId)`.
  - `create`: `tenantId` carimbado via `withTenant(ctx, {...})` no objeto passado a `db.createClient` (que espalha `.values(client)` sem tratamento especial de campo — por isso o carimbo tem que acontecer antes, no router).
  - `getById`, `getByUsername`, `update`, `updatePassword`, `delete`: guarda `if (!client || client.tenantId !== ctx.tenantId) throw NOT_FOUND` antes de agir. Nenhuma dessas tinha checagem alguma antes (nem por admin, nem por tenant).
  - `equipment.list`/`equipment.add`: guarda trocada de `client.adminId !== ctx.adminId` para `client.tenantId !== ctx.tenantId`.
  - `equipment.remove`: ganhou guarda multi-etapa (equipamento → `clientId` → cliente → `tenantId`) que **não existia antes** — corrige um IDOR pré-existente (qualquer admin logado podia remover equipamento de qualquer cliente, de qualquer tenant, só sabendo o ID).
- **`getClientByUsername` permanece global (sem filtro de tenant)** — é o lookup usado pelo login do cliente em `server/index.ts`, que chama `db.ts` direto e não passa por este router. A guarda de tenant foi aplicada só no endpoint administrativo `clients.getByUsername`, no resultado.
- **`client_equipment` não tem coluna `tenantId` própria** — confirmado via `scripts/migrate-to-multi-tenant.ts` (não está na lista das 38 tabelas operacionais da Sub-fase 3.7.1c). É por isso que `equipment.remove` precisa do guard em duas etapas via o cliente dono, em vez de um filtro direto.
- Toda a lógica de negócio original foi preservada (hash de senha, geração de usuário/senha para `sem_portal`, campos completos de `create`/`update`, `broadcastMessage` com targeting e variáveis, integração `equipment.add` → `addEquipmentToMonthlyOs`).

**Validação:** `pnpm run check` comparado byte a byte contra o `HEAD` anterior à mudança — os mesmos 33 erros pré-existentes (dívida técnica em outros arquivos), zero erros novos.

**Commit:** `91e0403`.

### 8.9 Metodologia consolidada e fixes de infra encontrados no caminho (12/08/2026)

Com dois routers isolados, a metodologia da 3.7.2 ficou clara o suficiente para nomear:

- **Método A** (`technicians`): filtro direto na query via `forTenantId`/`withTenantId`. Usado quando o router acessa os dados por um helper isolado — não há risco de quebrar outros chamadores.
- **Método B** (`clients`): guarda no router (`if (registro.tenantId !== ctx.tenantId) throw NOT_FOUND`) aplicada **depois** de buscar via `server/db.ts`. Usado quando a função de leitura é compartilhada por vários arquivos e mudar sua assinatura quebraria outros pontos de chamada.
- **Validação — ghost-probe:** todo router isolado é validado criando um registro sob outro tenant (ex.: `Soluteg Direto`) e confirmando que ele fica **invisível** para o admin do JNC — tanto em listagens quanto em acesso direto por ID.

**Fixes de infra descobertos no caminho (não são multi-tenant em si, mas bloqueavam a validação em staging):**
- **Pipeline de deploy do staging quebrado:** o processo pm2 `soluteg-staging` rodava o código apontado para o diretório de **produção**, então todo `deploy-tst` era um no-op silencioso — o staging nunca recebia o código novo. Corrigido com `ecosystem.config.cjs` apontando para o diretório correto (já registrado na seção 8.7/histórico do ROADMAP, 08/08/2026).
- **Schema do staging desalinhado:** a tabela `client_equipment` estava **ausente** do banco `_tst` (existia só em produção). Isso travava o boot da aplicação e quebrava a listagem de equipamento e o upload de documento em staging. Criada a tabela em staging, boot limpo, funcionalidade normalizada.

**Dívidas técnicas anotadas (sem prioridade imediata):**
- `getTechnicianById` tem `tenantId` opcional na assinatura — precisa virar obrigatório quando `technicianPortal` e `workOrders` forem isolados (ambos dependem dela).
- Código morto identificado durante a auditoria dos routers — remover numa passada dedicada, fora do caminho crítico do isolamento.
- `3.7.1f` (NOT NULL + FKs + índices + rotação de `JWT_SECRET`) só entra depois que **todos** os routers estiverem isolados — mantém a ordem já decidida em 05/08/2026.

### 8.10 Sub-fase 3.7.2 — Router `workOrders` e rotas legadas isolados (13/08/2026)

**Objetivo:** Isolar o router mais complexo e crítico do sistema, `workOrders`, que apresentava múltiplas vulnerabilidades de vazamento de dados e escrita cross-tenant.

**Entregue:**
- **Isolamento do tRPC router (`workOrders.router.ts`):**
  - **Método B** (guarda no router) foi aplicado em todos os endpoints, pois `workOrdersDb.ts` é um módulo compartilhado.
  - `list`: agora filtra obrigatoriamente por `ctx.tenantId`. O `adminId` do input foi removido.
  - `create`: agora usa `ctx.adminId` e carimba `tenantId` via `withTenant(ctx, ...)`, corrigindo uma vulnerabilidade e garantindo que novas OSs pertençam ao tenant correto.
  - `getById`, `update`, `delete`, `deleteBatch`, e todas as outras mutações (`updateStatus`, `assignTechnician`, etc.) receberam uma guarda que verifica a posse da OS (`wo.tenantId === ctx.tenantId`) antes de qualquer operação. `deleteBatch` e `exportBatch` validam todos os IDs do lote.
  - **Sub-routers (`tasks`, `materials`, `attachments`, etc.):** Todos os endpoints foram protegidos. Leituras/escritas que recebem `workOrderId` validam a posse da OS principal. Mutações que recebem apenas o ID do sub-recurso (ex: `tasks.delete`) usam uma **guarda multi-etapa** (sub-recurso → `workOrderId` → OS → `tenantId`), corrigindo vulnerabilidades de acesso direto a objeto (IDOR).
- **Isolamento de rotas Express legadas (`server/index.ts`):**
  - `GET /api/work-orders/:id`: A rota, que era usada pelo frontend e não passava pelo tRPC, foi corrigida. Agora ela resolve o `tenantId` do admin autenticado e aplica a mesma guarda de posse do tRPC, fechando uma brecha de vazamento de dados.
  - `POST /api/work-orders`: A rota de criação de OS pelo portal do cliente foi corrigida para carimbar o `tenantId` do cliente na nova OS. Isso resolve uma regressão funcional crítica onde OSs criadas pelo portal ficavam órfãs (`tenantId=NULL`) e invisíveis para os admins.
- **Dívida Técnica:** O sub-router `metrics` foi **explicitamente deixado fora do escopo** desta etapa, conforme decisão. Ele continua agregando dados de todos os tenants. A pendência foi registrada.

**Validação (concluída em staging, 14/08/2026):**
- ✅ **Estático:** `pnpm run check` (`tsc --noEmit`) com 33 erros — idêntico à baseline pré-mudança, zero erros novos. Verificado revertendo os arquivos tocados e comparando a lista de erros, não só a contagem.
- ✅ **Ghost-probe cross-tenant** em `tst.soluteg.com.br`: OS semeada via SQL sob o tenant 2 (Soluteg Direto) ficou **invisível** para o admin do JNC (tenant 1) tanto na `list` quanto no acesso direto por ID via tRPC (`getById` → "não encontrada"). Controle positivo confirmado (OS real do tenant 1 continua acessível). *Nota: a checagem direta da rota Express `GET /api/work-orders/:id` pela barra do navegador é interceptada pelo roteador do frontend; a guarda dessa rota usa o mesmo padrão já validado no tRPC e foi confirmada por revisão de código.*
- ✅ **Regressão JNC**: listar, criar, editar e deletar OS funcionando normalmente.
- ✅ **Fluxo fail-closed `addEquipmentToMonthlyOs`**: adicionar equipamento a um cliente gera a OS mensal já carimbando `tenantId` corretamente.
- ✅ **Backfill de órfã**: a validação revelou 1 OS com `tenantId=NULL` no staging (uma "Vistoria de Agosto" criada por um teste manual de `addEquipmentToMonthlyOs` na janela **entre** a migração de 05/08 e o deploy da guarda fail-closed). Corrigida com `UPDATE workOrders SET tenantId=1 WHERE tenantId IS NULL` (todo dado real do staging é do JNC/tenant 1); `COUNT(NULL)=0` após o backfill, e a OS voltou a aparecer na lista. Confirma empiricamente a classe de bug que a guarda passou a prevenir.
- 🔵 **Cobertos por revisão de código, não exercitáveis em staging:** OS emergencial de caixa d'água (`waterTankAlertService`) e notificações WhatsApp — ambos desligados por config no staging (`MQTT_DISABLED`/`WHATSAPP_DISABLED`); a mudança não altera a lógica deles, só carimba `tenantId` antes das chamadas existentes. Cron mensal (`createMonthlyOsForClient`) — mesmo caminho de código do `addEquipmentToMonthlyOs`, que foi exercitado.

### 8.11 Sub-fase 3.7.2 — Router `budgets` isolado + fix de FK-do-input no `workOrders` (14/08/2026)

**Objetivo:** Isolar o router `budgets` (4º router). Terreno mais contido que `workOrders`: sem rotas Express, sem cron, todo acesso centralizado em `server/budgetsDb.ts`, e as 4 tabelas (`budgets`, `budgetItems`, `budgetHistory`, `budgetAttachments`) já com coluna `tenantId` própria.

**Entregue (`budgets`, commit `5483c1b`, Método B):**
- `list` e `getMetrics` filtram por `ctx.tenantId` (via `forTenantId`); `adminId` removido do input (regra 5.3). `getMetrics` antes vazava métricas cross-tenant.
- `getById`, `update`, `saveItems`, `getItems`, `getHistory`, `exportPDF`, `sendWhatsappBudget`, `finalize`, `rejectByAdmin`, `generateOs` ganharam guarda de posse (`budget.tenantId !== ctx.tenantId → NOT_FOUND`).
- `delete` e `shareToPortal` **não tinham checagem nenhuma** (IDOR) — guarda adicionada.
- `create` valida posse do `clientId` antes de criar (evita referenciar cliente de outro tenant e vazar PII no PDF/WhatsApp).
- `attachments.updateCaption`/`delete` (recebem só o `id` do anexo): guarda multi-etapa (anexo → `budgetId` → budget → `tenantId`), com novo helper de leitura `getBudgetAttachmentById`.
- `finalize` passou a usar `ctx.adminId` (antes vinha do input).
- **Fronteira do token preservada:** `getByToken`, `getItemsByToken`, `approve`, `reject`, `exportPDFByToken`, `attachments.listByToken` permanecem `publicProcedure` **globais por design** — a página pública de aprovação (`/orcamento/:token`) não tem admin logado nem `ctx.tenantId`; o token opaco (64 hex, `crypto.randomBytes`) é a credencial. Comentado explicitamente no código como "GLOBAL POR DESIGN" para ninguém adicionar guarda que quebraria a aprovação.
- **Sub-tabelas carimbadas:** `budgetItems`, `budgetHistory`, `budgetAttachments` recebem `tenantId` do budget pai na escrita (evita novos NULLs antes da 3.7.1f). `createBudget` ganhou guarda fail-closed (igual `createWorkOrder`).

**Entregue (fix de FK-do-input no `workOrders`, commit `ddc420e`):** durante a revisão do `budgets` foi identificado que `workOrders.router.ts → create`/`update`/`assignTechnician` (já commitados) carimbavam o `tenantId` da OS corretamente, mas **não validavam** que o `clientId`/`technicianId` vindo do input pertence ao tenant do admin — mesma classe de IDOR (vazamento de PII cross-tenant via FK forjada). Guardas adicionadas via `getClientById` + `getTechnicianById(id, ctx.tenantId)`. Isso também começou a pagar a dívida do `tenantId` opcional em `getTechnicianById`.

**Validação (staging, 14/08/2026):**
- ✅ `tsc --noEmit`: 33 erros (baseline, zero novos) em ambos os commits.
- ✅ **Ghost-probe budgets:** budget semeado no tenant 2 invisível ao admin do JNC na `list`/`getById`/métricas e "não encontrado" por ID direto.
- ✅ **Link público intacto:** `/orcamento/:token` de um budget real do JNC carrega itens/anexos/PDF e permite aprovar/reprovar — as procedures por token continuam globais.
- ✅ **Fix de FK contra requisição forjada:** chamada `budgets.create` direta (DevTools) com `clientId` de um cliente semeado no tenant 2 retornou `NOT_FOUND` "Cliente não encontrado" — guarda confirmada na build de staging (`dist/index.js`). `workOrders.create` usa guarda idêntica (mesma classe, coberto por simetria).
- ✅ Regressão JNC do fluxo completo de orçamento (criar → itens → finalizar → link → aprovar → OS gerada carimbando tenant → PDF).

### 8.12 Sub-fase 3.7.2 — Router `checklists` isolado (14/08/2026)

**Objetivo:** Isolar o router `checklists` (5º router). Estrutura de dados particular: `checklistTemplates` **não tem `tenantId`** (catálogo global compartilhado — "bomba", "gerador"), enquanto `inspectionTasks` e `checklistInstances` têm `tenantId`.

**Modelo de dados (para contexto):** `inspectionTasks` é o contêiner que agrupa os checklists de uma OS — criado **uma vez por OS**, sob demanda, na primeira vez que um checklist é adicionado (título "Checklists de Equipamentos"). Cada `checklistInstance` pendura em uma `inspectionTask` (FK NOT NULL). Uma OS tem no máximo uma `inspectionTask`.

**Entregue (commit `88e4a85`, Método B):**
- **`templates.*` global por design:** `checklistTemplates` não tem `tenantId` — catálogo compartilhado entre tenants. `templates.list/getById/getBySlug` (admin) e `listTemplates` (technicianPortal) permanecem sem guarda, comentados como "GLOBAL POR DESIGN". `templateId` vindo do input também é global (sem checagem de posse de tenant).
- **`inspectionTasks.*`:** `listByWorkOrder`/`create` validam posse da OS via `workOrdersDb.getWorkOrderById`; `getById`/`getFull`/`updateStatus`/`complete`/`delete` guardam por `task.tenantId !== ctx.tenantId`. `create` carimba `tenantId`.
- **`instances.*`:** `create`/`listByTask` validam posse da task pai; `listByWorkOrder` valida via OS; `getById`/`getWithTemplate`/`updateResponses`/`update`/`delete`/`suggestConclusion` guardam por `instance.tenantId`.
- **`checklistsDb`:** `createInspectionTask` e `createChecklistInstance` passam a exigir `tenantId` + guarda fail-closed (padrão `createWorkOrder`).
- **3 caminhos de escrita cobertos** (a lição do `workOrders`): `checklists.router` (ctx.tenantId), `technicianPortal.addChecklist` — técnico em campo, já tinha posse via `getWorkOrderByIdForTechnician`, só passou a carimbar `ctx.tenantId` — e `monthlyOsJob` (cron, `client.tenantId`). Em `addEquipmentToMonthlyOs` o fetch do `client` foi movido para antes do `if/else`, pois as criações de checklist rodam nos dois ramos (OS nova e OS já existente), não só quando a OS é criada.

**Validação (staging, 14/08/2026):**
- ✅ `tsc --noEmit`: 33 erros (baseline, zero novos).
- ✅ **Ghost-probe:** `inspectionTask` semeada no tenant 2 → `NOT_FOUND` para o admin do JNC (via `checklists.inspectionTasks.getById`, requisição forjada, confirmado na build `dist/index.js`); controle positivo (task do tenant 1) retorna os dados. Templates continuam visíveis (globais).
- ✅ **Regressão JNC:** criar OS → adicionar checklist → preencher respostas → salvar. (A conclusão da OS com assinatura é do `workOrders`, não do checklist.)
- ✅ **Backfill:** `SELECT COUNT(*) ... WHERE tenantId IS NULL` deu **0** em `inspectionTasks` e `checklistInstances` no staging — sem órfãos (as duas tabelas foram carimbadas na migração 3.7.1e e nada foi criado na janela sem `tenantId`).

**Código morto identificado (candidato à próxima faxina, não removido agora):** o endpoint `inspectionTasks.complete` (concluir tarefa com assinatura de colaborador) + `completeInspectionTask` do `checklistsDb` **não são chamados por nenhuma parte do frontend** — a assinatura real vive no `workOrders.complete`. O `canComplete` é um stub que sempre retorna `true` (usado só para habilitar um botão). Ficam isolados com guarda por ora; remover numa passada de limpeza dedicada.

### 8.13 Sub-fase 3.7.2 — Router `technicianPortal` + carimbo nas sub-tabelas de OS (14/08/2026)

**Objetivo:** Isolar o `technicianPortal` (6º router) e fechar um acúmulo de `tenantId=NULL` nas sub-tabelas de OS.

**Diagnóstico:** o `technicianPortal` **já era seguro** contra cross-tenant — todo endpoint que toca uma OS passa por `getWorkOrderByIdForTechnician(workOrderId, ctx.technicianId)`, e como um técnico pertence a um único tenant e (após o fix de FK do `assignTechnician`) só se atribui técnico do mesmo tenant, o técnico nunca alcança OS de outro tenant. **Não havia IDOR.** `getTechnicianByUsername` é o lookup do login do técnico — **global por design**.

**Entregue (commit `4a35ab1`):**
- **Parte A (defesa-em-profundidade):** `getTechnicianById(ctx.technicianId)` → `getTechnicianById(ctx.technicianId, ctx.tenantId)` (paga a dívida do `tenantId` opcional). Não alterada a assinatura de `getWorkOrderByIdForTechnician`/`getWorkOrdersByTechnicianId` (posse por `technicianId` já garante o tenant).
- **Parte B (o valor real — carimbo nas sub-tabelas):** as 5 sub-tabelas de OS (`workOrderTasks`, `workOrderMaterials`, `workOrderAttachments`, `workOrderComments`, `workOrderTimeTracking`) têm `tenantId` mas ninguém carimbava — nasciam `NULL`. Adicionada guarda fail-closed nas 5 funções `createX` do `workOrdersAuxDb` + **9 call sites** passando `tenantId` (5 no `workOrders` admin, 2 no `technicianPortal`, 2 no `budgets`/cópia de fotos). **Não era vazamento** (acesso via OS pai), mas fecha acúmulo de NULL que a `3.7.1f` teria que limpar — achado que passou batido na isolação do `workOrders`.

**Validação (staging):** `tsc` baseline (33 na época); confirmado por SQL que os sub-recursos novos nascem com `tenantId=1` (não NULL) após o deploy; regressão do fluxo admin (tarefa/anexo/comentário) e do técnico em campo OK.

**Código morto identificado:** o sub-router `workOrders.timeTracking.*` inteiro + funções do `workOrdersAuxDb` — **sem caller no frontend** e tabela vazia. Feature nunca ligada. Candidato à faxina.

### 8.14 Sub-fase 3.7.2 — Router `documents` isolado (14/08/2026)

**Objetivo:** Isolar o acesso a `clientDocuments` (7º router). Uma tabela (`clientDocuments`, tem `tenantId`) tocada por **3 routers + 1 rota Express**.

**Entregue (commit `6997ef6`, Método B):**
- **3 routers:** `documents.*` (`listAll` por `ctx.tenantId`; `getById`/`delete` com guarda; `create` valida posse do `clientId` + carimba `tenantId`), `adminDocuments.*` e `adminProfile.adminDocuments.*` (`list` por tenant; `update`/`delete`/`updateFile` com guarda — eram IDOR puro). `documents.list` (portal do cliente) já era seguro por `ctx.clientId`.
- **Rota Express** `DELETE /api/client-documents/:id`: resolve `tenantId` do admin via cookie e guarda a posse do documento (mesmo padrão da rota de work-orders).
- **`db.ts`:** `getDocumentsByAdminId` → `getDocumentsByTenant` (filtro por `tenantId`); `getAllDocumentsWithFilters` passa a filtrar por `tenantId`; `createClientDocument` com fail-closed.
- **Achado grave corrigido:** `getAllDocumentsWithFilters` tinha `adminId` no tipo dos filtros mas **nunca o aplicava numa condition** — o `documents.listAll` devolvia documentos de **todos os tenants**, sem filtro algum. Agora o `conditions` sempre começa com o filtro de tenant.

**Duplicação registrada (candidata à faxina):** `adminDocuments.router` e `adminProfile.adminDocuments` são idênticos, e `deleteClientDocument` ≡ `deleteDocument` no `db.ts`. Grep no frontend confirmou que **nenhum dos dois routers duplicados tem caller** — só `trpc.documents.*` está vivo. Guardados por segurança, comentados como candidatos à remoção.

**Validação (staging, `dist/index.js`):** `tsc` 32 (baseline, zero novos — o fix do `osNumber` fechou 1); ghost-probe `documents.getById` de doc do tenant 2 → `NOT_FOUND`; regressão JNC (listar/criar/deletar documento + portal do cliente) OK; backfill de `clientDocuments`.

### 8.15 Sub-fase 3.7.2 — Router `waterTankAdmin` isolado (14/08/2026)

**Objetivo:** Isolar o `waterTankAdmin` (8º router), que tinha o IDOR mais grave da sub-fase: **`adminId` vinha do input e era confiado** — um admin podia forjar o `adminId` de outro tenant e acessar/editar/deletar sensores dele. As 4 tabelas de caixa d'água (`waterTankSensors`, `waterTankMonitoring`, `waterTankAlertLog`, `waterTankFaultLog`) têm `tenantId`.

**Particularidade — duas metades com regras opostas:**
- **Metade admin (tRPC, tem `ctx`) — fail-closed:** `adminId` removido de todos os inputs (vem do `ctx`); filtros `adminId → tenantId` em `listSensors`/`updateSensor`/`deleteSensor`/`getSensorById`/`registerFault`/`listFaults`/`getFaultStats`/`listRecentAlerts`; `assignSensor` carimba `tenantId` e valida posse de `clientId` (`getClientById`) e `technicianId` (`getTechnicianById(id, tenantId)`); `registerFault` valida sensor e `osId` por tenant e carimba o fault log.
- **Metade ingestão (MQTT + rota Express `POST /api/water-tank-monitoring`) — best-effort, SEM fail-closed:** `getAssignedSensorByDeviceId` passou a retornar `tenantId` (lookup por `deviceId` é global por design — é o "login" do sensor, sem `ctx`); `saveWaterTankReading` e o `INSERT` em `waterTankAlertLog` carimbam `tenantId` do sensor **se houver**, mas **nunca dropam** a leitura/alarme por `tenantId` ausente. Motivo: perder uma leitura de nível ou um alarme é risco real da Fase 1 (caixa secar/transbordar). Integridade de `tenantId` nessas tabelas vem de carimbo best-effort + backfill, não de fail-closed.

**Decisão pendente registrada:** `listPending` (sensores não atribuídos, `clientId`/`tenantId` NULL) ficou **global** — pool de devices compartilhado. Não é vazamento (pendente não tem dono), mas a política de atribuição de device a tenant é assunto de fase futura (provavelmente via `platformAdmin`).

**Validação (staging, ponta a ponta):** o servidor local foi apontado para o banco `_tst` e testado via HTTP real com JWT de admin — ghost-probe cross-tenant (sensor do tenant 2 invisível; update/delete no-op), FK forjada (`assignSensor` com `clientId` do tenant 2 → NOT_FOUND), ingestão simulada (carimbo best-effort, sem fail-closed), `checkAndSendAlerts` simulado gerando OS emergencial + `waterTankAlertLog` com `tenantId=1`. Backfill das 4 tabelas (`waterTankMonitoring` tinha 7.926 NULLs). Massa sintética removida ao final. `tsc` 32, zero novos.

**Achados fora do escopo:** (1) drift de schema no staging — `waterTankSensors` estava sem a coluna `alertPhone2` no `_tst` (existe no `schema.ts`/produção; mesmo padrão do `client_equipment`); aplicado `ALTER` aditivo só no staging, produção não precisa. (2) a rota Express `POST /api/water-tank-monitoring` ainda aceita `adminId` do `req.body` sem validar posse (`SEC-02` no `PENDENCIAS_TECNICAS.md`) — o `tenantId` já vem do cliente real, mas o `adminId`-do-body é dívida separada.

### 8.16 Sub-fase 3.7.2 — Router `laudos` + fechamento da sub-fase (15/08/2026)

**Objetivo:** Isolar `laudos` (9º e mais complexo router — 40+ endpoints, admin + técnico + público) e fechar os últimos itens da 3.7.2.

**`laudos` (commit `3dd4d4e`, Método B):** as 5 tabelas (`laudos`, `laudoFotos`, `laudoMedicoes`, `laudoTecnicos`, `laudoCitacoes`) têm `tenantId`. Introduzidos helpers reutilizáveis: `carregarLaudoDoTenant(laudoId, tenantId)` (guarda de posse usada em **todo** endpoint que recebe id/laudoId), `assertClienteDoTenant`/`assertTecnicoDoTenant` (FKs-do-input). `listLaudos` com fail-closed de `tenantId`; sub-recursos (fotos/medições/citações) guardados via laudo pai (multi-etapa) e carimbando `tenantId` na escrita; `atribuirTecnico` valida o técnico. Callers externos do `laudosDb` são só read-only (`iaLaudos`, `pdfLaudo`) — sem escritor de sistema/Express. Endpoints do técnico já tinham guarda de posse por `criadoPor`/`tecnicoAtribuido`.

**Outros itens fechados na mesma janela:**
- **SEC-01** (commit `44bd66b`): a rota Express `GET /api/admin-metrics?adminId=X` (sem auth, aceitava adminId da query) foi removida e substituída por `adminMetrics.router.getDashboard` — `adminLocalProcedure`, escopado por `ctx.adminId` **e** `ctx.tenantId`, sem input de identidade.
- **SSE `/api/water-tank-sse`**: ganhou `requireClientAuth` e o `clientId` passou a vir do JWT (antes vinha da query — qualquer um assinava o stream de qualquer cliente). Gap que a auditoria do `waterTankAdmin` não tinha coberto.
- **Gate `pdvProcedure`** (commit `833834f`): novo middleware em `_core/trpc.ts` que lança `FORBIDDEN` se `ctx.tenantId !== 1` — aplica a decisão "PDV é exclusivo da JNC" no nível da procedure.
- **`pushSubscriptions`** (commit `f5759ec`): passa a carimbar `tenantId` do `ctx` na criação (userId já vinha do ctx — já era seguro).
- **Faxina `reports`/`users`** (commit `3d0d653`): removidos os routers legados do template original (sistema `userId`, sem caller no frontend), com as funções órfãs de `db.ts`. Confirmado que `ctx.user`/`auth.me`/router `auth` (login) continuam intactos.

**Validação (staging, 16/08 — servidor local × `_tst`, HTTP real com JWT):** `laudos` — ghost-probe (laudo/foto do tenant 2 → NOT_FOUND), FK forjada (`clienteId`/`tecnicoId` de outro tenant → NOT_FOUND), regressão completa (criar → foto/medição/citação → atribuir técnico → PDF) e portal do técnico (só vê os seus); `adminMetrics` bateu com o banco; `pdvProcedure` tenant 1 OK; SSE `/api/water-tank-sse` 401 sem cookie / 200 com. `tsc` 32. *Nota SEC-01: a URL antiga `GET /api/admin-metrics` devolve o SPA (HTML) via catch-all do Vite, não 404 — a rota Express foi de fato removida; o 200 é comportamento normal de SPA, não vazamento.* **Único ponto por partes:** propagação SSE em tempo real (MQTT off no staging) precisa de teste no navegador com sensor real.

**Backfill:** `scripts/backfill-tenant-null.ts` estendido (16 regras determinísticas via FK-pai: `clientDocuments`, sub-tabelas de OS incl. `workOrderHistory`, `inspectionTasks`/`checklistInstances` em ordem pai→filho, caixa d'água, sub-tabelas de orçamento). Dry-run + `--apply` no staging zeraram tudo derivável (`workOrderHistory` 5→0). Mantém `assertStagingEnvironment`, dry-run por padrão, e reporta as ambíguas para decisão manual.

**Achados da validação (registrados, não bloqueantes para a 3.7.2):**
- `laudosDb.deleteLaudo` limpa fotos/medições/técnicos mas **não** `laudoCitacoes` → citação órfã no cascade. Fix pontual.
- Budget órfão `id=22` ("Hshs", `clientId` inexistente, teste de 05/08) — nenhuma regra deriva tenant. Lixo de teste; deletar (ele + `budgetItems`/`budgetHistory`) antes da 3.7.1f.
- `notificationLogs` acumula `tenantId` NULL porque `server/lib/notifications.ts:223` insere sem carimbar. Não é falta de regra de backfill, é o write-path. Como é log de debug (baixa sensibilidade), **excluir da 3.7.1f (NOT NULL)** e corrigir o carimbo na 3.7.9 (que reescreve o fluxo de notificações).

---

## 9. O que vem pela frente

### 9.1 Sub-fase 3.7.2 — Isolamento de Queries *(✅ CONCLUÍDA — validação final de `laudos`/SSE/`adminMetrics` pendente)*

**Escopo:** Aplicar o padrão de isolamento de queries (Método B) a todos os routers que lidam com dados operacionais. **✅ CONCLUÍDA — 9 routers isolados:** `technicians` (Método A), `clients`, `workOrders`, `budgets`, `checklists`, `technicianPortal`, `documents`, `waterTankAdmin`, `laudos`.

- **Fechados junto (15/08):** `clientProfile.uploadPhoto` (FK-do-input), `SEC-01` (`/api/admin-metrics` → `adminMetrics.router` autenticado), SSE `/api/water-tank-sse` (`requireClientAuth` + clientId do JWT — gap perdido na auditoria do waterTankAdmin), gate `pdvProcedure` (PDV só tenant 1), carimbo de `tenantId` no `pushSubscriptions`, e remoção dos routers legados `reports`/`users` (sem quebrar `ctx.user`/`auth`).
- **Já seguros por identidade própria (não precisaram de mudança):** `waterTankMonitoring`, `adminProfile`, `pushSubscriptions` (userId sempre de ctx). **Fora do escopo:** `pdv` (gated), `whatsapp`, `system`, `auth`, `adminAuth`.
- **Pendente antes da 3.7.1f:** (a) validação em staging de `laudos`/SSE/`adminMetrics`/`pdvProcedure` (commitados, sem ghost-probe/regressão registrados); (b) estender `scripts/backfill-tenant-null.ts` para cobrir todas as tabelas operacionais (hoje só laudos+pushSubscriptions determinístico).
- **Fronteira global (catálogos compartilhados):** `checklistTemplates` não tem `tenantId` — templates ficam globais. Padrão a reaplicar: tabelas de catálogo/referência compartilhadas entre tenants não recebem guarda; comentar como "GLOBAL POR DESIGN".
- **Padrão de guarda de FK-do-input:** ao isolar um router, além da posse do registro principal, validar **toda foreign key vinda do input** (`clientId`, `technicianId`, etc.) contra o tenant — senão dá pra referenciar registro de outro tenant e vazar PII. Lição incorporada a partir do `budgets`/`workOrders`.
- **PDV:** As 6 tabelas de PDV (`products`, `sales`, etc.) estão **fora** do escopo, pois a funcionalidade é exclusiva da JNC.

**Estimativa:** 10-15h de auditoria e refatoração + 5h de testes. **Sub-fase mais arriscada.**

### 9.2 Sub-fase 3.7.1f — NOT NULL e JWT_SECRET *(✅ CONCLUÍDA EM STAGING — 16/08; falta o cutover de produção)*

**Executado e validado em staging (`_tst`, 16/08):**
- **Fase 0 — diagnóstico:** `information_schema` listou **42 tabelas** com coluna `tenantId`. Achado: `admins` e `notificationContacts` estavam prontas e foram incluídas no travamento (fora das categorias originais do plano).
- **Fase 1 — backfill:** staging já limpo (0 NULL deriváveis em 41/42; só `notificationLogs` com NULL residual, por design — NOTIF-01). Não precisou de `--apply`.
- **Fase 2 — travamento:** **39 `ALTER ... MODIFY tenantId INT NOT NULL` + `ADD CONSTRAINT ... FOREIGN KEY (tenantId) REFERENCES tenants(id)`**, cada um validado por `information_schema` logo após. Total **41 tabelas travadas** (as 39 + `condominiums`/`gestors` que já vinham da 3.7.1b). `notificationLogs` deixada de fora (NOTIF-01). **`waterTankSensors` foi revertida em seguida (ver LOCK-02) — total final: 40 tabelas travadas.**
- **Fase 3 — rotação `JWT_SECRET`:** novo segredo no `.env` do staging + `pm2 restart --update-env`. Validada dos dois lados: cookie antigo rejeitado (aba deslogou na hora) e login novo OK. *(Lição: gerar o segredo direto pro `.env` via `sed`, sem `echo`/`grep` do valor — um segredo de staging foi exposto no processo e re-rotacionado.)*

Scripts: `scripts/diagnostico-3.7.1f-fase0.ts`, `scripts/lock-tenant-not-null-fk.ts`, `scripts/backfill-tenant-null.ts` (estendido, 16 regras via FK-pai), `scripts/diag-mqtt-listen.mjs` (escuta read-only do broker, usado para achar o LOCK-02 abaixo).

**⚠️ Exceção obrigatória (aplicada):** `notificationLogs` fica **fora** do NOT NULL — o write-path (`server/lib/notifications.ts:223`) insere sem carimbar `tenantId`, então a coluna volta a acumular NULL. Manter nullable até a 3.7.9. **Armadilha correlata (LOCK-01):** `admins`/`auditLog`/`invites`/`inspectionReports` foram travadas com NOT NULL mas seus writers (mortos/inativos) não carimbam `tenantId` — ao reativar (3.7.4 cria admin; 3.7.7 ativa auditLog) o writer TEM que carimbar, senão o INSERT falha.

**⚠️ LOCK-02 (achado em 20/08, ao religar o MQTT no staging com o broker real):** `waterTankSensors` foi travada com NOT NULL + FK na Fase 2, mas `upsertSensorDevice()` (`server/waterTankSensorDb.ts:12`) faz `INSERT INTO waterTankSensors (deviceId, lastSeenAt, active) VALUES (...) ON DUPLICATE KEY UPDATE lastSeenAt = NOW()` **sem `tenantId`** — é o "auto-discovery" de sensor MQTT, deliberadamente **GLOBAL POR DESIGN** (sensor novo não tem tenant até um admin atribuir; comentário já existia no código antes da 3.7.1f). O MySQL exige que a cláusula `VALUES` do `INSERT` satisfaça o `NOT NULL` **mesmo quando o ramo executado é o `ON DUPLICATE KEY UPDATE`** — ou seja, quebrou não só sensores novos, mas **toda leitura de sensor já atribuído também** (`ER_NO_DEFAULT_FOR_FIELD` a cada mensagem MQTT, 100% das leituras descartadas em staging até a correção). Revertido manualmente em staging: `ALTER TABLE waterTankSensors DROP FOREIGN KEY fk_waterTankSensors_tenant; ALTER TABLE waterTankSensors MODIFY COLUMN tenantId INT NULL;`. Validado com sensor real (`sensor_01`, broker HiveMQ Cloud de produção) voltando a salvar normalmente. **`waterTankSensors` deve ficar de fora do NOT NULL da 3.7.1f — mesma categoria do `notificationLogs`** (write-path que não carimba tenant por design). Corrigir isso de verdade (ex.: carimbar tenantId quando o sensor já está atribuído, manter NULL só para pendente) fica como dívida técnica, não bloqueia o cutover.

**Verificação pós-fix (20/08):** confirmado no banco — `waterTankMonitoring` recebendo 1 leitura a cada ~30s (`id` 115560→115569, `12:08:43`→`12:13:45`) com `tenantId=1` carimbado certo, e `waterTankSensors.lastSeenAt` do `sensor_01` atualizando. Fluxo ponta a ponta (MQTT → buffer 30s → conversão distância→nível → `saveWaterTankReading` isolado por tenant → upsert do sensor) validado com hardware real, não só leitura crua. **Limites do que foi testado** (não cobertos nesta rodada): só 1 tenant (só existe 1 sensor físico, sem ghost-probe cross-tenant possível); só sensor **já atribuído** (o caminho de sensor novo/pendente, que é o motivo real do `tenantId` nullable, não foi exercitado); cadeia de alerta (`waterTankAlertService`) não verificada (`WHATSAPP_DISABLED=true` no staging mascararia um alerta disparado). Diagnóstico feito com `scripts/diag-mqtt-listen.mjs` (broker público de teste primeiro, depois o real de produção — achado à parte: `mqtts://` só conecta em `:8883`, não `:8884`, mas produção já usa a porta certa, então não afeta nada real).

**Falta — cutover de produção:** produção não recebeu **nenhuma** migração multi-tenant (checklist inteiro ⏳ no `PENDENCIAS_DEPLOY_PRODUCAO.md`). É um evento único, com backup e janela de baixo uso: merge `multi-tenant → master` → `mysqldump` → migrações de schema (centrais + colunas `tenantId`) → migração de dados (tenants + `tenantId=1`) → `deploy-app` → backfill de residuais → ALTERs da 3.7.1f → rotação do `JWT_SECRET`. A 3.7.1f é o **último passo** desse cutover.

### 9.3 Sub-fases 3.7.3 a 3.7.8

Detalhamento existe mas é mais especulativo nesta etapa. Resumo:

- **3.7.3:** procedures tRPC com tipos diferentes por papel (`platformAdminProcedure` etc)
- **3.7.4:** portal `platformAdmin` (CRUD de tenants)
- **3.7.5:** branding dinâmico (logo + cor por tenant no frontend)
- **3.7.6:** fluxo de primeiro acesso do gestor migrado
- **3.7.7:** ativar registro em `auditLog` para ações sensíveis
- **3.7.8:** testes E2E de isolamento

### 9.7 Pós-multi-tenant

- **Fase 4 (Validação comercial):** trazer 3-5 condomínios pagantes para validar modelo
- **Fase 5 (Landing comercial):** construir `soluteg.com.br` no estilo SaaS
- **Migração WhatsApp para Business API oficial** (quando viável)
- **Backup automatizado** (S3 ou similar)
- **Monitoramento** (Sentry, Better Uptime, etc)
- **Tests:** quase zero hoje — adicionar vitest para regressão

---

## 10. Dívida Técnica Conhecida

### 10.1 Bagunça nas migrations

Existe duas pastas com migrations SQL:
- `drizzle/` (raiz) — migrations geradas pelo Drizzle Kit + alguns SQL manuais
- `drizzle/migrations/` — SQL manuais organizados (recentes)

**Problema:** numeração colide entre as duas pastas. Existem pares de arquivos com mesmo prefixo numérico (`0030_careless_vermin.sql` + `0030_work_order_technician_flow.sql`, idem `0032`, `0033`). O Drizzle Kit só "enxerga" os do `_journal.json` — todas as migrations manuais são invisíveis para ele.

**`__drizzle_migrations` table está vazia** no banco. Nenhuma migration foi aplicada via `drizzle-kit migrate` — sempre aplicada manualmente via SQL.

**Consequências:**
- `drizzle-kit push` é perigoso (tentaria reaplicar tudo)
- Histórico de aplicação só existe na mente do desenvolvedor
- Risco de pular migration ao subir produção

**Plano:** consolidar tudo em `drizzle/migrations/` com numeração linear. Registrar no journal as que foram aplicadas. Fazer em sub-fase dedicada (não bloqueante para multi-tenant).

### 10.2 Sem testes automatizados

Não há suite de testes. Bugs são detectados em staging ou produção. Para multi-tenant, isso é particularmente arriscado — vamos precisar adicionar pelo menos testes de isolamento (tenant A não vê tenant B) na sub-fase 3.7.8.

### 10.3 WhatsApp Web.js frágil

Bugs intermitentes:
- `detached Frame` — Puppeteer perde referência, requer restart do PM2
- `No LID for user` — algum problema interno do WhatsApp, intermitente
- Sessão expira sem aviso, requer QR code novamente

**Plano:** migrar para WhatsApp Business API oficial quando houver receita.

### 10.4 Backup manual

Não há cron de backup automatizado. Backups são feitos sob demanda via `mysqldump` antes de mudanças críticas. Em caso de incidente fora dessas janelas, perda é total desde o último backup manual.

**Plano:** cron diário com retenção 30 dias, replicação para S3.

### 10.5 Frontend bundle gigante

`dist/assets/index-XXXXXXXX.js` tem 2.4MB minificado (600KB gzipped). Code splitting é warning do Vite há meses. Não é crítico (clientes carregam uma vez e cacheiam) mas atrapalha first-load mobile.

**Plano:** dynamic imports nas rotas pouco usadas (PDV, laudos).

### 10.6 Coupling JNC ↔ Soluteg

Há strings hardcoded com "JNC" em diversos arquivos:
- `server/whatsapp.ts` — número de WhatsApp da JNC, formato do litoral
- Frontend — logo JNC, cor dourada
- PDFs — header "JNC Elétrica e Bombas"

Essa dívida será paga progressivamente nas sub-fases 3.7.5 (branding dinâmico) e 3.7.6 em diante.

### 10.7 Senhas/credenciais

JWT_SECRET único para todos os papéis. Sem refresh tokens. Sem revogação ativa de sessão. Sem 2FA.

**Plano:** revisar tudo isso na Fase 4 (pré-validação comercial).

---

## 11. Padrões de Trabalho

### 11.1 Branches

```
master                    ← produção
multi-tenant              ← refactor em andamento, base para sub-fases
fix/*                     ← bugfixes urgentes, baseados em master
```

Regra: bugfix em produção SEMPRE de uma branch `fix/*` baseada em master, nunca direto da `multi-tenant`. Após merge, sincronizar `multi-tenant` com `master`.

### 11.2 Commits

Padrão `conventional commits`:
- `feat(escopo): mensagem`
- `fix(escopo): mensagem`
- `chore(escopo): mensagem`
- `docs(escopo): mensagem`

Exemplo:
```
feat(multi-tenant/3.7.1b): tabelas centrais com collation utf8mb4_bin

- Cria 5 tabelas: tenants, platformAdmins, gestors, condominiums, notificationContacts
- Todas com utf8mb4_bin consistente com tabelas de negócio
- Foreign keys com NO ACTION (soft delete via campo active)
- IDs int autoincrement
```

### 11.3 Deploy

Atualmente manual via SSH no VPS:
```bash
ssh root@vps...
cd /var/www/soluteg/backend     # produção
# ou
cd /var/www/soluteg-staging     # staging
git pull origin <branch>
pnpm install
pnpm run build
pm2 restart <process-name> --update-env
```

Sem CI/CD. Sem rollback automatizado. Em caso de problema, `git checkout <commit-anterior>` + rebuild.

### 11.4 Aplicação de migrations

Manual via `mysql` CLI ou DBeaver. Para multi-statement com Drizzle, **filtrar `statement-breakpoint`** ou aplicar via DBeaver.

Sempre fazer backup antes:
```bash
mysqldump -h 69.6.213.57 -u <user> -p \
  --routines --triggers --single-transaction --no-tablespaces \
  <database> > /var/backups/<dir>/backup-pre-<descricao>-$(date +%Y%m%d-%H%M%S).sql
chmod 600 /var/backups/<dir>/backup-pre-*.sql
```

### 11.5 Ferramentas

- **VS Code** (PC) — desenvolvimento principal, usado com extensão Claude Code para bugfixes em master
- **Antigravity** (PC) — usado especificamente para o refactor multi-tenant na branch correspondente
- **SSH/Terminal** (VPS) — deploy, migrations, ops
- **DBeaver** — inspeção e queries adhoc no banco

**Regra:** uma ferramenta de IA por contexto, não misturar.

### 11.6 Documentação

- `ROADMAP.md` — fases gerais e status
- `CLAUDE.md` — contexto persistente para sessões de IA
- `PENDENCIAS_DEPLOY_PRODUCAO.md` — lista de mudanças aplicadas em staging que precisam replicar em produção
- Este documento (`ARCHITECTURE_HANDOFF.md`) — handoff para arquitetos/devs novos

---

## 12. Pontos para Revisão Arquitetural

Pontos onde **a opinião de um arquiteto sênior pode mudar decisões**, por ordem de impacto:

### 12.1 Estratégia de isolamento de tenant (alta criticidade)

A escolha por **helper centralizado `forTenant()` + code review** vs alternativas mais fortes (Row-Level Security, ABAC com policy engine, schema-per-tenant) merece revisão. Para a escala prevista (200 tenants, 5000 condomínios) é provavelmente adequado, mas a decisão é reversível só com muito esforço depois.

Pergunta para o arquiteto: **vale a pena investir em algo mais robusto desde o início**, sabendo que isolamento errado é o pior tipo de bug em SaaS multi-tenant (vazamento entre clientes)?

### 12.2 Migrations chaos

Como descrito em 10.1, o estado das migrations é caótico. **Sugestão de plano:**
1. Pausa antes da sub-fase 3.7.2
2. Renumerar e consolidar tudo em `drizzle/migrations/`
3. Popular `__drizzle_migrations` com hashes das migrations já aplicadas
4. A partir daí, todo deploy passa por `drizzle-kit migrate`

É um trabalho de 1-2 dias de risco médio. Vale fazer agora ou postergar para depois do multi-tenant?

### 12.3 Sem testes automatizados

A ausência de testes é dívida séria. Conforme o sistema cresce, **regressões silenciosas ficam cada vez mais prováveis**.

Pergunta: começar a adicionar testes durante o refactor multi-tenant (mais devagar mas mais seguro) ou postergar para a Fase 4?

### 12.4 Autenticação

JWT único, sem refresh, sem revogação ativa, sem 2FA. Para um produto que vai vender a empresas, é frágil.

Plano sugerido (não confirmado): adicionar refresh tokens + tabela `revokedTokens` + opcionalmente 2FA TOTP. Estimativa: 1-2 semanas.

### 12.5 Observabilidade zero

Sem Sentry, sem logs estruturados, sem métricas. Problemas em produção são detectados quando um cliente reclama.

Plano sugerido: Sentry (free tier suficiente) + alguns dashboards básicos (Better Uptime, Plausible).

### 12.6 WhatsApp Web.js

Não-oficial, frágil, risco de banimento. Continuamos apostando nele porque funciona e é grátis. Mas **antes da validação comercial seria prudente ter plano B operacional** (mesmo que custe dinheiro).

Sugestão: já fazer integração com Twilio ou Z-API como fallback, ativado apenas se WhatsApp Web cair.

### 12.7 Frontend bundle

2.4MB JS é muito para um SaaS B2B. Não bloqueia mas vai virar reclamação de cliente em algum momento.

### 12.8 LGPD

Hoje há campos de PII (nome, telefone, email, endereço) sem qualquer estratégia de criptografia em repouso, anonimização ou auditoria de acesso.

**Plano:** revisar antes do piloto comercial. Considerar:
- Criptografia AES-256-GCM em CPF/CNPJ (se forem armazenados)
- Política de retenção (90 dias para logs, X anos para OS, etc)
- Termo de uso + política de privacidade publicados
- DPO formal (Thiago seria o DPO inicialmente)

---

## 13. Apêndice: Glossário e Referências

### 13.1 Glossário

- **OS** — Ordem de Serviço (tabela `workOrders`)
- **Orçamento** — proposta comercial pré-OS (tabela `budgets`)
- **Gestor** — síndico, administradora ou similar (cliente "tipo manager")
- **Condominium** — lugar físico atendido
- **Tenant** — empresa cliente do Soluteg (JNC é o primeiro)
- **PlatformAdmin** — dono da plataforma Soluteg (não confundir com admin de tenant)
- **NotificationContact** — técnico avulso do Cenário B (não loga, só recebe alertas)
- **Cenário A** — B2B clássico: empresa de serviços contrata Soluteg para gerenciar seus condomínios
- **Cenário B** — B2C direto: síndico contrata Soluteg, indica técnico avulso de sua confiança
- **Sensor de caixa d'água** — ESP32 + HC-SR04 medindo distância, publicando via MQTT
- **PDV** — Ponto de Venda (vendas avulsas no balcão da JNC, tabelas `sales`/`saleItems`)
- **Laudo** — relatório técnico formal (vistorias, perícias) — tabelas `laudos`, `laudoFotos`, etc

### 13.2 Arquivos importantes do repo

```
ROADMAP.md                          ← visão geral de fases
PENDENCIAS_DEPLOY_PRODUCAO.md       ← o que precisa replicar em prod
CLAUDE.md                           ← contexto para IAs
ARCHITECTURE_HANDOFF.md             ← este documento

drizzle/schema.ts                   ← schema canônico (TypeScript)
drizzle/0033_giant_tomorrow_man.sql ← migration multi-tenant
drizzle/migrations/0042_*.sql       ← collation fix
drizzle/meta/_journal.json          ← histórico Drizzle Kit

server/index.ts                     ← bootstrap Express
server/lib/environment.ts           ← guards de ambiente
server/whatsapp.ts                  ← integração WhatsApp Web.js
server/mqttService.ts               ← integração MQTT
server/budgetsDb.ts                 ← módulo de orçamentos (onde o bug 51a18a7 estava)
server/routers/budgets.router.ts    ← router tRPC de orçamentos

src/                                ← frontend React
src/lib/offlineDB.ts                ← IndexedDB do portal técnico
src/hooks/useAutoSync.ts            ← sincronização offline
```

### 13.3 Comandos comuns

**Backup:**
```bash
mysqldump -h 69.6.213.57 -u <user> -p \
  --routines --triggers --single-transaction --no-tablespaces \
  <database> > /var/backups/<dir>/backup-<descricao>-$(date +%Y%m%d-%H%M%S).sql
```

**Deploy staging:**
```bash
cd /var/www/soluteg-staging
git pull origin multi-tenant
pnpm install
pnpm run build
pm2 restart soluteg-staging --update-env
```

**Deploy produção:**
```bash
cd /var/www/soluteg/backend
git pull origin master
pnpm install
pnpm run build
pm2 restart soluteg-sistema --update-env
```

**Aplicar migration:**
```bash
# Sem statement-breakpoint (multi-statement)
grep -v "statement-breakpoint" <arquivo>.sql | mysql -h ... -u ... -p <database>

# Single statement
mysql -h ... -u ... -p <database> < <arquivo>.sql

# Via comando direto
mysql -h ... -u ... -p <database> -e "ALTER TABLE ..."
```

### 13.4 Variáveis de ambiente importantes

```env
# Banco
DB_HOST=69.6.213.57
DB_NAME=d5ea2e96_tst              # ou d5ea2e96_solutegdb em prod
DB_USER=d5ea2e96_id_rsa           # ou d5ea2e96_soluteg em prod
DB_PASS=<senha>
DB_PORT=3306

# Servidor
PORT=3001                          # staging; produção é 3000 (ou unset)

# Flags de isolamento (apenas staging)
MQTT_DISABLED=true
WHATSAPP_DISABLED=true

# JWT
JWT_SECRET=<256 bits hex>

# Cloudinary
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...

# Push (VAPID)
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:contato@soluteg.com.br

# SMTP (fallback)
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
```

### 13.5 Contatos e responsabilidades

- **Thiago** — único desenvolvedor, owner da JNC, owner do Soluteg
- **WhatsApp da JNC** — `(13) 98164-8402` — uso comercial + auth WhatsApp Web.js
- **Email comercial** — `contato@soluteg.com.br`
- **Hosting** — Hostgator (VPS Linux + MySQL)
- **DNS** — gerenciado no painel do Hostgator
- **GitHub** — `https://github.com/SistemaSoluteg/soluteg-novo1` (privado; transferido de `JncBombas`)

---

## Encerramento

Este documento reflete o estado em **21 de agosto de 2026**. À medida que o multi-tenant avança e novas decisões são tomadas, este documento **deve ser atualizado** — preferencialmente na mesma branch onde a mudança acontece.

Para qualquer dúvida ou sugestão, ver o `ROADMAP.md` para contexto de prioridades, ou abrir issue no GitHub.

**Próximo marco:** Cutover de produção. As sub-fases 3.7.2 (isolamento de queries — 9 routers) e 3.7.1f (NOT NULL + FKs + rotação do `JWT_SECRET`) já estão **concluídas e validadas em staging**; produção ainda não recebeu nenhuma migração multi-tenant. O cutover é um evento único, com backup e janela de baixo uso: merge `multi-tenant → master` → `mysqldump` → migrações de schema → migração de dados (criar tenants + carimbar `tenantId=1`) → `deploy-app` → backfill de residuais → ALTERs da 3.7.1f (exceto `notificationLogs` e `waterTankSensors` — ver NOTIF-01/LOCK-02) → rotação do `JWT_SECRET`. Base para o runbook: [`PLANO_3.7.1f.md`](./PLANO_3.7.1f.md) e [`PENDENCIAS_DEPLOY_PRODUCAO.md`](./PENDENCIAS_DEPLOY_PRODUCAO.md).
