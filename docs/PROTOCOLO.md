# Protocolo de Desenvolvimento — Soluteg / JNC Elétrica

> Este arquivo define as regras obrigatórias de desenvolvimento para este projeto.
> Toda tarefa — nova feature, bugfix ou refactor — deve seguir este protocolo antes de ser considerada concluída.
> O objetivo é garantir qualidade, segurança e rastreabilidade em cada entrega.

---

## 1. Segurança — Checklist Obrigatório (antes de qualquer commit)

> Segurança não é uma etapa final. É uma lente aplicada durante toda a implementação.
> Se você (dev humano ou IA) entregou código e só auditou quando questionado, o processo falhou.

### 1.1 Tipos de procedure tRPC — regra absoluta

Cada endpoint tRPC **deve** usar o procedure correto. Nunca usar `publicProcedure` sem revisar.

| Procedure | Quando usar |
|---|---|
| `adminLocalProcedure` | Qualquer ação administrativa (CRUD de OS, clientes, orçamentos, laudos, PDV, etc.) |
| `protectedClientProcedure` | Portal do cliente — `ctx.clientId` vem do JWT, nunca do input |
| `protectedTechnicianProcedure` | Portal do técnico — `ctx.technicianId` vem do JWT, nunca do input |
| `publicProcedure` | **Somente:** login, aprovação de orçamento via token opaco, consulta pública por token |

**Regra de ouro:** Se o endpoint acessa, cria ou altera dados de um usuário específico, `publicProcedure` está errado.

### 1.2 Identity — nunca confiar em IDs do input

O ID de quem está fazendo a ação **sempre** vem do contexto JWT (`ctx`), não do body/input enviado pelo frontend.

```typescript
// ❌ ERRADO — adminId vem do frontend, pode ser falsificado
.input(z.object({ adminId: z.number() }))
// ...
db.query({ adminId: input.adminId })

// ✅ CORRETO — adminId vem do JWT verificado pelo servidor
// (sem adminId no input)
// ...
db.query({ adminId: ctx.adminId })
```

### 1.3 BOLA — nunca expor ID sequencial em endpoint público

Se um endpoint público aceita um `id: z.number()` e retorna dados desse recurso, é uma vulnerabilidade BOLA (Broken Object Level Authorization). O atacante pode enumerar todos os IDs e acessar qualquer registro.

```typescript
// ❌ ERRADO — qualquer pessoa acessa qualquer orçamento
getForPortal: publicProcedure.input(z.object({ budgetId: z.number() }))

// ✅ CORRETO — acesso por token opaco (UUID, não sequencial)
getByToken: publicProcedure.input(z.object({ token: z.string() }))
```

### 1.4 Ownership check — verificar posse antes de operar

Em qualquer endpoint de leitura/escrita de um recurso específico (get por ID, update, delete), verificar que o recurso pertence ao usuário autenticado.

```typescript
// ✅ Padrão correto (technicianPortal)
const os = await getWorkOrderByIdForTechnician(input.id, ctx.technicianId);
if (!os) throw new TRPCError({ code: "NOT_FOUND" });
```

### 1.5 Upload de arquivos — whitelist de MIME type

Nunca aceitar o MIME type enviado pelo usuário sem validação.

```typescript
// ✅ Usar enum Zod para tipos permitidos
mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"])
```

### 1.6 Endpoints REST legados (`server/index.ts`)

Todos os endpoints REST devem verificar autenticação via middleware `requireAdminAuth` ou `requireClientAuth` antes de processar qualquer dado. Nenhum endpoint que retorna ou altera dados pode existir sem autenticação.

---

## 2. Padrões de Código

### 2.1 Comentários obrigatórios

Todo arquivo deve ter comentários suficientes para que um leigo consiga entender o que está acontecendo. Se um arquivo não tem comentários (ou tem poucos), comentar o arquivo inteiro antes de modificá-lo.

**O que comentar:**
- Início de cada arquivo: explicar o propósito geral
- Cada função/procedure: o que faz e qual o dado que espera
- Lógica não óbvia: regras de negócio, workarounds, invariantes importantes
- Enum values: o que cada valor representa no contexto do negócio

```typescript
// ✅ Exemplo de comentário útil
// Converte distância (cm) para percentual de nível.
// Usa distVazia e distCheia calibrados pelo admin — sem esses valores, retorna null.
function distanciaParaNivel(dist: number, sensor: Sensor): number | null { ... }
```

### 2.2 Enums Zod devem espelhar o schema Drizzle

