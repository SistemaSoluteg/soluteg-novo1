import { eq, and, sql } from "drizzle-orm";
import { getDb } from "./db";
import { workOrders } from "../drizzle/schema";
import * as workOrdersDb from "./workOrdersDb";

/**
 * Processar recorrências de OS
 * Deve ser executado diariamente (via cron job ou scheduler)
 */
export async function processRecurringWorkOrders() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const today = new Date();
  const currentDay = today.getDate();
  const currentMonth = today.getMonth() + 1;
  const currentYear = today.getFullYear();

  console.log(`[Recurrence] Processing recurring work orders for ${currentYear}-${currentMonth}-${currentDay}`);

  // Buscar OS recorrentes ativas
  const recurringWorkOrders = await db
    .select()
    .from(workOrders)
    .where(
      and(
        eq(workOrders.isRecurring, 1),
        eq(workOrders.recurrenceCanceled, 0)
      )
    );

  if (!recurringWorkOrders || recurringWorkOrders.length === 0) {
    console.log("[Recurrence] No recurring work orders found");
    return { processed: 0, created: 0, errors: [] };
  }

  const results = {
    processed: 0,
    created: 0,
    errors: [] as string[],
  };

  for (const wo of recurringWorkOrders) {
    try {
      results.processed++;

      // Verificar se já existe uma OS criada este mês para esta recorrência
      const existing = await db
        .select()
        .from(workOrders)
        .where(
          and(
            eq(workOrders.parentOsId, wo.id),
            sql`YEAR(${workOrders.createdAt}) = ${currentYear}`,
            sql`MONTH(${workOrders.createdAt}) = ${currentMonth}`
          )
        );

      if (existing && existing.length > 0) {
        console.log(`[Recurrence] OS #${wo.id} already has instance for ${currentYear}-${currentMonth}`);
        continue;
      }

      // Determinar se deve criar nova OS este mês
      let shouldCreate = false;

      if (wo.recurrenceType === "mensal_inicio") {
        // Criar no primeiro dia do mês
        if (currentDay === 1) {
          shouldCreate = true;
        }
      } else if (wo.recurrenceType === "mensal_fixo") {
        // Criar no dia específico do mês
        if (currentDay === (wo.recurrenceDay || 1)) {
          shouldCreate = true;
        }
      }

      if (!shouldCreate) {
        continue;
      }

      // Criar nova instância da OS
      const scheduledDate = new Date(currentYear, currentMonth - 1, wo.recurrenceDay || currentDay);

      const newWorkOrder = await workOrdersDb.createWorkOrder({
        tenantId: wo.tenantId,
        adminId: wo.adminId,
        clientId: wo.clientId,
        type: wo.type!,
        priority: wo.priority!,
        title: `${wo.title} - ${currentMonth}/${currentYear}`,
        description: wo.description || "",
        serviceType: wo.serviceType || "",
        scheduledDate,
        estimatedHours: wo.estimatedHours,
        estimatedValue: wo.estimatedValue,
        isRecurring: 0, // A instância criada não é recorrente
        parentOsId: wo.id, // Referência à OS pai
      });

      // Registrar no histórico (addWorkOrderHistory deriva o tenantId da OS-pai, fail-closed)
      await workOrdersDb.addWorkOrderHistory({
        workOrderId: newWorkOrder.id,
        previousStatus: null,
        newStatus: "aberta",
        changedBy: "Sistema",
        changedByType: "admin", // Sistema age como admin
        notes: "OS criada automaticamente por recorrência",
      });

      console.log(`[Recurrence] Created new instance #${newWorkOrder.id} from parent #${wo.id}`);
      results.created++;

    } catch (error: any) {
      console.error(`[Recurrence] Error processing WO #${wo.id}:`, error);
      results.errors.push(`WO #${wo.id}: ${error.message}`);
    }
  }

  console.log(`[Recurrence] Processed ${results.processed} recurring work orders, created ${results.created} new instances`);
  return results;
}

/**
 * Cancelar recorrência de uma OS
 * @param workOrderId ID da OS recorrente
 * @param cancelFutureOnly Se true, cancela apenas futuras instâncias. Se false, cancela também a atual.
 */
export async function cancelRecurrence(workOrderId: number, cancelFutureOnly: boolean = false) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Buscar a OS
  const [wo] = await db
    .select()
    .from(workOrders)
    .where(eq(workOrders.id, workOrderId));

  if (!wo) {
    throw new Error("Work order not found");
  }

  if (!wo.isRecurring) {
    throw new Error("Work order is not recurring");
  }

  // Atualizar a OS recorrente
  await db
    .update(workOrders)
    .set({
      recurrenceCanceled: 1,
    })
    .where(eq(workOrders.id, workOrderId));

  // Se não for apenas futuras, cancelar também a instância atual do mês
  if (!cancelFutureOnly) {
    const today = new Date();
    const currentMonth = today.getMonth() + 1;
    const currentYear = today.getFullYear();

    await db
      .update(workOrders)
      .set({ status: "cancelada" })
      .where(
        and(
          eq(workOrders.parentOsId, workOrderId),
          sql`YEAR(${workOrders.createdAt}) = ${currentYear}`,
          sql`MONTH(${workOrders.createdAt}) = ${currentMonth}`
        )
      );
  }

  return { success: true, cancelledFutureOnly: cancelFutureOnly };
}

/**
 * Reativar recorrência de uma OS
 */
export async function reactivateRecurrence(workOrderId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(workOrders)
    .set({
      recurrenceCanceled: 0,
    })
    .where(eq(workOrders.id, workOrderId));

  return { success: true };
}

/**
 * Obter próxima data de criação de uma OS recorrente
 */
export async function getNextRecurrenceDate(workOrderId: number): Promise<Date | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [wo] = await db
    .select()
    .from(workOrders)
    .where(eq(workOrders.id, workOrderId));

  if (!wo) {
    return null;
  }

  if (!wo.isRecurring || wo.recurrenceCanceled) {
    return null;
  }

  const today = new Date();
  let nextDate: Date;

  if (wo.recurrenceType === "mensal_inicio") {
    // Próximo dia 1 do mês
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    nextDate = nextMonth;
  } else if (wo.recurrenceType === "mensal_fixo") {
    // Próximo dia específico
    const targetDay = wo.recurrenceDay || 1;
    const currentDay = today.getDate();

    if (currentDay < targetDay) {
      // Ainda não passou o dia deste mês
      nextDate = new Date(today.getFullYear(), today.getMonth(), targetDay);
    } else {
      // Já passou, próximo mês
      nextDate = new Date(today.getFullYear(), today.getMonth() + 1, targetDay);
    }
  } else {
    return null;
  }

  return nextDate;
}

/**
 * Listar instâncias criadas de uma OS recorrente
 */
export async function getRecurrenceInstances(parentWorkOrderId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const instances = await db
    .select({
      id: workOrders.id,
      title: workOrders.title,
      status: workOrders.status,
      scheduledDate: workOrders.scheduledDate,
      createdAt: workOrders.createdAt,
      completedAt: workOrders.completedAt,
    })
    .from(workOrders)
    .where(eq(workOrders.parentOsId, parentWorkOrderId))
    .orderBy(sql`${workOrders.createdAt} DESC`);

  return instances || [];
}
