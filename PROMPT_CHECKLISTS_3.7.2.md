# Prompt — Sub-fase 3.7.2 (Escala, router 5/N): isolar `checklists`

> Cole para a IA do terminal (Claude Code no VS Code), branch `multi-tenant`.
> Referência de estilo: `budgets.router.ts` / `workOrders.router.ts` (comentários `// GUARDA:`, `// GLOBAL POR DESIGN`).

## Contexto e diagnóstico (já auditado — não reconfirmar)

`checklists.router.ts` tem 3 sub-routers e **hoje nenhum tem checagem de tenant**. Estrutura das tabelas (já verificada no schema):
- **`checklistTemplates` NÃO tem coluna `tenantId`** → é **catálogo global** (bomba, gerador, etc.), compartilhado por todos os tenants. Os endpoints de template ficam **globais por design**.
- **`inspectionTasks`** tem `tenantId` + `workOrderId` (NOT NULL). Dado de tenant.
- **`checklistInstances`** tem `tenantId` + `inspectionTaskId` + `templateId` (NOT NULL). Dado de tenant.

**Escrita das tabelas de checklist acontece em 3 lugares** (a lição do workOrders — mexer nas funções compartilhadas obriga atualizar todos):
1. `checklists.router.ts` (admin) — o alvo principal.
2. `technicianPortal.router.ts → checklists.addChecklist` (técnico em campo) — chama `createInspectionTask` + `createChecklistInstance` (linhas ~441-443). **Já tem controle de posse** (`getWorkOrderByIdForTechnician(workOrderId, ctx.technicianId)` + confere que o checklist pertence à OS), então NÃO precisa de guarda de tenant nova — só precisa **passar `ctx.tenantId`** nas duas chamadas de criação.
3. `monthlyOsJob.ts` (cron) — chama `createInspectionTask` (2x, linhas ~71 e ~152) + `createChecklistInstance` (2x, ~83 e ~157). Precisa passar o `tenantId` (o `client` já é buscado nessa função e tem `client.tenantId` após o fix anterior; use-o).

Leitores read-only (guardados a montante, não mexer): `pdfGenerator.ts`, `iaChecklists.ts`, `iaWorkOrders.ts`.

`getInspectionTaskById` e `getChecklistInstanceById` já existem e retornam a linha completa (incluindo `tenantId`, `workOrderId`, `inspectionTaskId`) — **não precisa criar helper novo** (diferente do budgets/workOrders).

## ⚠️ Fronteira global — templates

`templates.list`/`getById`/`getBySlug` (no `checklists.router`) e `listTemplates` (no `technicianPortal`) leem o catálogo global `checklistTemplates` (sem `tenantId`). **Permanecem globais — NÃO adicionar guarda de tenant.** Comentar como "GLOBAL POR DESIGN: catálogo de templates compartilhado entre tenants". O `templateId` vindo do input nas instâncias também é global (qualquer tenant usa qualquer template) — não precisa de checagem de posse de tenant, no máximo checar existência (opcional).

## O que fazer — `checklists.router.ts` (Método B, guardas de posse)

Padrão: validar posse **antes** de ler/escrever. Como `inspectionTasks` e `checklistInstances` terão `tenantId` confiável (carimbo na escrita + backfill), a guarda pode checar o `tenantId` do próprio registro. Para endpoints chaveados por `workOrderId`, validar via a OS (cujo `tenantId` já é confiável) usando `workOrdersDb.getWorkOrderById`.

### `inspectionTasks`
- `create` (recebe `workOrderId`): validar posse da OS — `const os = await workOrdersDb.getWorkOrderById(input.workOrderId); if (!os || os.tenantId !== ctx.tenantId) throw NOT_FOUND;` — e **carimbar `tenantId`** no `createInspectionTask` (ver mudança na assinatura abaixo).
- `listByWorkOrder` (recebe `workOrderId`): mesma validação de posse da OS antes de listar.
- `getById`, `getFull`, `updateStatus`, `complete`, `delete` (recebem `id` da task): buscar `getInspectionTaskById(id)`, guarda `task.tenantId !== ctx.tenantId → NOT_FOUND` antes de agir.

