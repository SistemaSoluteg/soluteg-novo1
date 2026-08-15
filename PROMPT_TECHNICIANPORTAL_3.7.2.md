# Prompt — Sub-fase 3.7.2 (router 6/N): `technicianPortal` + carimbar `tenantId` nas sub-tabelas de OS

> Cole no Claude do terminal (VS Code), branch `multi-tenant`. Referência: `budgets`/`checklists` (comentários `// GUARDA:`, `// GLOBAL POR DESIGN`, fail-closed).

## Contexto (já auditado — não reconfirmar)

**O `technicianPortal` já é seguro contra cross-tenant.** Todo endpoint que toca uma OS passa por `technicianDb.getWorkOrderByIdForTechnician(workOrderId, ctx.technicianId)`, que só retorna a OS se ela estiver atribuída àquele técnico. Como um técnico pertence a um único tenant e (após o fix de FK no `assignTechnician`) só se atribui técnico do mesmo tenant da OS, o técnico nunca alcança OS de outro tenant. **Não há IDOR aqui.** Esta leva é (A) defesa-em-profundidade no portal + (B) fechar um acúmulo de `tenantId=NULL` nas sub-tabelas de OS que atravessa vários routers.

`getTechnicianByUsername` é o lookup do **login** do técnico (`server/index.ts:444`) — **fica global por design**, não guardar.

## Parte A — `technicianPortal` (defesa-em-profundidade, mudança leve)

1. **`getTechnicianById(ctx.technicianId)` → `getTechnicianById(ctx.technicianId, ctx.tenantId)`** nas 2 chamadas (`me` ~linha 11 e `tasks.toggle` ~linha 253). A função já aceita o `tenantId` opcional e filtra — começa a pagar a dívida do `tenantId` opcional.
2. **Carimbar `ctx.tenantId` nas 2 escritas** do portal (parte da Parte B): `comments.create` (~289) e `attachments.create` (~331).
3. *(Opcional, defesa-em-profundidade)* Não é obrigatório adicionar filtro de tenant em `getWorkOrderByIdForTechnician`/`getWorkOrdersByTechnicianId` — a checagem de `technicianId` já garante o tenant. **Só faça se for trivial**; se exigir mudar assinatura e vários call sites, deixe como está e comente que a fronteira de tenant é garantida pela posse do técnico.

## Parte B — carimbar `tenantId` nas 5 sub-tabelas de OS (o valor real desta leva)

As tabelas `workOrderTasks`, `workOrderMaterials`, `workOrderAttachments`, `workOrderComments`, `workOrderTimeTracking` **têm coluna `tenantId`**, mas as funções de criação no `workOrdersAuxDb.ts` **não carimbam** e **nenhum chamador passa** — as linhas nascem `tenantId=NULL`. Não é vazamento (acesso é guardado pela OS pai), mas é acúmulo de NULL que a `3.7.1f` vai ter que limpar. Fechar agora, mesmo padrão das sub-tabelas de budget/checklist.

### B1. `server/workOrdersAuxDb.ts` — fail-closed nas 5 funções
Adicionar guarda fail-closed no início de cada uma (as funções já inserem por spread `.values(obj)`, e o `Insert*` já tem `tenantId` opcional — então **não precisa mudar assinatura**, só validar e o chamador incluir `tenantId` no objeto):
- `createTask` (~21), `createMaterial` (~88), `createAttachment` (~144), `createComment` (~229), `createTimeEntry` (~283).
```ts
if (!(<param>).tenantId) {
  throw new Error("createX: tenantId é obrigatório e não foi informado.");
}
```
(mesmo padrão de `createWorkOrder`/`createInspectionTask`.)

### B2. Atualizar TODOS os 9 call sites para passar `tenantId`

`server/routers/workOrders.router.ts` (admin — todos já guardam a OS pai, `ctx.tenantId` disponível): incluir `tenantId: ctx.tenantId` no objeto passado em:
- `tasks.create` (~451): `createTask({ ...input, tenantId: ctx.tenantId })`
- `materials.create` (~587): `createMaterial({ ...input, tenantId: ctx.tenantId })`
- `attachments.create` (~700): `createAttachment({ ...input, tenantId: ctx.tenantId })`
- `comments.create` (~787): `createComment({ ...input, tenantId: ctx.tenantId })`
- `timeTracking.create` (~1215): `createTimeEntry({ ...input, tenantId: ctx.tenantId })`

