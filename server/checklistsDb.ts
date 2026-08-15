import { eq, desc, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { 
  checklistTemplates, 
  inspectionTasks, 
  checklistInstances,
  ChecklistTemplate,
  InspectionTask,
  ChecklistInstance
} from "../drizzle/schema";

// ============ TEMPLATES ============

export async function getAllTemplates(): Promise<ChecklistTemplate[]> {
  const db = await getDb();
  if (!db) return [];

  // Retorna TODOS os templates (incluindo inativos com active=0).
  // O filtro de "apenas ativos no dropdown de criação" é feito no frontend,
  // para que instâncias antigas ainda consigam encontrar seu template e renderizar.
  const result = await db
    .select()
    .from(checklistTemplates)
    .orderBy(checklistTemplates.name);

  return result;
}

export async function getTemplateById(id: number): Promise<ChecklistTemplate | null> {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db
    .select()
    .from(checklistTemplates)
    .where(eq(checklistTemplates.id, id))
    .limit(1);
  
  return result[0] || null;
}

export async function getTemplateBySlug(slug: string): Promise<ChecklistTemplate | null> {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db
    .select()
    .from(checklistTemplates)
    .where(eq(checklistTemplates.slug, slug))
    .limit(1);
  
  return result[0] || null;
}

// ============ INSPECTION TASKS ============

export async function getInspectionTasksByWorkOrder(workOrderId: number): Promise<InspectionTask[]> {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db
    .select()
    .from(inspectionTasks)
    .where(eq(inspectionTasks.workOrderId, workOrderId))
    .orderBy(desc(inspectionTasks.createdAt));
  
  return result;
}

export async function getInspectionTaskById(id: number): Promise<InspectionTask | null> {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db
    .select()
    .from(inspectionTasks)
    .where(eq(inspectionTasks.id, id))
    .limit(1);
  
  return result[0] || null;
}

export async function createInspectionTask(data: {
  tenantId: number;
  workOrderId: number;
  title: string;
  description?: string;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Guarda fail-closed: sem isso, a tarefa nasce com tenantId NULL e some
  // silenciosamente das guardas de posse do router (mesmo padrão de createWorkOrder).
  if (!data.tenantId) {
    throw new Error("createInspectionTask: tenantId é obrigatório e não foi informado.");
  }

  const result = await db.insert(inspectionTasks).values({
    tenantId: data.tenantId,
    workOrderId: data.workOrderId,
    title: data.title,
    description: data.description || null,
    status: "pendente",
  });

  return result[0].insertId;
}

export async function updateInspectionTaskStatus(
  id: number, 
  status: "pendente" | "em_andamento" | "concluida"
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const updateData: Record<string, unknown> = { status };
  
  if (status === "concluida") {
    updateData.completedAt = new Date();
  }
  
  await db
    .update(inspectionTasks)
    .set(updateData)
    .where(eq(inspectionTasks.id, id));
}

export async function deleteInspectionTask(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Primeiro deletar os checklists associados
  await db
    .delete(checklistInstances)
    .where(eq(checklistInstances.inspectionTaskId, id));
  
  // Depois deletar a tarefa
  await db
    .delete(inspectionTasks)
    .where(eq(inspectionTasks.id, id));
}

// ============ CHECKLIST INSTANCES ============

export async function getChecklistsByInspectionTask(inspectionTaskId: number): Promise<ChecklistInstance[]> {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db
    .select()
    .from(checklistInstances)
    .where(eq(checklistInstances.inspectionTaskId, inspectionTaskId))
    .orderBy(checklistInstances.createdAt);
  
  return result;
}

export async function getChecklistInstanceById(id: number): Promise<ChecklistInstance | null> {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db
    .select()
    .from(checklistInstances)
    .where(eq(checklistInstances.id, id))
    .limit(1);
  
  return result[0] || null;
}

export async function createChecklistInstance(data: {
  tenantId: number;
  inspectionTaskId: number;
  templateId: number;
  customTitle: string;
  brand?: string;
  power?: string;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Guarda fail-closed: mesmo padrão de createInspectionTask/createWorkOrder.
  if (!data.tenantId) {
    throw new Error("createChecklistInstance: tenantId é obrigatório e não foi informado.");
  }

  const result = await db.insert(checklistInstances).values({
    tenantId: data.tenantId,
    inspectionTaskId: data.inspectionTaskId,
    templateId: data.templateId,
    customTitle: data.customTitle,
    brand: data.brand || null,
    power: data.power || null,
    responses: null,
    isComplete: 0,
  });

  return result[0].insertId;
}

export async function updateChecklistResponses(
  id: number,
  responses: Record<string, unknown>,
  isComplete: boolean
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db
    .update(checklistInstances)
    .set({
      responses: JSON.stringify(responses),
      isComplete: isComplete ? 1 : 0,
    })
    .where(eq(checklistInstances.id, id));
}

export async function updateChecklistInstance(
  id: number,
  data: {
    customTitle?: string;
    brand?: string;
    power?: string;
  }
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const updateData: Record<string, unknown> = {};
  
  if (data.customTitle !== undefined) updateData.customTitle = data.customTitle;
  if (data.brand !== undefined) updateData.brand = data.brand;
  if (data.power !== undefined) updateData.power = data.power;
  
  if (Object.keys(updateData).length > 0) {
    await db
      .update(checklistInstances)
      .set(updateData)
      .where(eq(checklistInstances.id, id));
  }
}

export async function deleteChecklistInstance(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db
    .delete(checklistInstances)
    .where(eq(checklistInstances.id, id));
}

// ============ HELPERS ============

export async function getChecklistWithTemplate(id: number): Promise<{
  checklist: ChecklistInstance;
  template: ChecklistTemplate;
} | null> {
  const checklist = await getChecklistInstanceById(id);
  if (!checklist) return null;
  
  const template = await getTemplateById(checklist.templateId);
  if (!template) return null;
  
  return { checklist, template };
}

export async function getFullInspectionTask(id: number): Promise<{
  task: InspectionTask;
  checklists: Array<{
    instance: ChecklistInstance;
    template: ChecklistTemplate;
  }>;
} | null> {
  const task = await getInspectionTaskById(id);
  if (!task) return null;
  
  const instances = await getChecklistsByInspectionTask(id);
  const checklists: Array<{ instance: ChecklistInstance; template: ChecklistTemplate }> = [];
  
  for (const instance of instances) {
    const template = await getTemplateById(instance.templateId);
    if (template) {
      checklists.push({ instance, template });
    }
  }
  
  return { task, checklists };
}

export async function getChecklistsByWorkOrderId(workOrderId: number): Promise<ChecklistInstance[]> {
  const db = await getDb();
  if (!db) return [];

  const tasks = await db
    .select({ id: inspectionTasks.id })
    .from(inspectionTasks)
    .where(eq(inspectionTasks.workOrderId, workOrderId));

  if (tasks.length === 0) return [];

  const taskIds = tasks.map(t => t.id);
  return await db
    .select()
    .from(checklistInstances)
    .where(inArray(checklistInstances.inspectionTaskId, taskIds));
}