### `instances`
- `create` (recebe `inspectionTaskId` + `templateId`): validar posse da **task pai** — `getInspectionTaskById(inspectionTaskId)`, guarda de `tenantId`. `templateId` é global (sem checagem de tenant). Carimbar `tenantId` no `createChecklistInstance`.
- `listByTask` (recebe `inspectionTaskId`): guarda via task pai.
- `listByWorkOrder` (recebe `workOrderId`): validar posse da OS via `getWorkOrderById`.
- `getById`, `getWithTemplate`, `updateResponses`, `update`, `delete`, `suggestConclusion` (recebem `id` da instância): buscar `getChecklistInstanceById(id)`, guarda `instance.tenantId !== ctx.tenantId → NOT_FOUND`.

## `checklistsDb.ts` — assinaturas + carimbo + fail-closed

- `createInspectionTask(data)`: adicionar `tenantId: number` ao `data` e ao `.values(...)`. Guarda fail-closed no início (lança se `tenantId` ausente), igual `createWorkOrder`/`createBudget`.
- `createChecklistInstance(data)`: idem — `tenantId: number` no `data` e no insert, fail-closed.

Atualizar **todos os 3 grupos de chamadores** dessas funções:
- `checklists.router` → passar `ctx.tenantId`.
- `technicianPortal.router → addChecklist` → passar `ctx.tenantId` (nas duas chamadas). Sem outra mudança nesse router.
- `monthlyOsJob.ts` → passar o `tenantId` do cliente (`client.tenantId`; se ausente, o mesmo tratamento fail-closed já usado lá — pular/lançar conforme o caso, coerente com o que já existe na função).

## Backfill (staging, antes de validar)

Registros de checklist criados antes deste deploy têm `tenantId=NULL` e sumiriam das guardas. Backfill (tudo é JNC/tenant 1):
```sql
SELECT COUNT(*) FROM inspectionTasks WHERE tenantId IS NULL;
SELECT COUNT(*) FROM checklistInstances WHERE tenantId IS NULL;
UPDATE inspectionTasks    SET tenantId = 1 WHERE tenantId IS NULL;
UPDATE checklistInstances SET tenantId = 1 WHERE tenantId IS NULL;
```
(Anotar em `PENDENCIAS_DEPLOY_PRODUCAO.md` que produção precisa do mesmo backfill dessas 2 tabelas antes da 3.7.1f.)

## Fora do escopo
- Não isolar o `technicianPortal` (é router futuro) — só passar `ctx.tenantId` nas 2 criações.
- Não mexer em `pdfGenerator`/`iaChecklists`/`iaWorkOrders` (read-only, guardados a montante).

## Validação
1. `tsc --noEmit` — baseline 33, zero novos. Colar a contagem.
2. Ghost-probe: semear uma OS + inspectionTask + checklistInstance sob o tenant 2; logado como JNC, nenhum deles pode aparecer nem abrir por ID (`NOT_FOUND`). Templates continuam visíveis (globais).
3. Regressão JNC — **crítica, o técnico usa em campo**: no portal do técnico, numa OS `em_andamento`, adicionar checklist, preencher respostas, concluir a inspectionTask, gerar PDF. E o fluxo admin: criar inspectionTask, adicionar instância, salvar respostas.
4. Backfill aplicado, `COUNT(NULL)=0` nas duas tabelas.
5. `deploy-tst` (commit+push antes).

## Ao final
Após validar: atualizar `CLAUDE.md`, `ROADMAP.md`, `ARCHITECTURE_HANDOFF.md` (seção 8.12) e `PENDENCIAS_DEPLOY_PRODUCAO.md` (backfill das 2 tabelas). Mencionar a fronteira global dos templates e o carimbo nos 3 caminhos de escrita. Trazer o diff para revisão do Thiago antes de commitar.
