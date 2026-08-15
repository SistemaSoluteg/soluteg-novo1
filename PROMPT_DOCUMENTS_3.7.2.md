# Prompt — Sub-fase 3.7.2 (router 7/N): isolar `documents`

> Cole no Claude do terminal (VS Code), branch `multi-tenant`. Referência: `budgets`/`workOrders` (Método B, `// GUARDA:`, fail-closed).

## Contexto e diagnóstico (já auditado — não reconfirmar)

Uma tabela só: **`clientDocuments`** (tem `tenantId`, `clientId`, `adminId`). É tocada por **3 routers + 1 rota Express**, com vários IDORs e filtro por `adminId` (deveria ser tenant). Todas as funções de acesso estão em `server/db.ts`, compartilhadas → **Método B** (guarda no router).

**Superfície completa:**

`server/routers/documents.router.ts` (`documents.*`):
- `list` (`protectedClientProcedure`): `getDocumentsByClientIdWithFilters({...input, clientId: ctx.clientId})` — escopado pelo cliente logado, **já seguro** (um cliente pertence a um tenant). Deixar como está (opcional: passar `ctx.tenantId` defensivamente).
- `listAll` (`adminLocalProcedure`): `getAllDocumentsWithFilters({...input, adminId: ctx.adminId})` — **filtra por adminId, vaza entre tenants**. Trocar para filtrar por `ctx.tenantId`.
- `create` (`adminLocalProcedure`): `createClientDocument({...input, adminId: ctx.adminId})` — **não valida que `clientId` (do input) é do tenant** e **não carimba `tenantId`**.
- `delete` (`adminLocalProcedure`): `deleteClientDocument(input.id)` — **IDOR, sem guarda**.
- `getById` (`adminLocalProcedure`): `getDocumentById(input.id)` — **IDOR, sem guarda**.

`server/routers/adminDocuments.router.ts` (`adminDocuments.*`):
- `list`: `getDocumentsByAdminId(ctx.adminId)` — por adminId, trocar para tenant.
- `update`: `updateDocument(id, ...)` — **IDOR**.
- `delete`: `deleteDocument(id)` — **IDOR**.

`server/routers/adminProfile.router.ts` → sub-router `adminProfile.adminDocuments.*` (**duplicata** do anterior, também vivo, registrado na linha ~70):
- `list`: `getDocumentsByAdminId(ctx.adminId)` — por adminId, trocar para tenant.
- `update`: `updateDocument` — **IDOR**.
- `delete`: `deleteDocument` — **IDOR**.
- `updateFile`: `updateDocumentFile(id, fileUrl)` — **IDOR**.

`server/index.ts` (rota Express legada, ~linha 521):
- `DELETE /api/client-documents/:id` → `deleteClientDocument(id)`, atrás de `requireAdminAuth` (sem tenant) — **IDOR via Express**. (Confirmar se o frontend ainda usa; independentemente, fechar a guarda.)

## O que fazer

### 1. `server/db.ts` — funções de leitura por tenant + fail-closed no create
- `getDocumentsByAdminId(adminId)` → passar a filtrar por **tenant**. Como é chamada por `adminDocuments.list` e `adminProfile.adminDocuments.list`, renomear para `getDocumentsByTenant(tenantId)` (filtro `eq(clientDocuments.tenantId, tenantId)`) e atualizar os 2 chamadores; **ou** trocar a assinatura para receber `tenantId`. Escolha o que for mais limpo, mas **atualize os dois call sites**.
- `getAllDocumentsWithFilters`: trocar o filtro `adminId` por `tenantId` (novo campo obrigatório no `filters`), atualizando o chamador (`documents.listAll`). O `clientId` opcional do input continua sendo um filtro **dentro** do tenant.
- `createClientDocument(document)`: guarda fail-closed no início (`if (!(document as any).tenantId) throw ...`), mesmo padrão de `createWorkOrder`. Insere por spread `.values(document)`, então basta o chamador incluir `tenantId`.
- `getDocumentById` já retorna a linha completa (com `tenantId`) — usar nas guardas. Não precisa criar helper.
- `deleteClientDocument`/`deleteDocument`/`updateDocument`/`updateDocumentFile`: deletam/atualizam por id — **não mudar**; a guarda vai no chamador (router/Express).