`server/routers/technicianPortal.router.ts` (`ctx.tenantId` disponível):
- `comments.create` (~289): incluir `tenantId: ctx.tenantId` no objeto.
- `attachments.create` (~331): incluir `tenantId: ctx.tenantId` no objeto.

`server/routers/budgets.router.ts` (cópia de fotos do orçamento → anexos "before" da OS gerada):
- `approve` (~279, `publicProcedure`, sem `ctx`): usar `tenantId: budget.tenantId` (já disponível/selecionado).
- `generateOs` (~456, `adminLocalProcedure`): usar `tenantId: ctx.tenantId`.

> Verificar por `grep` que não há outro chamador dessas 5 funções além destes 9 (a auditoria não achou — mas confirmar após editar). Não há caminho de sistema/cron que crie esses sub-recursos.

## Backfill (staging, antes de validar)

```sql
SELECT COUNT(*) FROM workOrderTasks       WHERE tenantId IS NULL;
SELECT COUNT(*) FROM workOrderMaterials   WHERE tenantId IS NULL;
SELECT COUNT(*) FROM workOrderAttachments WHERE tenantId IS NULL;
SELECT COUNT(*) FROM workOrderComments    WHERE tenantId IS NULL;
SELECT COUNT(*) FROM workOrderTimeTracking WHERE tenantId IS NULL;

UPDATE workOrderTasks        SET tenantId = 1 WHERE tenantId IS NULL;
UPDATE workOrderMaterials    SET tenantId = 1 WHERE tenantId IS NULL;
UPDATE workOrderAttachments  SET tenantId = 1 WHERE tenantId IS NULL;
UPDATE workOrderComments     SET tenantId = 1 WHERE tenantId IS NULL;
UPDATE workOrderTimeTracking SET tenantId = 1 WHERE tenantId IS NULL;
```
(Anotar em `PENDENCIAS_DEPLOY_PRODUCAO.md`: essas 5 tabelas entram no backfill de NULLs de produção antes da 3.7.1f — provavelmente terão muitos NULLs, pois nasciam sem tenant desde sempre.)

## Validação
1. `tsc --noEmit` — baseline 33, zero novos. **Atenção:** como `tenantId` é opcional nos `Insert*`, o `tsc` NÃO pega um call site esquecido — a guarda fail-closed só estoura em runtime. Por isso a regressão abaixo é essencial.
2. **Regressão admin** (cada um cria um sub-recurso — se algum call site foi esquecido, estoura aqui): numa OS, adicionar **tarefa**, **material**, **anexo/foto**, **comentário** e **entrada de tempo**. Todos devem salvar.
3. **Regressão técnico em campo** (crítico): no portal do técnico, numa OS `em_andamento`, adicionar **foto** (attachment) e **comentário**, e marcar **tarefa** (toggle). Devem salvar.
4. **Regressão budget→OS**: aprovar um orçamento com foto (link público) e gerar OS — as fotos devem virar anexos "before" da OS sem erro.
5. **Ghost-probe** (defesa-em-profundidade, opcional): confirmar que um técnico do JNC não acessa OS de outro tenant — mas como não há dado cross-tenant no staging e a posse por `technicianId` já garante, a regressão acima é o teste que importa.
6. Backfill aplicado, `COUNT(NULL)=0` nas 5 tabelas.

## Ao final
Após validar: atualizar `CLAUDE.md`, `ROADMAP.md`, `ARCHITECTURE_HANDOFF.md` (seção 8.13) e `PENDENCIAS_DEPLOY_PRODUCAO.md` (as 5 tabelas no backfill). Registrar que o `technicianPortal` já era seguro por posse do técnico e que esta leva fechou o acúmulo de `tenantId=NULL` nas sub-tabelas de OS (achado que passou batido na isolação do `workOrders`). Trazer o diff pro Thiago revisar antes de commitar.
