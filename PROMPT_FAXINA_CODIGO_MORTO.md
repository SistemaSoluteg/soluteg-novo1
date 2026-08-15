# Prompt — Faxina de código morto (3.7.2, passada dedicada)

> Cole no Claude do terminal (VS Code), branch `multi-tenant`. **Remoção de código** — cada item foi verificado como sem caller. Rodar `tsc --noEmit` ao final (baseline **32**, zero novos) e revisar o diff com o Thiago antes de commitar. É só remoção, sem mudança de comportamento.

## ⚠️ NÃO TOCAR (verificado — é código VIVO, não morto)
- `checklists.inspectionTasks.canComplete` (endpoint) e o `areAllChecklistsComplete` do `checklistsDb`: o `canComplete` **é usado** pelo `src/components/InspectionTaskItem.tsx` (`useQuery` + `disabled={!canComplete}` no botão "Concluir Tarefa"). É um stub que sempre retorna `true`, mas está ligado na UI. **Deixar como está.**
- O botão "Concluir Tarefa" / `onCompleteTask` no frontend — vivo, não mexer.

## Itens a remover (todos verificados sem caller)

### 1. `createWorkOrder` órfã em `server/db.ts:694`
Função duplicada/legada (a real é `workOrdersDb.createWorkOrder`). Sem nenhum import no projeto. Remover a função inteira (`export async function createWorkOrder(workOrder: InsertWorkOrder) {...}`). Confirmar por grep que nada importa `createWorkOrder` de `./db` (só de `./workOrdersDb`).

### 2. Sub-router `workOrders.timeTracking.*` + funções do `workOrdersAuxDb`
Feature nunca ligada na UI (grep em `src/` por `timeTracking`/`TimeTracking` = 0) e tabela vazia. As funções do aux são chamadas **só** por este sub-router.
- Em `server/routers/workOrders.router.ts`: remover o bloco inteiro do sub-router `timeTracking: router({...})` (list/create/end/update/delete/getTotalTime, ~linhas 1190-1305).
- Em `server/workOrdersAuxDb.ts`: remover as funções que ficam sem caller após o item acima: `createTimeEntry`, `getTimeEntryById`, `getTimeEntriesByWorkOrderId`, `updateTimeEntry`, `endTimeEntry`, `getTotalTimeSpent`, `deleteTimeEntry`. Se o import de `InsertWorkOrderTimeTracking`/`workOrderTimeTracking` ficar sem uso, remover do import também.
- **Não** dropar a tabela `workOrderTimeTracking` no banco (só código; a tabela fica, vazia, sem custo).

### 3. `inspectionTasks.complete` + `completeInspectionTask`
Endpoint e função de db sem caller no frontend (a assinatura real de conclusão é do `workOrders.complete`).
- Em `server/routers/checklists.router.ts`: remover o endpoint `complete: adminLocalProcedure...` do sub-router `inspectionTasks`. **Manter** o `canComplete` (ver "NÃO TOCAR").
- Em `server/checklistsDb.ts`: remover `completeInspectionTask`. **Manter** `areAllChecklistsComplete` (usado pelo `canComplete`, que fica).

### 4. Routers de documento duplicados
Confirmado por grep que o frontend só usa `trpc.documents.*` — `trpc.adminDocuments.*` e `trpc.adminProfile.adminDocuments.*` não têm caller.
- Remover o arquivo `server/routers/adminDocuments.router.ts` e sua importação/registro em `server/routers.ts` (`adminDocuments: adminDocumentsRouter`).
- Em `server/routers/adminProfile.router.ts`: remover o `adminDocumentsSubRouter` (definição) e o `adminDocuments: adminDocumentsSubRouter` de dentro do `adminProfileRouter`. **Manter** o resto do `adminProfileRouter` (getProfile etc.).
- Em `server/db.ts`: após remover os 2 acima, ficam sem caller — remover: `getDocumentsByTenant`, `updateDocument`, `deleteDocument`, `updateDocumentFile`. **Confirmar por grep** antes de remover cada uma (o `documents.router` usa `deleteClientDocument`, `getDocumentById`, `getAllDocumentsWithFilters`, `getDocumentsByClientIdWithFilters`, `createClientDocument`, `getClientById` — esses **ficam**). `deleteClientDocument` (≡ `deleteDocument`) **fica** (é o usado pelo `documents.router` e pela rota Express).

## Método
Trabalhe item por item. Depois de cada bloco, um `grep` confirmando que o símbolo removido não tem mais referência. Ao final:
- `tsc --noEmit` — comparar com baseline **32**. Zero novos. (O TS não erra por export não usado, então o grep é a checagem real de que não sobrou caller.)
- Trazer o `git diff` para o Thiago revisar. Sem deploy/commit ainda.

## Validação em staging (após revisão + deploy)
Como é remoção de código morto, a validação é de **regressão** (nada quebrou), não ghost-probe:
- Fluxo de OS: criar/editar/concluir OS, adicionar tarefa/material/anexo/comentário. (o `timeTracking` sumiu, mas nunca teve UI.)
- Checklists: adicionar/preencher/concluir tarefa de inspeção (o botão "Concluir Tarefa" continua funcionando — `canComplete` foi mantido).
- Documentos: listar/criar/deletar no admin e no portal do cliente (só `documents.*`, que não foi tocado).

## Ao final
Atualizar o `CLAUDE.md` (seção "Dívidas técnicas") removendo os itens já limpos e **corrigindo a nota do `canComplete`** (não é morto — é UI viva). Registrar a faxina no ROADMAP.
