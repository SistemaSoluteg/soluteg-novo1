import { eq, and, desc } from "drizzle-orm";
import { getDb } from "./db";
import {
  workOrderTasks,
  workOrderMaterials,
  workOrderAttachments, // Tabela onde ficam guardadas as fotos
  workOrderComments,
  InsertWorkOrderTask,
  InsertWorkOrderMaterial,
  InsertWorkOrderAttachment,
  InsertWorkOrderComment,
} from "../drizzle/schema";

// ============================================================
// SEÇÃO: TAREFAS (CHECKLIST)
// Funções para criar, ver, editar e excluir os itens do checklist da OS.
// ============================================================

export async function createTask(task: InsertWorkOrderTask) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados não disponível");

  // Guarda fail-closed: mesmo padrão de createWorkOrder/createInspectionTask — sem isso,
  // a tarefa nasce com tenantId NULL e acumula dívida pra 3.7.1f.
  if (!task.tenantId) {
    throw new Error("createTask: tenantId é obrigatório e não foi informado.");
  }

  const result = await db.insert(workOrderTasks).values(task);
  return result;
}

// ISOLADO: usada pela guarda multi-etapa do router (tarefa → workOrderId → tenant).
export async function getTaskById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select()
    .from(workOrderTasks)
    .where(eq(workOrderTasks.id, id))
    .limit(1);
  return result[0] || null;
}

export async function getTasksByWorkOrderId(workOrderId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(workOrderTasks)
    .where(eq(workOrderTasks.workOrderId, workOrderId))
    .orderBy(workOrderTasks.orderIndex);
}

export async function updateTask(id: number, updates: Partial<InsertWorkOrderTask>) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados não disponível");
  await db.update(workOrderTasks).set(updates).where(eq(workOrderTasks.id, id));
}

export async function deleteTask(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados não disponível");
  await db.delete(workOrderTasks).where(eq(workOrderTasks.id, id));
}

export async function toggleTaskCompletion(id: number, isCompleted: boolean, completedBy?: string) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados não disponível");
  await db.update(workOrderTasks).set({
    isCompleted: isCompleted ? 1 : 0,
    completedAt: isCompleted ? new Date() : null,
    completedBy: isCompleted ? completedBy : null,
  }).where(eq(workOrderTasks.id, id));
}

// status: 0 = pendente, 1 = concluída, 2 = não concluída (X)
export async function setTaskStatus(id: number, status: number, completedBy?: string) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados não disponível");
  await db.update(workOrderTasks).set({
    isCompleted: status,
    completedAt: status === 1 ? new Date() : null,
    completedBy: status === 1 ? (completedBy ?? null) : null,
  }).where(eq(workOrderTasks.id, id));
}

// ============================================================
// SEÇÃO: MATERIAIS
// Funções para gerenciar peças e insumos usados no serviço.
// ============================================================

export async function createMaterial(material: InsertWorkOrderMaterial) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados não disponível");

  // Guarda fail-closed — ver comentário em createTask.
  if (!material.tenantId) {
    throw new Error("createMaterial: tenantId é obrigatório e não foi informado.");
  }

  const result = await db.insert(workOrderMaterials).values(material);
  return result;
}

// ISOLADO: usada pela guarda multi-etapa do router (material → workOrderId → tenant).
export async function getMaterialById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select()
    .from(workOrderMaterials)
    .where(eq(workOrderMaterials.id, id))
    .limit(1);
  return result[0] || null;
}

export async function getMaterialsByWorkOrderId(workOrderId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(workOrderMaterials)
    .where(eq(workOrderMaterials.workOrderId, workOrderId))
    .orderBy(desc(workOrderMaterials.addedAt));
}

export async function updateMaterial(id: number, updates: Partial<InsertWorkOrderMaterial>) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados não disponível");
  await db.update(workOrderMaterials).set(updates).where(eq(workOrderMaterials.id, id));
}

export async function deleteMaterial(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados não disponível");
  await db.delete(workOrderMaterials).where(eq(workOrderMaterials.id, id));
}

export async function getTotalMaterialsCost(workOrderId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const materials = await getMaterialsByWorkOrderId(workOrderId);
  return materials.reduce((sum, m) => sum + (m.totalCost || 0), 0);
}

