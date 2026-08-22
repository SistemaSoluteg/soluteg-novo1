# PROMPT — Encerrar sub-fase 3.7.2 (isolamento multi-tenant)

> Cole no Claude Code do VS Code. Branch `multi-tenant`. Confirme com
> `git branch --show-current` antes de tocar em qualquer coisa.
> Filosofia do projeto: passos pequenos, diagnóstico antes de solução,
> segurança em primeiro lugar. NÃO commitar/deployar sem revisão do Thiago.
> Baseline `tsc --noEmit` = 32 erros pré-existentes. Meta: zero NOVOS.

## Contexto
8 routers já isolados (technicians, clients, workOrders, budgets, checklists,
technicianPortal, documents, waterTankAdmin). Esta tarefa FECHA a 3.7.2.
Dois métodos em uso: **Método A** (filtro na query via forTenant/withTenant) e
**Método B** (guarda no router: buscar via db.ts e comparar
`registro.tenantId !== ctx.tenantId` → NOT_FOUND). Use **Método B** aqui, pois
as funções de `server/db.ts` são compartilhadas e não podem mudar de assinatura.

## FORA DE ESCOPO (registrar como dívida, NÃO tocar)
- `SEC-02` (adminId-do-body na ingestão MQTT do waterTankAdmin) — best-effort por
  design, já documentado. Não mexer.
- Sub-router `metrics` do workOrders — dívida técnica já registrada, fora do
  isolamento atual.

---

## Ordem de execução (um commit por bloco; validar cada um)

### Bloco 1 — IDOR de escrita cross-tenant em `clientProfile.uploadPhoto`
Arquivo: `server/routers/clientProfile.router.ts` (~linha 29).
Problema: `adminLocalProcedure` recebe `clientId` do input e chama
`db.updateClient(input.clientId, ...)` SEM checar posse → admin do tenant A
sobrescreve foto de cliente do tenant B (e clobra o storage `client_photo_${id}`).
Fix (Método B): antes do `storagePut`, carregar o cliente e validar posse:
```ts
const alvo = await db.getClientById(input.clientId);
if (!alvo || alvo.tenantId !== ctx.tenantId) {
  throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado" });
}
```
Manter `uploadMyPhoto` (usa `ctx.clientId`) intacto.
Validação: ghost-probe — criar cliente sob tenant 2 no staging, logar como admin
JNC (tenant 1), tentar `uploadPhoto({ clientId: <do tenant 2> })` → deve dar
NOT_FOUND. Regressão: editar foto de um cliente do próprio tenant no `EditClient`.

### Bloco 2 — SEC-01: `GET /api/admin-metrics` sem auth + adminId da query
Arquivo: `server/index.ts:683`. Rota Express SEM middleware de auth; `adminId` vem
de `req.query` → qualquer um enumera tenants (contagem de clientes/OS/documentos).
Usada por `src/pages/AdminDashboard.tsx:90` via `fetch(...?adminId=)`.
Fix: migrar para tRPC autenticado.
- Criar procedure `adminLocalProcedure` (ex.: `adminMetrics.getDashboard` ou
  dentro de um router adequado) que deriva `adminId = ctx.adminId` e filtra por
  `ctx.tenantId` (Método B — as 4 queries hoje filtram por `clients.adminId`;
  manter o filtro por admin E garantir o escopo de tenant).
- Trocar o `fetch` do `AdminDashboard.tsx` por `useQuery` tRPC. Remover o adminId
  do lado do cliente (vem do JWT).
- Remover a rota Express `/api/admin-metrics` depois que o front migrar.
Validação: `curl` na rota antiga deve 404 (removida); dashboard carrega números
corretos logado; ghost-probe: números não vazam de outro tenant.

