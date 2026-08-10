import { eq } from "drizzle-orm";
import type { MySqlColumn } from "drizzle-orm/mysql-core";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "./context";

/**
 * 3.7.2 — Isolamento multi-tenant (fail-closed).
 *
 * NUNCA confia no chamador: se o contexto não tem tenant, ESTOURA em vez de
 * devolver query sem filtro. O pior bug de SaaS multi-tenant é "sem tenant no
 * contexto" ser tratado como "vê tudo".
 */
function requireTenant(ctx: Pick<TrpcContext, "tenantId">): number {
  if (ctx.tenantId == null) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Tenant scope ausente — operação bloqueada (fail-closed).",
    });
  }
  return ctx.tenantId;
}

/**
 * Filtro de leitura/update/delete.
 *   db.select().from(workOrders).where(and(forTenant(ctx, workOrders), <resto>))
 *
 * O genérico <C extends MySqlColumn> exige que a tabela exponha uma coluna
 * `tenantId` que seja uma coluna Drizzle real. Chamar em tabela sem tenantId
 * (ex.: as do PDV) vira ERRO DE COMPILAÇÃO, não bug silencioso.
 */
export function forTenant<C extends MySqlColumn>(
  ctx: Pick<TrpcContext, "tenantId">,
  table: { tenantId: C },
) {
  return eq(table.tenantId, requireTenant(ctx));
}

/**
 * Carimbo de INSERT.
 *   db.insert(workOrders).values(withTenant(ctx, { ...campos }))
 *
 * O `tenantId?: never` no parâmetro PROÍBE o chamador de passar tenantId à mão —
 * o helper é a única fonte do tenant. Tentar `withTenant(ctx, { tenantId: 2, ... })`
 * vira erro de tipo.
 */
export function withTenant<V extends Record<string, unknown>>(
  ctx: Pick<TrpcContext, "tenantId">,
  values: V & { tenantId?: never },
): V & { tenantId: number } {
  return { ...values, tenantId: requireTenant(ctx) };
}

/**
 * Variante de `forTenant` que recebe o tenantId diretamente (número já resolvido).
 * Usar dentro de funções de módulo de dados (ex.: technicianDb.ts) que recebem
 * tenantId como parâmetro em vez de ctx.
 */
export function forTenantId<C extends MySqlColumn>(
  tenantId: number,
  table: { tenantId: C },
) {
  if (tenantId == null) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Tenant scope ausente (fail-closed)." });
  }
  return eq(table.tenantId, tenantId);
}

/**
 * Variante de `withTenant` que recebe o tenantId diretamente.
 */
export function withTenantId<V extends Record<string, unknown>>(
  tenantId: number,
  values: V & { tenantId?: never },
): V & { tenantId: number } {
  if (tenantId == null) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Tenant scope ausente (fail-closed)." });
  }
  return { ...values, tenantId };
}
