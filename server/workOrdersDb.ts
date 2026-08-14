import { eq, asc, desc, and, gte, lte, like, sql, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { workOrders, workOrderHistory, InsertWorkOrder, InsertWorkOrderHistory, technicians } from "../drizzle/schema";

/**
 * Gerar número de OS único (formato: OS-YYYY-NNNN)
 */
export async function generateOsNumber(): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const year = new Date().getFullYear();
  const prefix = `OS-${year}-`;

  // Buscar todas as OS do ano atual para encontrar o maior número
  const osThisYear = await db
    .select({ osNumber: workOrders.osNumber })
    .from(workOrders)
    .where(like(workOrders.osNumber, `${prefix}%`));

  let maxNumber = 0;
  for (const os of osThisYear) {
    if (os.osNumber) {
      const parts = os.osNumber.split("-");
      if (parts.length >= 3) {
        const num = parseInt(parts[2] || "0");
        if (num > maxNumber) maxNumber = num;
      }
    }
  }

  const nextNumber = maxNumber + 1;
  return `${prefix}${String(nextNumber).padStart(4, "0")}`;
}

/**
 * Criar nova OS
 */
export async function createWorkOrder(data: Omit<InsertWorkOrder, "osNumber">) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Guarda fail-closed: 3 dos 5 pontos de criação de OS no projeto esqueceram
  // tenantId de forma independente (padrão de erro, não acidente isolado). Sem
  // isso, a OS nasce com tenantId NULL e some silenciosamente de workOrders.list.
  if (!(data as any).tenantId) {
    throw new Error("createWorkOrder: tenantId é obrigatório e não foi informado.");
  }

  const osNumber = await generateOsNumber();
  
  const result = await db.insert(workOrders).values({
    ...data,
    osNumber,
  });

  // Buscar a OS recém-criada para retornar o ID
  const newOs = await db
    .select()
    .from(workOrders)
    .where(eq(workOrders.osNumber, osNumber))
    .limit(1);

  return { id: newOs[0]?.id || 0, osNumber };
}

/**
 * Buscar OS por ID com dados do cliente
 */
export async function getWorkOrderById(id: number) {
  const db = await getDb();
  if (!db) return null;

  const { clients } = await import("../drizzle/schema");
  
  const result = await db
    .select({
      // Campos da OS
      id: workOrders.id,
      osNumber: workOrders.osNumber,
      tenantId: workOrders.tenantId, // ISOLADO: necessário para as guardas de tenant no router
      adminId: workOrders.adminId,
      clientId: workOrders.clientId,
      type: workOrders.type,
      status: workOrders.status,
      priority: workOrders.priority,
      title: workOrders.title,
      description: workOrders.description,
      serviceType: workOrders.serviceType,
      scheduledDate: workOrders.scheduledDate,
      startedAt: workOrders.startedAt,
      completedAt: workOrders.completedAt,
      estimatedHours: workOrders.estimatedHours,
      actualHours: workOrders.actualHours,
      estimatedValue: workOrders.estimatedValue,
      finalValue: workOrders.finalValue,
      internalNotes: workOrders.internalNotes,
      clientNotes: workOrders.clientNotes,
      cancellationReason: workOrders.cancellationReason,
      isRecurring: workOrders.isRecurring,
      recurrenceType: workOrders.recurrenceType,
      recurrenceDay: workOrders.recurrenceDay,
      createdAt: workOrders.createdAt,
      updatedAt: workOrders.updatedAt,
      collaboratorSignature: workOrders.collaboratorSignature,
      collaboratorName: workOrders.collaboratorName,
      clientSignature: workOrders.clientSignature,
      clientSignerName: workOrders.clientName,
      signedAt: workOrders.signedAt,
      technicianSignature: workOrders.technicianSignature,
      technicianSignedAt: workOrders.technicianSignedAt,
      technicianId: workOrders.technicianId,
      pausedAt: workOrders.pausedAt,
      // Dados do cliente
      clientName: clients.name,
      clientAddress: clients.address,
      clientPhone: clients.phone,
      clientEmail: clients.email,
      // Nome do técnico vinculado
      technicianName: technicians.name,
    })
    .from(workOrders)
    .leftJoin(clients, eq(workOrders.clientId, clients.id))
    .leftJoin(technicians, eq(workOrders.technicianId, technicians.id))
    .where(eq(workOrders.id, id))
    .limit(1);

  return result[0] || null;
}