### Bloco 3 — Faxina: remover routers boilerplate mortos `users` e `reports`
Ambos com ZERO callers no frontend (verificado), mas registrados em
`server/routers.ts` → expostos na rede. São resquício do template Manus/OAuth
(tabela `users` com `openId`/`loginMethod` — não é o auth real, que usa
admins/clients/technicians). `users.list`→`getAllUsers()` global;
`users.delete`/`updateRole` destrutivos e alcançáveis por qualquer token.
Fix: remover os arquivos `server/routers/users.router.ts` e
`server/routers/reports.router.ts`, e as linhas de import/registro em
`server/routers.ts` (`reports: reportsRouter`, `users: usersRouter`).
Depois, `grep` pelas funções de db que ficaram sem caller (`getAllUsers`,
`deleteUser`, `updateUserRole`, `getReportsByUserId`, `getReportById`,
`createReport`, `updateReport`, `deleteReport`) e remover as órfãs de `db.ts`
(confirmar por grep, uma a uma, que ninguém mais usa). NÃO dropar as tabelas
`users`/`reports` no banco (só código). `tsc --noEmit` sem novos erros.

### Bloco 4 — Isolar o router `laudos` (9º router — Método B)
Arquivo: `server/routers/laudos.router.ts` (41 endpoints, hoje 0 guardas de
tenant). Tabelas com `tenantId`: `laudos`, `laudoFotos`, `laudoMedicoes`,
`laudoCitacoes`, `laudoTecnicos`. Passos:
1. Em TODO endpoint que carrega por id (`getLaudoById`, `getLaudoFotoById`,
   `getLaudoCitacaoById`, etc.), adicionar guarda de posse:
   `if (!laudo || laudo.tenantId !== ctx.tenantId) throw NOT_FOUND`.
   Para sub-recursos (foto/citação/medição), validar via o laudo pai
   (`getLaudoById(foto.laudoId)` → checar tenant), como já é feito parcialmente.
2. Nos `createLaudo`/`createLaudoX`, carimbar `tenantId: ctx.tenantId`
   (fail-closed: se `ctx.tenantId` faltar, lançar erro — NUNCA gravar NULL).
   Fazer `grep` por TODOS os call sites de criação dessas tabelas (incluindo
   fora do router, se houver job/rota Express) e cobrir todos.
3. Validar toda FK vinda do input (`technicianId`, `clientId` se houver) contra
   o tenant, não só o registro principal.
4. `getConfiguracoesTecnico` / catálogos (`laudoNormas` — SEM tenantId): se forem
   catálogo compartilhado, comentar "GLOBAL POR DESIGN" e não guardar.
Validação: ghost-probe — criar laudo sob tenant 2, confirmar invisível pro admin
JNC em list/getById/update/delete e nos sub-recursos; regressão do fluxo de laudo
do próprio tenant. Conferir 0 laudos com `tenantId IS NULL` no staging após criar.

### Bloco 5 — Portão de tenant no módulo PDV (feature exclusiva do tenant 1 / JNC)
Decisão de produto: o PDV é e continuará **exclusivo do tenant 1 (JNC)** — não vai
ser multi-tenant. Portanto NÃO adicionar coluna `tenantId` nem migrar schema.
Problema atual: os 35 endpoints do `server/routers/pdv.router.ts` usam
`adminLocalProcedure` sem NENHUMA checagem de tenant → admin de qualquer tenant
futuro poderia ler/alterar vendas, produtos e clientes da JNC.
Fix (portão de autorização, ponto único):
1. Em `server/_core/trpc.ts` (ao lado do `adminLocalProcedure`, linha ~48), criar:
   ```ts
   // PDV é exclusivo do tenant 1 (JNC). Ver ARCHITECTURE_HANDOFF seção de dívida.
   export const PDV_TENANT_ID = 1;
   export const pdvProcedure = adminLocalProcedure.use(({ ctx, next }) => {
     if (ctx.tenantId !== PDV_TENANT_ID) {
       throw new TRPCError({ code: "FORBIDDEN", message: "Módulo indisponível para este tenant" });
     }
     return next();
   });
   ```
   (Constante nomeada, não número mágico espalhado — reduz o coupling hardcoded.)
