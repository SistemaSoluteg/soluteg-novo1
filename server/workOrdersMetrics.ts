import { sql } from "drizzle-orm";
import { getDb } from "./db";

/**
 * Obter estatísticas gerais de OS
 */
export async function getWorkOrderStats(tenantId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const tid = Number(tenantId);

  const [stats] = await db.execute(sql`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'aberta' THEN 1 ELSE 0 END) as abertas,
      SUM(CASE WHEN status = 'em_andamento' THEN 1 ELSE 0 END) as em_andamento,
      SUM(CASE WHEN status = 'concluida' THEN 1 ELSE 0 END) as concluidas,
      SUM(CASE WHEN status = 'aguardando_pagamento' THEN 1 ELSE 0 END) as aguardando_pagamento,
      SUM(CASE WHEN status = 'cancelada' THEN 1 ELSE 0 END) as canceladas,
      SUM(CASE WHEN type = 'rotina' THEN 1 ELSE 0 END) as rotina,
      SUM(CASE WHEN type = 'emergencial' THEN 1 ELSE 0 END) as emergencial,
      SUM(CASE WHEN type = 'orcamento' THEN 1 ELSE 0 END) as orcamento
    FROM workOrders
    WHERE tenantId = ${tid}
  `) as any;

  return stats[0];
}

/**
 * Obter OS por status (para gráfico)
 */
export async function getWorkOrdersByStatus(tenantId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const tid = Number(tenantId);

  const results = await db.execute(sql`
    SELECT
      status,
      COUNT(*) as count
    FROM workOrders
    WHERE tenantId = ${tid}
    GROUP BY status
    ORDER BY count DESC
  `) as any;

  return results[0];
}

/**
 * Obter OS por tipo (para gráfico)
 */
export async function getWorkOrdersByType(tenantId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const tid = Number(tenantId);

  const results = await db.execute(sql`
    SELECT
      type,
      COUNT(*) as count
    FROM workOrders
    WHERE tenantId = ${tid}
    GROUP BY type
    ORDER BY count DESC
  `) as any;

  return results[0];
}

/**
 * Obter tempo médio de conclusão por tipo
 */
export async function getAverageCompletionTime(tenantId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const tid = Number(tenantId);

  const results = await db.execute(sql`
    SELECT
      type,
      AVG(TIMESTAMPDIFF(HOUR, createdAt, completedAt)) as avg_hours
    FROM workOrders
    WHERE status = 'concluida' AND completedAt IS NOT NULL AND tenantId = ${tid}
    GROUP BY type
  `) as any;

  return results[0];
}

/**
 * Obter custo total de materiais
 *
 * ÓRFÃ: sem caller — o front usa `workOrdersAuxDb.getTotalMaterialsCost(workOrderId)`
 * (custo por OS individual), não esta (agregado global). Isolamento por tenant
 * adiado até esta função ganhar um chamador de verdade (dívida técnica anotada
 * no hardening pré-cutover; NÃO remover nesta leva).
 */
export async function getTotalMaterialsCost() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [result] = await db.execute(`
    SELECT
      COALESCE(SUM(totalCost), 0) as total_cost
    FROM workOrderMaterials
  `) as any;

  return result[0]?.total_cost || 0;
}

/**
 * Obter custo de materiais por OS
 */
export async function getMaterialsCostByWorkOrder(tenantId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const tid = Number(tenantId);

  const results = await db.execute(sql`
    SELECT
      wo.id,
      wo.title,
      COALESCE(SUM(wom.totalCost), 0) as materials_cost
    FROM workOrders wo
    LEFT JOIN workOrderMaterials wom ON wo.id = wom.workOrderId
    WHERE wo.tenantId = ${tid}
    GROUP BY wo.id, wo.title
    HAVING materials_cost > 0
    ORDER BY materials_cost DESC
    LIMIT 10
  `) as any;

  return results[0];
}

/**
 * Obter estatísticas financeiras
 */
export async function getFinancialStats(tenantId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const tid = Number(tenantId);

  const [stats] = await db.execute(sql`
    SELECT
      COALESCE(SUM(estimatedValue), 0) as total_estimated,
      COALESCE(SUM(actualValue), 0) as total_actual,
      COALESCE(AVG(estimatedValue), 0) as avg_estimated,
      COALESCE(AVG(actualValue), 0) as avg_actual
    FROM workOrders
    WHERE status IN ('concluida', 'aguardando_pagamento') AND tenantId = ${tid}
  `) as any;

  // workOrderMaterials.tenantId já é carimbado na criação (workOrdersAuxDb) —
  // filtra direto pela coluna, sem precisar de join com workOrders.
  const [materialsCost] = await db.execute(sql`
    SELECT COALESCE(SUM(totalCost), 0) as total_materials_cost
    FROM workOrderMaterials
    WHERE tenantId = ${tid}
  `) as any;

  return {
    ...stats[0],
    total_materials_cost: materialsCost[0]?.total_materials_cost || 0,
  };
}

/**
 * Obter OS criadas por mês (últimos 6 meses)
 */
export async function getWorkOrdersByMonth(tenantId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const tid = Number(tenantId);

  const results = await db.execute(sql`
    SELECT
      DATE_FORMAT(createdAt, '%Y-%m') as month,
      COUNT(*) as count
    FROM workOrders
    WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 6 MONTH) AND tenantId = ${tid}
    GROUP BY month
    ORDER BY month ASC
  `) as any;

  return results[0];
}

/**
 * Obter taxa de conclusão
 */
export async function getCompletionRate(tenantId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const tid = Number(tenantId);

  const [result] = await db.execute(sql`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'concluida' THEN 1 ELSE 0 END) as completed,
      ROUND(
        (SUM(CASE WHEN status = 'concluida' THEN 1 ELSE 0 END) / COUNT(*)) * 100,
        2
      ) as completion_rate
    FROM workOrders
    WHERE status NOT IN ('cancelada') AND tenantId = ${tid}
  `) as any;

  return result[0];
}

/**
 * Obter OS com maior atraso (scheduledDate passou e ainda não concluída)
 */
export async function getDelayedWorkOrders(tenantId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const tid = Number(tenantId);

  const results = await db.execute(sql`
    SELECT
      id,
      title,
      scheduledDate,
      status,
      DATEDIFF(NOW(), scheduledDate) as days_delayed
    FROM workOrders
    WHERE scheduledDate < NOW()
      AND status NOT IN ('concluida', 'cancelada')
      AND tenantId = ${tid}
    ORDER BY days_delayed DESC
    LIMIT 10
  `) as any;

  return results[0];
}

/**
 * Obter top clientes por número de OS
 */
export async function getTopClientsByWorkOrders(tenantId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const tid = Number(tenantId);

  const results = await db.execute(sql`
    SELECT
      c.id,
      c.name,
      COUNT(wo.id) as work_order_count
    FROM clients c
    INNER JOIN workOrders wo ON c.id = wo.clientId
    WHERE wo.tenantId = ${tid}
    GROUP BY c.id, c.name
    ORDER BY work_order_count DESC
    LIMIT 10
  `) as any;

  return results[0];
}