### 2. Routers — guardas de posse (Método B)
Padrão: buscar `getDocumentById(id)`, `if (!doc || doc.tenantId !== ctx.tenantId) throw NOT_FOUND` **antes** de agir.

- `documents.getById`, `documents.delete`: adicionar a guarda.
- `documents.listAll`: passar `ctx.tenantId` (via a mudança em `getAllDocumentsWithFilters`); remover `adminId` do que é passado.
- `documents.create`: (a) validar posse do `clientId` — `getClientById(input.clientId)`, `if (!cliente || cliente.tenantId !== ctx.tenantId) throw NOT_FOUND`; (b) carimbar `tenantId` via `withTenant(ctx, {...input, adminId: ctx.adminId})`.
- `adminDocuments.list` e `adminProfile.adminDocuments.list`: usar a função tenant-scoped com `ctx.tenantId`.
- `adminDocuments.update`/`delete` e `adminProfile.adminDocuments.update`/`delete`/`updateFile`: guarda de posse antes de agir (todas são IDOR hoje).

### 3. Rota Express `DELETE /api/client-documents/:id` (server/index.ts ~521)
Mesmo padrão do fix de `GET /api/work-orders/:id`: resolver o `tenantId` do admin autenticado (do cookie `admin_token` → `SELECT tenantId FROM admins WHERE id = ?`), buscar o documento (`getDocumentById`), e só deletar se `doc.tenantId === adminTenantId` (senão 404). Se preferir, extrair o mesmo helper de resolução de tenant já usado na rota de work-orders.

## Duplicação (registrar, não necessariamente resolver agora)
- `adminDocuments.router` e `adminProfile.adminDocuments` são **idênticos** (list/update/delete). `deleteClientDocument` e `deleteDocument` no `db.ts` também fazem a **mesma coisa**. Provável que o frontend use só um caminho. **Confirmar por grep no frontend** (`trpc.adminDocuments.` vs `trpc.adminProfile.adminDocuments.` vs `trpc.documents.`) quais estão vivos; guardar todos os vivos nesta leva e **anotar a duplicação como candidata à faxina** (remover o router/função morta depois). Não remover agora para não misturar escopo.

## Backfill (staging, antes de validar)
```sql
SELECT COUNT(*) FROM clientDocuments WHERE tenantId IS NULL;
UPDATE clientDocuments SET tenantId = 1 WHERE tenantId IS NULL;
```
(Anotar `clientDocuments` no backfill de produção do `PENDENCIAS_DEPLOY_PRODUCAO.md`.)

## Validação
1. `tsc --noEmit` — **baseline agora é 32** (o fix do `osNumber` fechou 1), zero novos.
2. **Ghost-probe**: semear um `clientDocument` sob o tenant 2 (precisa de um `clientId` — pode usar o cliente fantasma do tenant 2, ou `clientId` fictício + `tenantId=2`); logado como admin do JNC: não pode aparecer em `documents.listAll`/`adminDocuments.list`, nem abrir por `getById`, nem deletar por ID (tRPC e a rota Express `DELETE /api/client-documents/<id>`) → tudo NOT_FOUND/404. Portal do cliente (`documents.list`) continua mostrando os docs do próprio cliente.
3. **FK-do-input**: `documents.create` com `clientId` de um cliente do tenant 2 → NOT_FOUND (pode testar via DevTools, como no budgets).
4. **Regressão JNC**: no admin, listar/criar/editar/deletar documento de um cliente; no portal do cliente, listar os documentos.
5. Backfill aplicado, `COUNT(NULL)=0`.

## Ao final
Após validar: atualizar `CLAUDE.md`, `ROADMAP.md`, `ARCHITECTURE_HANDOFF.md` (seção 8.14) e `PENDENCIAS_DEPLOY_PRODUCAO.md` (`clientDocuments` no backfill). Registrar a duplicação (`adminDocuments` vs `adminProfile.adminDocuments`, `deleteClientDocument` vs `deleteDocument`) como candidata à faxina. Trazer o diff pro Thiago revisar antes de commitar.
