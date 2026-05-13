import { eq, desc, and, like, sql, inArray } from "drizzle-orm";
import { getDb } from "./db";
import {
  budgets,
  budgetItems,
  budgetHistory,
  budgetAttachments,
  clients,
  InsertBudget,
  InsertBudgetItem,
  InsertBudgetHistory,
  InsertBudgetAttachment,
} from "../drizzle/schema";
import crypto from "crypto";

// ─── Número de orçamento ───────────────────────────────────────────────────

export async function generateBudgetNumber(): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const year = new Date().getFullYear();
  const prefix = `ORC-${year}-`;

  const existing = await db
    .select({ budgetNumber: budgets.budgetNumber })
    .from(budgets)
    .where(like(budgets.budgetNumber, `${prefix}%`));

  let max = 0;
  for (const b of existing) {
    if (b.budgetNumber) {
      const parts = b.budgetNumber.split("-");
      const num = parseInt(parts[2] || "0");
      if (num > max) max = num;
    }
  }

  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

// ─── Criar orçamento ───────────────────────────────────────────────────────

export async function createBudget(
  data: Omit<InsertBudget, "budgetNumber" | "version">
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const budgetNumber = await generateBudgetNumber();

  await db.insert(budgets).values({ ...data, budgetNumber, version: 1 });

  const newBudget = await db
    .select()
    .from(budgets)
    .where(eq(budgets.budgetNumber, budgetNumber))
    .limit(1);

  const id = newBudget[0]?.id ?? 0;

  // Histórico: criado
  await addBudgetHistory(id, {
    changedBy: String(data.adminId),
    changedByType: "admin",
    action: "criado",
    newStatus: "pendente",
    notes: "Orçamento criado",
  });

  return { id, budgetNumber };
}

// ─── Buscar por ID ─────────────────────────────────────────────────────────

export async function getBudgetById(id: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select({
      id: budgets.id,
      budgetNumber: budgets.budgetNumber,
      adminId: budgets.adminId,
      clientId: budgets.clientId,
      serviceType: budgets.serviceType,
      priority: budgets.priority,
      title: budgets.title,
      description: budgets.description,
      scope: budgets.scope,
      status: budgets.status,
      validityDays: budgets.validityDays,
      validUntil: budgets.validUntil,
      laborValue: budgets.laborValue,
      totalValue: budgets.totalValue,
      technicianSignature: budgets.technicianSignature,
      technicianName: budgets.technicianName,
      technicianDocument: budgets.technicianDocument,
      finalizedAt: budgets.finalizedAt,
      clientSignature: budgets.clientSignature,
      clientSignatureName: budgets.clientSignatureName,
      approvedAt: budgets.approvedAt,
      approvedBy: budgets.approvedBy,
      approvalToken: budgets.approvalToken,
      approvalTokenExpiresAt: budgets.approvalTokenExpiresAt,
      generatedOsId: budgets.generatedOsId,
      version: budgets.version,
      sharedWithPortal: budgets.sharedWithPortal,
      internalNotes: budgets.internalNotes,
      clientNotes: budgets.clientNotes,
      rejectionReason: budgets.rejectionReason,
      createdAt: budgets.createdAt,
      updatedAt: budgets.updatedAt,
      // Cliente
      clientName: clients.name,
      clientEmail: clients.email,
      clientPhone: clients.phone,
    })
    .from(budgets)
    .leftJoin(clients, eq(budgets.clientId, clients.id))
    .where(eq(budgets.id, id))
    .limit(1);

  return result[0] ?? null;
}

// ─── Buscar por token de aprovação (público) ───────────────────────────────

export async function getBudgetByToken(token: string) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select({
      id: budgets.id,
      budgetNumber: budgets.budgetNumber,
      adminId: budgets.adminId,
      clientId: budgets.clientId,
      serviceType: budgets.serviceType,
      priority: budgets.priority,
      title: budgets.title,
      description: budgets.description,
      scope: budgets.scope,
      status: budgets.status,
      validityDays: budgets.validityDays,
      validUntil: budgets.validUntil,
      laborValue: budgets.laborValue,
      totalValue: budgets.totalValue,
      technicianSignature: budgets.technicianSignature,
      technicianName: budgets.technicianName,
      clientSignature: budgets.clientSignature,
      clientSignatureName: budgets.clientSignatureName,
      approvedAt: budgets.approvedAt,
      approvalToken: budgets.approvalToken,
      approvalTokenExpiresAt: budgets.approvalTokenExpiresAt,
      clientNotes: budgets.clientNotes,
      rejectionReason: budgets.rejectionReason,
      finalizedAt: budgets.finalizedAt,
      createdAt: budgets.createdAt,
      clientName: clients.name,
      clientEmail: clients.email,
    })
    .from(budgets)
    .leftJoin(clients, eq(budgets.clientId, clients.id))
    .where(eq(budgets.approvalToken, token))
    .limit(1);

  return result[0] ?? null;
}

