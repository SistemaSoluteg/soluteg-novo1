# Prompt — Fechar gap de FK-vinda-do-input no `workOrders.router.ts` (mesma leva do budgets)

> Roda junto com o isolamento de `budgets`, no mesmo ciclo de staging. Branch `multi-tenant`.

## Contexto

O isolamento de `workOrders` (já commitado e em staging) carimba corretamente o `tenantId` da OS a partir do `ctx`, e guarda a posse da OS por ID em todos os endpoints. **Mas não valida as foreign keys que vêm do input** (`clientId`, `technicianId`). Como um admin do tenant 1 consegue passar um `clientId`/`technicianId` do tenant 2, dá pra criar/atribuir referenciando registros de outro tenant — vazando nome/telefone/endereço desse cliente/técnico no registro da OS, no PDF e nas notificações WhatsApp. É a mesma classe de IDOR que foi fechada no `create` do `budgets` (guarda de posse do cliente antes de criar).

Severidade: moderada (precisa conhecer um ID de outro tenant; a OS criada fica no tenant do próprio admin), mas é vazamento de PII cross-tenant real — fechar agora em vez de deixar como dívida.

## O que fazer

Em `server/routers/workOrders.router.ts`:

### 1. `create` (~linha 41)
Antes de criar a OS, validar **posse do cliente** e, se informado, **posse do técnico**:

```ts
.mutation(async ({ input, ctx }) => {
  const workOrdersDb = await import("../workOrdersDb");

  // GUARDA: o cliente precisa pertencer ao tenant do admin logado.
  const cliente = await db.getClientById(input.clientId);
  if (!cliente || cliente.tenantId !== ctx.tenantId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado" });
  }

  // GUARDA: se um técnico foi informado, precisa pertencer ao mesmo tenant.
  if (input.technicianId) {
    const technicianDb = await import("../technicianDb");
    const tech = await technicianDb.getTechnicianById(input.technicianId, ctx.tenantId);
    if (!tech) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Técnico não encontrado" });
    }
  }

  const dataToCreate = withTenant(ctx, { ...input, adminId: ctx.adminId, scheduledDate: ... });
  ...
```
Reaproveitar o `cliente` já buscado para o `nomeCliente` da mensagem (hoje ele é buscado de novo mais abaixo — remover a segunda busca, usar o da guarda).

`getTechnicianById(id, tenantId?)` já aceita o `tenantId` opcional e filtra por tenant, retornando `undefined` se o técnico não for do tenant — usar essa forma (isso também começa a pagar a dívida do `tenantId` opcional dessa função).

### 2. `assignTechnician` (~linha 233)
Já guarda a posse da OS. Adicionar a validação de posse do técnico **antes** de atribuir:

```ts
// (após a guarda da OS já existente)
if (input.technicianId) {
  const technicianDb = await import("../technicianDb");
  const tech = await technicianDb.getTechnicianById(input.technicianId, ctx.tenantId);
  if (!tech) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Técnico não encontrado" });
  }
}
await workOrdersDb.assignTechnicianToWorkOrder(input.workOrderId, input.technicianId);
```
(`technicianId` pode ser `null` para desatribuir — nesse caso não valida, só passa adiante.)

### 3. `update` (~linha 107)
Recebe `technicianId` opcional. Já guarda a posse da OS. Se `input.technicianId` for informado (não-nulo), validar posse do técnico com o mesmo padrão acima, antes do `updateWorkOrder`.

## Fora do escopo
- Não mexer em mais nada do `workOrders` (já isolado). Só as 3 guardas de FK acima.
- Os caminhos de sistema (`monthlyOsJob`, `waterTankAlertService`, `workOrdersRecurrence`) usam relações de cliente já existentes/consistentes, não FKs vindas de input de usuário — não precisam dessa guarda.

## Validação
1. `pnpm run check` / `tsc --noEmit` — baseline 33, zero novos.
2. Ghost-probe (junto com o de budgets): logado como admin do JNC, tentar criar OS passando um `clientId` de um cliente semeado no tenant 2 → deve dar "Cliente não encontrado". Idem `technicianId` de outro tenant no `create`/`assignTechnician`.
3. Regressão: criar OS normal do JNC com cliente e técnico do próprio tenant continua funcionando.