2. Trocar os 35 `adminLocalProcedure` do `pdv.router.ts` por `pdvProcedure`.
   Grep de sanidade: `grep -c "adminLocalProcedure" server/routers/pdv.router.ts`
   deve ir a 0 (ou só o import, que também troca).
3. Confirmar por grep que NÃO há rota Express `/api/pdv*` nem job de PDV fora do
   router (verificado hoje: não há — mas reconfirmar).
Validação: logar como admin do tenant 2 no staging → qualquer `trpc.pdv.*` deve
dar FORBIDDEN; logar como admin JNC (tenant 1) → PDV funciona normal (regressão:
listar produtos, abrir uma venda, um relatório).

### Bloco 6 — Confirmar `pushSubscriptions` e `waterTankMonitoring` (posse)
Não parecem vazar (escopados por `ctx.clientId`/`ctx.technicianId`), mas AUDITAR:
- `pushSubscriptions.ts`: já usa userId/userType do ctx. Confirmar que nenhum
  endpoint aceita userId do input. A tabela tem coluna `tenantId` — carimbar
  `ctx.tenantId` nos inserts (fail-closed) e comentar o porquê.
- `waterTankMonitoring.router.ts`: confirmar que toda leitura/escrita é escopada
  por `ctx.clientId` (portal do cliente) e não por id do input sem guarda.
  A metade admin é o `waterTankAdmin` (já isolado). Ghost-probe se houver
  qualquer caminho por id de input. A rota SSE `/api/water-tank-sse?clientId=` em
  `server/index.ts` merece um olhar — confirmar que não vaza leitura de outro
  tenant (o clientId da query deve casar com a sessão/tenant).
Se algum for global por design (SSE público, etc.), comentar explicitamente.

### Bloco 7 — Backfill final `tenantId IS NULL` + varredura de writes
Antes de declarar a 3.7.2 fechada:
1. Rodar no STAGING (`assertStagingEnvironment()`): para cada tabela operacional
   com `tenantId`, `SELECT COUNT(*) WHERE tenantId IS NULL`. Reportar por tabela.
2. Backfill dos NULLs remanescentes para o tenant correto (derivar via join com a
   entidade pai — ex.: laudo.tenantId a partir do workOrder/cliente; documentar
   a regra de cada backfill). PDV fica de fora (sem coluna, por design).
3. `grep` final por caminhos de escrita sem `tenantId` (padrões `createX(` sem
   prefixo, `app.post`/`app.get` em `server/index.ts`) nas tabelas isoladas nesta
   leva. Confirmar 0 novos NULLs após um ciclo de uso no staging.

---

## Rito de fechamento
- `tsc --noEmit` → comparar com baseline 32, zero novos.
- Trazer `git diff` para o Thiago revisar ANTES de commitar (um commit por bloco:
  `feat(multi-tenant/3.7.2): ...` / `fix(...)` / `chore(cleanup): ...`).
- Após revisão: commit + push + `deploy-tst` + validação em staging (ghost-probe
  por router, curl na rota unauth, portão do PDV, regressão dos fluxos).
- Atualizar docs em commit final:
  - `ROADMAP.md` — 3.7.2 concluída.
  - `ARCHITECTURE_HANDOFF.md` — seção 8 (laudos isolado + hardening + portão PDV);
    seção de dívida: **PDV é tenant-1-only por decisão de produto, protegido por
    `pdvProcedure` (sem tenantId no schema, por design)**; SEC-01 fechado,
    SEC-02 aberto por design.
  - `CLAUDE.md` seção 2 (Estado atual → 3.7.2 concluída, próxima é 3.7.1f).
  - `PENDENCIAS_DEPLOY_PRODUCAO.md` — remoção da rota `/api/admin-metrics`, novos
    endpoints tRPC, backfills a replicar em produção.
- Registrar que o sub-router `metrics` do workOrders segue como dívida rastreada.
- Após 3.7.2 fechada, a próxima fase é **3.7.1f** (NOT NULL + FKs + índices +
  rotação JWT), precedida do backfill final de `tenantId IS NULL`.
```