// ─── Listar orçamentos ─────────────────────────────────────────────────────

export async function listBudgets(params: {
  adminId?: number;
  clientId?: number;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}) {
  const db = await getDb();
  if (!db) return { items: [], totalCount: 0 };

  const {
    adminId,
    clientId,
    status,
    search,
    page = 1,
    limit = 10,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = params;

  const conditions = [];
  if (adminId) conditions.push(eq(budgets.adminId, adminId));
  if (clientId) conditions.push(eq(budgets.clientId, clientId));
  if (status) conditions.push(eq(budgets.status, status as any));
  if (search) {
    conditions.push(
      sql`(${budgets.title} LIKE ${`%${search}%`} OR ${budgets.budgetNumber} LIKE ${`%${search}%`} OR ${clients.name} LIKE ${`%${search}%`})`
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const offset = (page - 1) * limit;

  const [items, countResult] = await Promise.all([
    db
      .select({
        id: budgets.id,
        budgetNumber: budgets.budgetNumber,
        title: budgets.title,
        serviceType: budgets.serviceType,
        priority: budgets.priority,
        status: budgets.status,
        totalValue: budgets.totalValue,
        validUntil: budgets.validUntil,
        finalizedAt: budgets.finalizedAt,
        approvedAt: budgets.approvedAt,
        version: budgets.version,
        generatedOsId: budgets.generatedOsId,
        createdAt: budgets.createdAt,
        clientId: budgets.clientId,
        clientName: clients.name,
      })
      .from(budgets)
      .leftJoin(clients, eq(budgets.clientId, clients.id))
      .where(where)
      .orderBy(
        sortOrder === "desc"
          ? desc(budgets[sortBy as keyof typeof budgets.$inferSelect] as any)
          : (budgets[sortBy as keyof typeof budgets.$inferSelect] as any)
      )
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(budgets)
      .leftJoin(clients, eq(budgets.clientId, clients.id))
      .where(where),
  ]);

  return { items, totalCount: Number(countResult[0]?.count ?? 0) };
}

// ─── Atualizar orçamento ───────────────────────────────────────────────────

export async function updateBudget(
  id: number,
  data: Partial<InsertBudget>,
  changedBy: string,
  saveSnapshot = false
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (saveSnapshot) {
    const current = await getBudgetById(id);
    if (current) {
      const items = await getBudgetItems(id);
      await addBudgetHistory(id, {
        changedBy,
        changedByType: "admin",
        action: "editado",
        previousStatus: current.status ?? undefined,
        newStatus: current.status ?? undefined,
        snapshotData: JSON.stringify({ budget: current, items }),
        notes: "Revisão do orçamento",
      });
      // Incrementa versão
      data.version = (current.version ?? 1) + 1;
    }
  }

  await db.update(budgets).set(data).where(eq(budgets.id, id));
}

// ─── Finalizar orçamento (assinatura do técnico) ───────────────────────────

export async function finalizeBudget(
  id: number,
  technicianName: string,
  technicianSignature: string,
  technicianDocument: string | undefined,
  validityDays: number,
  adminIdStr: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const current = await getBudgetById(id);
  if (!current) throw new Error("Orçamento não encontrado");

  // Salva snapshot se estava finalizado (revisão)
  if (current.status === "finalizado") {
    const items = await getBudgetItems(id);
    await addBudgetHistory(id, {
      changedBy: adminIdStr,
      changedByType: "admin",
      action: "revisao",
      previousStatus: "finalizado",
      newStatus: "finalizado",
      snapshotData: JSON.stringify({ budget: current, items }),
      notes: "Nova revisão do orçamento",
    });
  }

  // Gera token de aprovação
  const token = crypto.randomBytes(32).toString("hex");
  const now = new Date();
  const validUntil = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);
  const tokenExpires = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);

  await db
    .update(budgets)
    .set({
      status: "finalizado",
      technicianSignature,
      technicianName,
      technicianDocument: technicianDocument ?? null,
      finalizedAt: now,
      validUntil,
      validityDays,
      approvalToken: token,
      approvalTokenExpiresAt: tokenExpires,
      version: (current.version ?? 1) + (current.status === "finalizado" ? 1 : 0),
    })
    .where(eq(budgets.id, id));

  await addBudgetHistory(id, {
    changedBy: adminIdStr,
    changedByType: "admin",
    action: "finalizado",
    previousStatus: current.status ?? undefined,
    newStatus: "finalizado",
    notes: `Finalizado por ${technicianName}`,
  });

  return { token, validUntil };
}

// ─── Aprovar orçamento ─────────────────────────────────────────────────────

export async function approveBudget(
  id: number,
  clientSignature: string,
  clientSignatureName: string,
  approvedBy: string,
  changedByType: "admin" | "client"
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const current = await getBudgetById(id);
  if (!current) throw new Error("Orçamento não encontrado");
  if (current.status !== "finalizado") throw new Error("Apenas orçamentos finalizados podem ser aprovados");

  await db
    .update(budgets)
    .set({
      status: "aprovado",
      clientSignature,
      clientSignatureName,
      approvedAt: new Date(),
      approvedBy,
    })
    .where(eq(budgets.id, id));

  await addBudgetHistory(id, {
    changedBy: approvedBy,
    changedByType,
    action: "aprovado",
    previousStatus: "finalizado",
    newStatus: "aprovado",
    notes: `Aprovado por ${clientSignatureName}`,
  });
}

// ─── Reprovar orçamento ────────────────────────────────────────────────────

export async function rejectBudget(
  id: number,
  rejectionReason: string,
  rejectedBy: string,
  changedByType: "admin" | "client"
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const current = await getBudgetById(id);
  if (!current) throw new Error("Orçamento não encontrado");

  await db
    .update(budgets)
    .set({ status: "reprovado", rejectionReason })
    .where(eq(budgets.id, id));

  await addBudgetHistory(id, {
    changedBy: rejectedBy,
    changedByType,
    action: "reprovado",
    previousStatus: current.status ?? undefined,
    newStatus: "reprovado",
    notes: rejectionReason,
  });
}

// ─── Vincular OS gerada ao orçamento ──────────────────────────────────────

export async function linkGeneratedOs(budgetId: number, osId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(budgets).set({ generatedOsId: osId }).where(eq(budgets.id, budgetId));
}

// ─── Deletar orçamento ─────────────────────────────────────────────────────

export async function deleteBudget(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(budgetHistory).where(eq(budgetHistory.budgetId, id));
  await db.delete(budgetItems).where(eq(budgetItems.budgetId, id));
  await db.delete(budgets).where(eq(budgets.id, id));
}

// ─── Itens ─────────────────────────────────────────────────────────────────

export async function getBudgetItems(budgetId: number) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(budgetItems)
    .where(eq(budgetItems.budgetId, budgetId))
    .orderBy(budgetItems.orderIndex);
}

