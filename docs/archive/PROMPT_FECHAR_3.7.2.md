# Prompt — Fechar a Sub-fase 3.7.2: último gap de isolamento (`clientProfile.uploadPhoto`)

> Cole no Claude do terminal (VS Code), branch `multi-tenant`. Baseline do `tsc` é **32**.

## Contexto (auditado — não reconfirmar)

A varredura completa dos routers terminou. Todos os que tocam dado operacional já foram isolados (8 routers), **exceto um gap pontual**: o endpoint `clientProfile.uploadPhoto`.

- `pushSubscriptions` — verificado: 100% escopado por `ctx.clientId`/`ctx.technicianId` (userId nunca vem do input). **Seguro, não mexer.**
- `reports`/`users` — sistema legado `userId` (template original), **sem caller no frontend** — candidatos a faxina, **fora deste prompt** (a remoção exige verificar o acoplamento de `ctx.user`/`auth.me`/tabela `users`; fica pra uma passada dedicada).

## O que fazer — único item

`server/routers/clientProfile.router.ts` → `uploadPhoto` (`adminLocalProcedure`): recebe `clientId` do input e chama `db.updateClient(input.clientId, { profilePhoto })` **sem validar posse** — um admin pode sobrescrever a foto de perfil de um cliente de outro tenant (IDOR, mesma classe de FK-do-input do `documents.create`).

Adicionar a guarda antes do `updateClient`:
```ts
.mutation(async ({ input, ctx }) => {
  // GUARDA: o cliente precisa pertencer ao tenant do admin logado.
  const cliente = await db.getClientById(input.clientId);
  if (!cliente || cliente.tenantId !== ctx.tenantId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado" });
  }
  // ... resto igual (storagePut + updateClient)
});
```
(`uploadMyPhoto`, `updateProfile`, `changePassword`, `getProfile` já usam `ctx.clientId` — não mexer.)

## Validação
1. `tsc --noEmit` — baseline **32**, zero novos.
2. Ghost-probe/FK: `clientProfile.uploadPhoto` com `clientId` de um cliente do tenant 2 → `NOT_FOUND` (pode testar via DevTools, como no `documents.create`).
3. Regressão: admin envia foto de perfil de um cliente do próprio tenant → funciona.

## Ao final
Com isso, a **isolação de queries da 3.7.2 fica completa** (todos os routers operacionais isolados). Atualizar `CLAUDE.md`/`ROADMAP.md`/`ARCHITECTURE_HANDOFF.md` marcando a 3.7.2 (isolamento) como **concluída** e registrando que o próximo passo é a **3.7.1f** (NOT NULL + FKs + índices + backfill final + rotação do JWT). Deixar anotado, como faxina futura separada, a remoção de `reports`/`users` legados. Trazer o diff pro Thiago revisar antes de commitar.
