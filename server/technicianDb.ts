import { and, eq, desc } from "drizzle-orm";
import { getDb } from "./db";
import { technicians, InsertTechnician, Technician, workOrders, clients } from "../drizzle/schema";
import { forTenantId, withTenantId } from "./_core/tenant";

export async function createTechnician(
  data: Omit<InsertTechnician, "id" | "createdAt" | "updatedAt" | "tenantId">,
  tenantId: number,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(technicians).values(withTenantId(tenantId, data) as InsertTechnician);
}

export async function getTechniciansByTenant(tenantId: number): Promise<Omit<Technician, "password">[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(technicians)
    .where(forTenantId(tenantId, technicians))
    .orderBy(desc(technicians.createdAt));
  return rows.map(({ password: _pw, ...rest }) => rest);
}

export async function getTechnicianById(id: number, tenantId?: number): Promise<Technician | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const where = tenantId != null
    ? and(eq(technicians.id, id), forTenantId(tenantId, technicians))
    : eq(technicians.id, id);
  const rows = await db.select().from(technicians).where(where).limit(1);
  return rows[0];
}

export async function getTechnicianByUsername(username: string): Promise<Technician | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(technicians).where(eq(technicians.username, username)).limit(1);
  return rows[0];
}

export async function updateTechnician(
  id: number,
  data: Partial<Pick<InsertTechnician, "name" | "email" | "cpf" | "phone" | "specialization" | "active">>,
  tenantId: number,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(technicians).set(data).where(and(eq(technicians.id, id), forTenantId(tenantId, technicians)));
}

export async function updateTechnicianPassword(id: number, hashedPassword: string, tenantId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(technicians).set({ password: hashedPassword }).where(and(eq(technicians.id, id), forTenantId(tenantId, technicians)));
}

export async function updateTechnicianLastLogin(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(technicians).set({ lastLogin: new Date() }).where(eq(technicians.id, id));
}

export async function deleteTechnician(id: number, tenantId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // NULL out any assigned OS before deleting — filtro de tenant obrigatório para não zerar OS de outro tenant
  await db.update(workOrders).set({ technicianId: null }).where(and(forTenantId(tenantId, workOrders), eq(workOrders.technicianId, id)));
  await db.delete(technicians).where(and(eq(technicians.id, id), forTenantId(tenantId, technicians)));
}

export type WorkOrderSummary = {
  id: number;
  osNumber: string;
  title: string;
  status: string;
  priority: string;
  scheduledDate: Date | null;
  createdAt: Date;
  clientName: string | null;
  description: string | null;
  serviceType: string | null;
  type: string;
};

export async function getWorkOrdersByTechnicianId(technicianId: number): Promise<WorkOrderSummary[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const rows = await db
    .select({
      id: workOrders.id,
      osNumber: workOrders.osNumber,
      title: workOrders.title,
      status: workOrders.status,
      priority: workOrders.priority,
      scheduledDate: workOrders.scheduledDate,
      createdAt: workOrders.createdAt,
      clientName: clients.name,
      description: workOrders.description,
      serviceType: workOrders.serviceType,
      type: workOrders.type,
    })
    .from(workOrders)
    .leftJoin(clients, eq(workOrders.clientId, clients.id))
    .where(eq(workOrders.technicianId, technicianId))
    .orderBy(desc(workOrders.createdAt));

  return rows as WorkOrderSummary[];
}

export type WorkOrderDetail = {
  id: number;
  osNumber: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  type: string;
  serviceType: string | null;
  scheduledDate: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  pausedAt: Date | null;
  internalNotes: string | null;
  technicianSignature: string | null;
  technicianSignedAt: Date | null;
  clientSignature: string | null;
  createdAt: Date;
  updatedAt: Date;
  clientId: number;
  clientName: string | null;
  clientAddress: string | null;
  clientPhone: string | null;
};

export async function getWorkOrderByIdForTechnician(
  workOrderId: number,
  technicianId: number
): Promise<WorkOrderDetail | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const rows = await db
    .select({
      id: workOrders.id,
      osNumber: workOrders.osNumber,
      title: workOrders.title,
      description: workOrders.description,
      status: workOrders.status,
      priority: workOrders.priority,
      type: workOrders.type,
      serviceType: workOrders.serviceType,
      scheduledDate: workOrders.scheduledDate,
      startedAt: workOrders.startedAt,
      completedAt: workOrders.completedAt,
      pausedAt: workOrders.pausedAt,
      internalNotes: workOrders.internalNotes,
      technicianSignature: workOrders.technicianSignature,
      technicianSignedAt: workOrders.technicianSignedAt,
      clientSignature: workOrders.clientSignature,
      createdAt: workOrders.createdAt,
      updatedAt: workOrders.updatedAt,
      clientId: workOrders.clientId,
      clientName: clients.name,
      clientAddress: clients.address,
      clientPhone: clients.phone,
    })
    .from(workOrders)
    .leftJoin(clients, eq(workOrders.clientId, clients.id))
    .where(eq(workOrders.id, workOrderId))
    .limit(1);

  if (!rows[0]) return null;

  // Access control: ensure this OS belongs to the requesting technician
  const fullRow = await db
    .select({ technicianId: workOrders.technicianId })
    .from(workOrders)
    .where(eq(workOrders.id, workOrderId))
    .limit(1);

  if (!fullRow[0] || fullRow[0].technicianId !== technicianId) return null;

  return rows[0] as WorkOrderDetail;
}