export async function upsertBudgetItems(
  budgetId: number,
  items: Array<{
    id?: number;
    description: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    totalPrice: number;
    orderIndex: number;
  }>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Remove todos os itens existentes e recria (mais simples para reordenação)
  await db.delete(budgetItems).where(eq(budgetItems.budgetId, budgetId));

  if (items.length > 0) {
    await db.insert(budgetItems).values(
      items.map((item) => ({
        budgetId,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        orderIndex: item.orderIndex,
      }))
    );
  }
}

export async function getTotalItemsValue(budgetId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const result = await db
    .select({ total: sql<number>`COALESCE(SUM(totalPrice), 0)` })
    .from(budgetItems)
    .where(eq(budgetItems.budgetId, budgetId));

  return Number(result[0]?.total ?? 0);
}

// ─── Histórico ─────────────────────────────────────────────────────────────

export async function getBudgetHistory(budgetId: number) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(budgetHistory)
    .where(eq(budgetHistory.budgetId, budgetId))
    .orderBy(desc(budgetHistory.createdAt));
}

async function addBudgetHistory(
  budgetId: number,
  data: {
    changedBy: string;
    changedByType: "admin" | "client";
    action: string;
    previousStatus?: string;
    newStatus?: string;
    snapshotData?: string;
    notes?: string;
  }
) {
  const db = await getDb();
  if (!db) return;

  await db.insert(budgetHistory).values({ budgetId, ...data });
}

// ─── Métricas para o dashboard ─────────────────────────────────────────────

export async function getBudgetMetrics(adminId: number) {
  const db = await getDb();
  if (!db) return { pending: 0, finalized: 0, approved: 0, rejected: 0, total: 0 };

  const result = await db
    .select({
      status: budgets.status,
      count: sql<number>`count(*)`,
    })
    .from(budgets)
    .where(eq(budgets.adminId, adminId))
    .groupBy(budgets.status);

  const metrics = { pending: 0, finalized: 0, approved: 0, rejected: 0, total: 0 };
  for (const row of result) {
    const count = Number(row.count);
    metrics.total += count;
    if (row.status === "pendente") metrics.pending = count;
    if (row.status === "finalizado") metrics.finalized = count;
    if (row.status === "aprovado") metrics.approved = count;
    if (row.status === "reprovado") metrics.rejected = count;
  }
  return metrics;
}

// ─── Anexos do orçamento (fotos "antes") ──────────────────────────────────

export async function getBudgetAttachments(budgetId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(budgetAttachments)
    .where(eq(budgetAttachments.budgetId, budgetId))
    .orderBy(budgetAttachments.uploadedAt);
}

export async function createBudgetAttachment(data: InsertBudgetAttachment) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(budgetAttachments).values(data);
}

export async function updateBudgetAttachmentCaption(id: number, caption: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(budgetAttachments).set({ caption }).where(eq(budgetAttachments.id, id));
}

export async function deleteBudgetAttachment(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(budgetAttachments).where(eq(budgetAttachments.id, id));
}