// ============================================================
// SEÇÃO: ANEXOS E FOTOS (AQUI ESTÁ A NOVIDADE)
// Funções para gerenciar as fotos de Antes/Depois e documentos.
// ============================================================

/**
 * ADICIONAR FOTO: Salva o link da foto que o técnico acabou de subir.
 */
export async function createAttachment(attachment: InsertWorkOrderAttachment) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados não disponível");

  // Guarda fail-closed — ver comentário em createTask.
  if (!attachment.tenantId) {
    throw new Error("createAttachment: tenantId é obrigatório e não foi informado.");
  }

  const result = await db.insert(workOrderAttachments).values(attachment);
  return result;
}

/**
 * BUSCAR ANEXO POR ID (ISOLADO): usada pela guarda multi-etapa do router
 * (anexo → workOrderId → tenant).
 */
export async function getAttachmentById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select()
    .from(workOrderAttachments)
    .where(eq(workOrderAttachments.id, id))
    .limit(1);
  return result[0] || null;
}

/**
 * BUSCAR TODAS AS FOTOS: Pega tudo que foi anexado a uma Ordem de Serviço.
 */
export async function getAttachmentsByWorkOrderId(workOrderId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return await db
    .select()
    .from(workOrderAttachments)
    .where(eq(workOrderAttachments.workOrderId, workOrderId))
    .orderBy(desc(workOrderAttachments.uploadedAt));
}

/**
 * BUSCAR POR CATEGORIA: Pega fotos específicas (ex: só o que for de "Antes").
 */
export async function getAttachmentsByCategory(workOrderId: number, category: string) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(workOrderAttachments)
    .where(
      and(
        eq(workOrderAttachments.workOrderId, workOrderId),
        eq(workOrderAttachments.category, category as any)
      )
    )
    .orderBy(desc(workOrderAttachments.uploadedAt));
}

/** * 🚀 FUNÇÃO NOVA: ATUALIZAR DADOS DO ANEXO (LEGENDA)
 * Essa função permite que você mude o texto da legenda ou a categoria
 * de uma foto sem ter que apagar ela e subir de novo.
 */
export async function updateAttachment(id: number, updates: Partial<InsertWorkOrderAttachment>) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados não disponível");
  
  // O comando 'update' altera a linha da foto no banco usando o ID como endereço.
  await db
    .update(workOrderAttachments)
    .set(updates)
    .where(eq(workOrderAttachments.id, id));
    
  return true;
}

/**
 * EXCLUIR FOTO: Apaga o registro da foto do banco de dados.
 */
export async function deleteAttachment(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados não disponível");
  await db.delete(workOrderAttachments).where(eq(workOrderAttachments.id, id));
}

// ============================================================
// SEÇÃO: COMENTÁRIOS
// Funções para o chat interno ou notas do cliente.
// ============================================================

export async function createComment(comment: InsertWorkOrderComment) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados não disponível");

  // Guarda fail-closed — ver comentário em createTask.
  if (!comment.tenantId) {
    throw new Error("createComment: tenantId é obrigatório e não foi informado.");
  }

  const result = await db.insert(workOrderComments).values(comment);
  return result;
}

// ISOLADO: usada pela guarda multi-etapa do router (comentário → workOrderId → tenant).
export async function getCommentById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select()
    .from(workOrderComments)
    .where(eq(workOrderComments.id, id))
    .limit(1);
  return result[0] || null;
}

export async function getCommentsByWorkOrderId(workOrderId: number, includeInternal: boolean = true) {
  const db = await getDb();
  if (!db) return [];
  
  if (includeInternal) {
    return await db
      .select()
      .from(workOrderComments)
      .where(eq(workOrderComments.workOrderId, workOrderId))
      .orderBy(desc(workOrderComments.createdAt));
  } else {
    return await db
      .select()
      .from(workOrderComments)
      .where(
        and(
          eq(workOrderComments.workOrderId, workOrderId),
          eq(workOrderComments.isInternal, 0)
        )
      )
      .orderBy(desc(workOrderComments.createdAt));
  }
}

export async function deleteComment(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados não disponível");
  await db.delete(workOrderComments).where(eq(workOrderComments.id, id));
}
