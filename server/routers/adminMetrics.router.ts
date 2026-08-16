import { adminLocalProcedure, router } from "../_core/trpc";

// Métricas do dashboard do gestor (admin).
// SEC-01 (fechado): substitui a rota Express GET /api/admin-metrics?adminId=X, que
// não tinha auth e aceitava adminId da query (qualquer um enumerava tenants).
// Aqui adminId vem de ctx.adminId (JWT) e as queries são escopadas por
// adminId E tenantId (Método B) — sem input de identidade.
export const adminMetricsRouter = router({
  getDashboard: adminLocalProcedure.query(async ({ ctx }) => {
    const adminId = ctx.adminId;
    const tenantId = ctx.tenantId;

    const { getDb } = await import("../db");
    const { clients, clientDocuments, workOrders } = await import("../../drizzle/schema");
    const { eq, and, count, sql } = await import("drizzle-orm");

    const db = await getDb();
    if (!db) {
      return { totalClients: 0, activeClients: 0, openWorkOrders: 0, totalDocuments: 0 };
    }

    const [totalClientsResult] = await db
      .select({ total: count() })
      .from(clients)
      .where(and(eq(clients.adminId, adminId), eq(clients.tenantId, tenantId)));

    const [activeClientsResult] = await db
      .select({ total: count() })
      .from(clients)
      .where(and(eq(clients.adminId, adminId), eq(clients.tenantId, tenantId), eq(clients.active, 1)));

    const [openWorkOrdersResult] = await db
      .select({ total: count() })
      .from(workOrders)
      .where(and(
        eq(workOrders.adminId, adminId),
        eq(workOrders.tenantId, tenantId),
        sql`${workOrders.status} NOT IN ('concluida', 'cancelada')`
      ));

    const [totalDocumentsResult] = await db
      .select({ total: count() })
      .from(clientDocuments)
      .where(and(eq(clientDocuments.adminId, adminId), eq(clientDocuments.tenantId, tenantId)));

    return {
      totalClients: totalClientsResult?.total ?? 0,
      activeClients: activeClientsResult?.total ?? 0,
      openWorkOrders: openWorkOrdersResult?.total ?? 0,
      totalDocuments: totalDocumentsResult?.total ?? 0,
    };
  }),
});