Ao adicionar um valor novo a um `mysqlEnum` no schema, atualizar obrigatoriamente o enum `z.enum()` correspondente no router.

### 2.3 Valores monetários sempre em centavos

Todos os campos de valor (preços, totais) são armazenados em centavos no banco. Dividir por 100 apenas na camada de apresentação (PDF, frontend).

### 2.4 Datas no MySQL

Nunca passar objeto `Date` JS diretamente em queries. Usar `sql.raw()` com formato `'YYYY-MM-DD HH:MM:SS'`:

```typescript
const cutoff = sql.raw(`'${date.toISOString().slice(0, 19).replace("T", " ")}'`);
```

---

## 3. Fluxo de Trabalho com IA

> Estas regras garantem que o trabalho da IA seja previsível, seguro e rastreável.

### 3.1 Rotina de início de sessão (obrigatório)

Antes de qualquer tarefa, a IA deve:
1. Ler `project_overview.md`, `feedback_patterns.md`, `feedback_security.md` e `session_titles.md`
2. Registrar o título da sessão em `session_titles.md`
3. Verificar `PENDENCIAS.md` para contexto de dívidas técnicas em aberto

### 3.2 Checklist de entrega — toda tarefa passa por isso

Antes de informar que uma tarefa está concluída:

- [ ] Todos os novos endpoints usam o procedure correto?
- [ ] Algum ID sequencial foi exposto em endpoint público?
- [ ] `ctx.adminId`/`ctx.clientId`/`ctx.technicianId` são usados em vez do input?
- [ ] Ownership check feito em todos os recursos modificados?
- [ ] Arquivos novos/modificados estão comentados adequadamente?
- [ ] Enums Zod atualizados se o schema Drizzle mudou?
- [ ] `PENDENCIAS.md` atualizado (nova dívida identificada ou item resolvido)?
- [ ] Memória atualizada (`project_overview.md`, `feedback_patterns.md`)?

### 3.3 Commits

- Mensagens em português, formato `tipo(escopo): descrição`
- Após cada commit, executar `git push` imediatamente (usuário testa em produção via VPS)
- Incluir todos os arquivos modificados (`git add .` ou listar explicitamente)

### 3.4 Auditoria proativa de segurança

A IA deve, sem ser solicitada:
- Sinalizar qualquer vulnerabilidade identificada durante a leitura de código existente
- Auditar todo endpoint novo criado antes de fazer o commit
- Verificar `PENDENCIAS.md` no início de cada sessão e mencionar itens urgentes ao usuário

### 3.5 Atualização de memória

Atualizar os arquivos de memória **imediatamente** após cada mudança relevante, não ao final da sessão. O usuário não deve precisar perguntar "você atualizou a memória?".

---

## 4. Deploy

- Servidor de produção: VPS com comando `deploy-jnc` executado em `/var/www/soluteg/backend`
- Repositório: `JncBombas/soluteg-novo1` (atenção ao typo sem "t": `solueg-novo1`)
- O deploy no VPS faz `git pull` — por isso o `git push` deve acontecer após cada commit

---

## 5. Referência Rápida — Procedures por Router

| Router | Procedure Padrão | Observações |
|---|---|---|
| `adminAuth.*` | `adminLocalProcedure` | Exceto `login` e `requestReset` (public) |
| `clients.*` | `adminLocalProcedure` | `ctx.adminId` obrigatório |
| `workOrders.*` | `adminLocalProcedure` | Inclui todos os sub-routers |
| `checklists.*` | `adminLocalProcedure` | Todos os sub-routers |
| `budgets.*` | `adminLocalProcedure` | Exceto `getByToken` e `attachments.listByToken` |
| `laudos.*` | `adminLocalProcedure` (admin) / `protectedTechnicianProcedure` (técnico) | Procedures `*Tecnico` para técnicos |
| `technicianPortal.*` | `protectedTechnicianProcedure` | Sempre com ownership check |
| `waterTankAdmin.*` | `adminLocalProcedure` | Todos |
| `waterTankMonitoring.*` | `protectedClientProcedure` | `ctx.clientId` obrigatório |
| `pdv.*` | `adminLocalProcedure` | Todos os 40+ endpoints |
| `whatsapp.*` | `adminLocalProcedure` | Todos |
| `clientProfile.*` | `protectedClientProcedure` | `ctx.clientId` obrigatório |
| `adminProfile.*` | `adminLocalProcedure` | `ctx.adminId` obrigatório |