/**
 * Listar OS com filtros, busca, ordenação e PAGINAÇÃO
 */
export async function listWorkOrders(filters: {
  tenantId: number;
  clientId?: number;
  adminId?: number;
  type?: string;
  status?: string;
  priority?: string;
  search?: string;     // <-- Novo
  page?: number;       // <-- Novo
  limit?: number;      // <-- Novo
  sortBy?: string;     // <-- Novo
  sortOrder?: "asc" | "desc"; // <-- Novo
}) {
  const db = await getDb();
  if (!db) return { items: [], totalCount: 0 };

  const { clients } = await import("../drizzle/schema");

  // Parâmetros de paginação padrão
  const page = filters.page || 1;
  const limit = filters.limit || 10;
  const offset = (page - 1) * limit;

  // 1. Construir as condições (Filtros e Busca)
  const conditions = [];
  conditions.push(eq(workOrders.tenantId, filters.tenantId)); // ISOLADO
  if (filters.clientId) conditions.push(eq(workOrders.clientId, filters.clientId));
  if (filters.adminId) conditions.push(eq(workOrders.adminId, filters.adminId));
  if (filters.type) conditions.push(eq(workOrders.type, filters.type as any));
  if (filters.status) conditions.push(eq(workOrders.status, filters.status as any));
  if (filters.priority) conditions.push(eq(workOrders.priority, filters.priority as any));

  // Lógica de busca por título ou número da OS (case e accent insensitive via COLLATE)
  if (filters.search) {
    const searchPattern = `%${filters.search}%`;
    conditions.push(
      sql`(${workOrders.title} COLLATE utf8mb4_general_ci LIKE ${searchPattern} OR ${workOrders.osNumber} COLLATE utf8mb4_general_ci LIKE ${searchPattern} OR ${clients.name} COLLATE utf8mb4_general_ci LIKE ${searchPattern})`
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // 2. Query para buscar os itens paginados
  let query = db
    .select({
      id: workOrders.id,
      osNumber: workOrders.osNumber,
      adminId: workOrders.adminId,
      clientId: workOrders.clientId,
      clientName: clients.name,
      type: workOrders.type,
      status: workOrders.status,
      priority: workOrders.priority,
      title: workOrders.title,
      scheduledDate: workOrders.scheduledDate,
      createdAt: workOrders.createdAt,
      technicianId: workOrders.technicianId,
      technicianName: technicians.name,
    })
    .from(workOrders)
    .leftJoin(clients, eq(workOrders.clientId, clients.id))
    .leftJoin(technicians, eq(workOrders.technicianId, technicians.id))
    .where(whereClause);

  // Ordenação dinâmica (asc ou desc na coluna correta)
  const orderColumn = filters.sortBy === "title" ? workOrders.title : workOrders.createdAt;
  const orderDir = filters.sortOrder === "asc" ? asc(orderColumn) : desc(orderColumn);

  // 3. Executar as duas operações (Contagem e Busca)
  // IMPORTANTE: o count também precisa do JOIN com clients, pois o whereClause
  // pode referenciar clients.name (quando há busca por texto)
  const [result, totalResult] = await Promise.all([
    query.limit(limit).offset(offset).orderBy(orderDir),
    db.select({ count: sql<number>`count(*)` })
      .from(workOrders)
      .leftJoin(clients, eq(workOrders.clientId, clients.id))
      .where(whereClause)
  ]);

  return {
    items: result,
    totalCount: Number(totalResult[0]?.count || 0)
  };
}

/**
 * Atualizar OS
 */
export async function updateWorkOrder(id: number, data: Partial<InsertWorkOrder>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(workOrders)
    .set(data)
    .where(eq(workOrders.id, id));

  return true;
}

/**
 * Deletar OS
 */
export async function deleteWorkOrder(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(workOrders).where(eq(workOrders.id, id));
  return true;
}

/**
 * Deletar múltiplas OS
 */
export async function deleteMultipleWorkOrders(ids: number[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (ids.length === 0) throw new Error("Nenhuma OS selecionada");

  // Usar inArray para passar os IDs corretamente como parâmetros individuais
  await db.delete(workOrders).where(inArray(workOrders.id, ids));
  return true;
}

/**
 * Adicionar entrada no histórico de mudanças
 */
export async function addWorkOrderHistory(data: Omit<InsertWorkOrderHistory, "createdAt">) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(workOrderHistory).values(data);
  return true;
}

/**
 * Buscar histórico de uma OS
 */
export async function getWorkOrderHistory(workOrderId: number) {
  const db = await getDb();
  if (!db) return [];

  const result = await db
    .select()
    .from(workOrderHistory)
    .where(eq(workOrderHistory.workOrderId, workOrderId))
    .orderBy(desc(workOrderHistory.createdAt));

  return result;
}

/**
 * Atualizar status da OS e registrar no histórico
 */
export async function updateWorkOrderStatus(
  id: number,
  newStatus: string,
  changedBy: string,
  changedByType: "admin" | "client",
  notes?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Buscar status atual
  const currentOs = await getWorkOrderById(id);
  if (!currentOs) throw new Error("OS not found");

  // Atualizar status
  await updateWorkOrder(id, { status: newStatus as any });

  // Registrar no histórico
  await addWorkOrderHistory({
    workOrderId: id,
    changedBy,
    changedByType,
    previousStatus: currentOs.status,
    newStatus,
    notes,
  });

  return true;
}

/**
 * Buscar OS recorrentes que precisam ser criadas
 */
export async function getRecurringWorkOrders() {
  const db = await getDb();
  if (!db) return [];

  const result = await db
    .select()
    .from(workOrders)
    .where(
      and(
        eq(workOrders.isRecurring, 1),
        eq(workOrders.recurrenceCanceled, 0)
      )
    );

  return result;
}

/**
 * Compartilhar OS no portal do cliente, definindo a aba de destino
 */
export async function shareWorkOrderToPortal(id: number, portalTab: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(workOrders)
    .set({ sharedWithPortal: 1, portalTab })
    .where(eq(workOrders.id, id));
}

/**
 * Buscar OSs compartilhadas com o portal de um cliente
 */
export async function getSharedWorkOrdersForPortal(clientId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .select()
    .from(workOrders)
    .where(and(eq(workOrders.clientId, clientId), eq(workOrders.sharedWithPortal, 1)))
    .orderBy(desc(workOrders.createdAt));
}

/**
 * Atribuir (ou remover) técnico de uma OS
 */
export async function assignTechnicianToWorkOrder(
  workOrderId: number,
  technicianId: number | null
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(workOrders)
    .set({ technicianId })
    .where(eq(workOrders.id, workOrderId));
}

/**
 * Salvar assinatura antecipada do técnico
 */
export async function saveTechnicianSignature(
  workOrderId: number,
  technicianId: number,
  signature: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Garantia: só salva se a OS pertence ao técnico
  const rows = await db
    .select({ technicianId: workOrders.technicianId })
    .from(workOrders)
    .where(eq(workOrders.id, workOrderId))
    .limit(1);

  if (!rows[0] || rows[0].technicianId !== technicianId) {
    throw new Error("Acesso negado");
  }

  await db
    .update(workOrders)
    .set({ technicianSignature: signature, technicianSignedAt: new Date() })
    .where(eq(workOrders.id, workOrderId));
}
