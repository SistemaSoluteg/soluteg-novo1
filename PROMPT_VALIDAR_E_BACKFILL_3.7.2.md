# Prompt — Validar últimos commits da 3.7.2 + estender o script de backfill (pré-3.7.1f)

> Cole no Claude do terminal (VS Code), branch `multi-tenant`. Baseline do `tsc` é **32**.

Contexto: `laudos`, `adminMetrics` (SEC-01), SSE `/api/water-tank-sse`, `pdvProcedure` e `pushSubscriptions` foram commitados e deployados, mas **sem ghost-probe + regressão registrados** como nas levas anteriores. E o `scripts/backfill-tenant-null.ts` só cobre laudos+pushSubscriptions. Duas frentes.

## PARTE A — Validar em staging (mesma técnica das levas anteriores)

Rodar contra o banco `_tst` (servidor local × `_tst`, HTTP real com JWT; ou via `tst.soluteg.com.br` se já deployado). Limpar toda massa sintética ao final.

### A1. `laudos` (o mais importante — router complexo, usado em campo)
- **Ghost-probe:** semear um laudo sob o tenant 2 (`INSERT INTO laudos (tenantId, numero, tipo, titulo, status, criadoPor, criadoPorTipo) VALUES (2, 'GHOST-LAU-T2', 'inspecao_predial', 'FANTASMA', 'rascunho', 1, 'admin')` — ajustar colunas NOT NULL conforme o schema). Logado como admin do JNC: não pode aparecer em `laudos.list`, nem abrir por `laudos.getById` (→ NOT_FOUND). Testar também um sub-recurso: `laudos.addFoto`/`updateFoto` com `laudoId`/foto do tenant 2 → NOT_FOUND.
- **FK-do-input:** `laudos.create` com `clienteId` de um cliente do tenant 2 → NOT_FOUND; `atribuirTecnico` com `tecnicoId` de outro tenant → NOT_FOUND.
- **Regressão JNC (fluxo real):** criar laudo → adicionar foto + medição + citação → atribuir técnico → gerar PDF. E, logado como **técnico**, confirmar que ele só vê os laudos dele (`listTecnico`/`getByIdTecnico`).

### A2. SSE `/api/water-tank-sse` (risco de regressão silenciosa)
- Abrir o portal do cliente (logado) numa caixa com sensor → confirmar que **o nível atualiza em tempo real** (o `EventSource` precisa mandar o cookie `client_token`; same-origin manda por padrão, mas confirmar que não quebrou).
- Bater `GET /api/water-tank-sse` **sem** cookie → deve dar 401 (antes qualquer um assinava).

### A3. `adminMetrics` (SEC-01)
- Dashboard do gestor mostra os números certos (clientes/OS abertas/documentos do tenant).
- `GET /api/admin-metrics?adminId=1` (rota antiga) → deve dar **404** (foi removida).

### A4. `pdvProcedure`
- PDV do tenant 1 (JNC) funciona normal (regressão). (Não há tenant 2 com PDV pra testar o FORBIDDEN, mas confirmar que o gate não quebrou o fluxo do tenant 1.)

## PARTE B — Estender `scripts/backfill-tenant-null.ts` para ser o script único da 3.7.1f

Hoje ele só tem regra determinística para **laudos** (+ sub-tabelas) e **pushSubscriptions**. Adicionar as regras das levas anteriores — todas têm FK-pai clara, então o `tenantId` é derivável sem ambiguidade:

- **Sub-tabelas de OS** → tenant da OS pai:
  `workOrderTasks`, `workOrderMaterials`, `workOrderAttachments`, `workOrderComments`, `workOrderTimeTracking` → `UPDATE x JOIN workOrders wo ON wo.id = x.workOrderId SET x.tenantId = wo.tenantId WHERE x.tenantId IS NULL AND wo.tenantId IS NOT NULL`.
- **Checklists:** `inspectionTasks` → via `workOrders` (workOrderId); `checklistInstances` → via `inspectionTasks` (inspectionTaskId).
- **Documentos:** `clientDocuments` → via `clients` (clientId).
- **Caixa d'água:** `waterTankMonitoring`/`waterTankAlertLog`/`waterTankFaultLog` → via `waterTankSensors` (sensorId) ou `clients` (clientId); `waterTankSensors` (atribuídos) → via `clients` (clientId). **Pendentes** (`clientId IS NULL`) ficam com `tenantId` NULL de propósito — deixar de fora.
- **Budgets sub-tabelas** (se acusarem NULL): `budgetItems`/`budgetHistory`/`budgetAttachments` → via `budgets` (budgetId).

Manter o padrão do script: dry-run por padrão (só reporta contagens), `--apply` para executar, `assertStagingEnvironment()`, e as tabelas genuinamente ambíguas (ex.: `configuracoesTecnico`, laudo residual sem cliente/OS) apenas **reportadas** para decisão manual. O objetivo é: rodar o script em produção antes da 3.7.1f e zerar todos os `tenantId IS NULL` deriváveis de uma vez, de forma auditável.

## Validação da Parte B
Rodar `pnpm tsx scripts/backfill-tenant-null.ts` (dry-run) no staging e conferir que ele **reporta** as novas tabelas; depois `--apply` e confirmar `COUNT(tenantId IS NULL) = 0` nas tabelas deriváveis (só sobra o que é NULL por design — sensores pendentes). `tsc` 32.

## Ao final
Trazer o diff do script + o resultado dos testes da Parte A pro Thiago. Com A e B fechados, a 3.7.2 fica **plenamente validada** e o backfill pronto para a 3.7.1f.
