import { eq, desc, sql, like, and, gte, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, reports, InsertReport, invites, InsertInvite, Invite, admins, InsertAdmin, Admin, inspectionReports, InsertInspectionReport, InspectionReport, clients, InsertClient, Client, clientDocuments, InsertClientDocument, ClientDocument, workOrders, InsertWorkOrder, WorkOrder } from "../drizzle/schema";
import { ENV } from './_core/env';
import crypto from "crypto";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      console.warn("[Database] DATABASE_URL não definido no .env");
      return null;
    }
    try {
      _db = drizzle(url);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// Report queries
export async function createReport(report: InsertReport) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(reports).values(report);
  return result;
}

export async function getReportsByUserId(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  return await db.select().from(reports).where(eq(reports.userId, userId)).orderBy(desc(reports.createdAt));
}

export async function getReportById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.select().from(reports).where(eq(reports.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function updateReport(id: number, data: Partial<InsertReport>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(reports).set(data).where(eq(reports.id, id));
}

export async function deleteReport(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.delete(reports).where(eq(reports.id, id));
}

// Invite queries
export async function createInvite(invite: InsertInvite) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(invites).values(invite);
  return result;
}

export async function getInvites() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  return await db.select().from(invites).orderBy(desc(invites.createdAt));
}

export async function getInviteByCode(code: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.select().from(invites).where(eq(invites.code, code)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function deleteInvite(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.delete(invites).where(eq(invites.id, id));
}

export async function getAllUsers() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  return await db.select().from(users).orderBy(desc(users.createdAt));
}

export async function deleteUser(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.delete(users).where(eq(users.id, id));
}

export async function updateUserRole(id: number, role: "user" | "admin") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(users).set({ role }).where(eq(users.id, id));
}


// Admin queries
export async function createAdmin(admin: InsertAdmin) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(admins).values(admin);
  return result;
}

export async function getAdminByEmail(email: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.select().from(admins).where(eq(admins.email, email)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function getAdminByUsername(username: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.select().from(admins).where(eq(admins.username, username)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function getAdminById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.select().from(admins).where(eq(admins.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function getAllAdmins() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  return await db.select().from(admins).orderBy(desc(admins.createdAt));
}

export async function updateAdminLastLogin(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(admins).set({ lastLogin: new Date() }).where(eq(admins.id, id));
}

export async function updateAdminPassword(id: number, password: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(admins).set({ password }).where(eq(admins.id, id));
}

export async function deleteAdmin(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.delete(admins).where(eq(admins.id, id));
}


// Accept invite and create admin
export async function acceptInvite(code: string, name: string, password: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const invite = await getInviteByCode(code);
  if (!invite) throw new Error("Invite not found");
  
  if (new Date() > invite.expiresAt) {
    throw new Error("Invite expired");
  }

  // Create admin - use email as username
  const result = await db.insert(admins).values({
    username: invite.email.split('@')[0], // Use part before @ as username
    email: invite.email,
    password,
    name,
    active: 1,
  });

  // Delete invite
  await deleteInvite(invite.id);

  return result;
}

// Password reset
export async function createPasswordReset(email: string, token: string, expiresAt: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // For now, we'll store this in a simple way
  // In production, you'd want a dedicated password_resets table
  console.log(`Password reset token created for ${email}: ${token}`);
  return { success: true, token };
}



export async function getReportStats() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Adicionamos um try/catch para que, se as métricas falharem, o portal não "suma"
  try {
    const allReports = await db.select().from(reports);
    const totalReports = allReports.length;
    
    const serviceStats = allReports.reduce((acc: Record<string, number>, report) => {
      acc[report.serviceType] = (acc[report.serviceType] || 0) + 1;
      return acc;
    }, {});

    const monthlyStats = allReports.reduce((acc: Record<string, number>, report) => {
      const month = new Date(report.createdAt).toISOString().slice(0, 7);
      acc[month] = (acc[month] || 0) + 1;
      return acc;
    }, {});

    return {
      totalReports,
      serviceStats,
      monthlyStats,
      recentReports: allReports.slice(-5).reverse(),
    };
  } catch (error) {
    console.error("Erro ao carregar métricas:", error);
    return { totalReports: 0, serviceStats: {}, monthlyStats: {}, recentReports: [] };
  }
}
export async function createUser(userData: {
  email: string;
  password: string;
  role: "user" | "admin";
  setupToken?: string;
  setupTokenExpires?: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Check if user already exists
  const existing = await db.select().from(users).where(eq(users.email, userData.email)).limit(1);
  if (existing.length > 0) {
    throw new Error("User with this email already exists");
  }
  
  const result = await db.insert(users).values({
    email: userData.email,
    role: userData.role,
    name: userData.email.split("@")[0],
    loginMethod: "manual",
    openId: `manual-${crypto.randomBytes(16).toString("hex")}`,
  });
  
  return result;
}


// Update admin profile
export async function updateAdminProfile(id: number, data: { name?: string; phone?: string; profilePhoto?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.phone !== undefined) updateData.phone = data.phone;
  if (data.profilePhoto !== undefined) updateData.profilePhoto = data.profilePhoto;
  
  if (Object.keys(updateData).length === 0) {
    throw new Error("No fields to update");
  }
  
  await db.update(admins).set(updateData).where(eq(admins.id, id));
}


// Create inspection report
export async function createInspectionReport(adminId: number, data: InsertInspectionReport) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(inspectionReports).values({
    ...data,
    adminId,
  });
  
  return result;
}

// Get inspection report by ID
export async function getInspectionReportById(id: number): Promise<InspectionReport | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.select().from(inspectionReports).where(eq(inspectionReports.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// Get all inspection reports for admin
export async function getInspectionReportsByAdmin(adminId: number): Promise<InspectionReport[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.select().from(inspectionReports).where(eq(inspectionReports.adminId, adminId));
  return result;
}

// Update inspection report
export async function updateInspectionReport(id: number, data: Partial<InsertInspectionReport>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(inspectionReports).set(data).where(eq(inspectionReports.id, id));
}

// ============================================================
// SUBSTITUA estas funções no seu db.ts
// Apenas as funções de cliente foram alteradas
// ============================================================
 
// Client queries
export async function createClient(client: InsertClient) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
 
  const result = await db.insert(clients).values(client);
  return result;
}
 
export async function getClientsByAdminId(adminId: number): Promise<Client[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
 
  return await db
    .select()
    .from(clients)
    .where(eq(clients.adminId, adminId))
    .orderBy(desc(clients.createdAt));
}
 
export async function getClientById(id: number): Promise<Client | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
 
  const result = await db
    .select()
    .from(clients)
    .where(eq(clients.id, id))
    .limit(1);
 
  return result.length > 0 ? result[0] : undefined;
}
 
export async function getClientByUsername(username: string): Promise<Client | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
 
  const result = await db
    .select()
    .from(clients)
    .where(eq(clients.username, username))
    .limit(1);
 
  return result.length > 0 ? result[0] : undefined;
}
 
export async function updateClient(
  id: number,
  data: Partial<InsertClient>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
 
  // Verificar se o cliente existe
  const existingClient = await getClientById(id);
  if (!existingClient) {
    throw new Error("Cliente não encontrado");
  }
 
  // Filtra apenas os campos definidos para não sobrescrever com undefined
  const safeData: Partial<InsertClient> = {};
  if (data.name       !== undefined) safeData.name       = data.name;
  if (data.email      !== undefined) safeData.email      = data.email || null;
  if (data.phone      !== undefined) safeData.phone      = data.phone;
  if (data.address    !== undefined) safeData.address    = data.address;
  if (data.cnpjCpf    !== undefined) safeData.cnpjCpf    = data.cnpjCpf;
  if (data.syndicName   !== undefined) safeData.syndicName   = data.syndicName;
  if (data.profilePhoto !== undefined) (safeData as any).profilePhoto = data.profilePhoto;
  if (data.type         !== undefined) safeData.type         = data.type;
  if (data.active       !== undefined) safeData.active       = data.active;
 
  if (Object.keys(safeData).length === 0) return; // nada a atualizar
 
  await db.update(clients).set(safeData).where(eq(clients.id, id));
}
 
export async function deleteClient(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
 
  // Deleta documentos vinculados primeiro
  await db.delete(clientDocuments).where(eq(clientDocuments.clientId, id));
 
  // Depois deleta o cliente
  await db.delete(clients).where(eq(clients.id, id));
}
 
export async function updateClientLastLogin(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
 
  await db.update(clients).set({ lastLogin: new Date() }).where(eq(clients.id, id));
}

// Client document queries
export async function createClientDocument(document: InsertClientDocument) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(clientDocuments).values(document);
  return result;
}

export async function getDocumentsByClientId(clientId: number): Promise<ClientDocument[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  return await db.select().from(clientDocuments).where(eq(clientDocuments.clientId, clientId)).orderBy(desc(clientDocuments.uploadedAt));
}

export async function getDocumentById(id: number): Promise<ClientDocument | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.select().from(clientDocuments).where(eq(clientDocuments.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function deleteClientDocument(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.delete(clientDocuments).where(eq(clientDocuments.id, id));
}

export async function updateClientPassword(id: number, password: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
 
  const existingClient = await getClientById(id);
  if (!existingClient) {
    throw new Error("Cliente não encontrado");
  }
 
  await db.update(clients).set({ password }).where(eq(clients.id, id));
}


// Update admin custom label
export async function updateAdminCustomLabel(id: number, customLabel: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(admins).set({ customLabel }).where(eq(admins.id, id));
}


// Get all documents for admin
export async function getDocumentsByAdminId(adminId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const docs = await db
    .select({
      id: clientDocuments.id,
      clientId: clientDocuments.clientId,
      clientName: clients.name,
      title: clientDocuments.title,
      description: clientDocuments.description,
      documentType: clientDocuments.documentType,
      fileUrl: clientDocuments.fileUrl,
      createdAt: clientDocuments.createdAt,
    })
    .from(clientDocuments)
    .innerJoin(clients, eq(clientDocuments.clientId, clients.id))
    .where(eq(clients.adminId, adminId));
  
  return docs;
}

// Update document
export async function updateDocument(id: number, title: string, description: string, documentType: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(clientDocuments).set({ title, description, documentType: documentType as any }).where(eq(clientDocuments.id, id));
}

// Delete document
export async function deleteDocument(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.delete(clientDocuments).where(eq(clientDocuments.id, id));
}

// Update document file
export async function updateDocumentFile(id: number, fileUrl: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(clientDocuments).set({ fileUrl }).where(eq(clientDocuments.id, id));
}


// Work Order (OS) queries
export async function createWorkOrder(workOrder: InsertWorkOrder) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(workOrders).values(workOrder);
  return result;
}

export async function getWorkOrdersByAdminId(adminId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const orders = await db
    .select({
      id: workOrders.id,
      osNumber: workOrders.osNumber,
      title: workOrders.title,
      // BUSCA O NOME NA TABELA DE CLIENTES
      clientName: clients.name, 
      status: workOrders.status,
      priority: workOrders.priority,
      scheduledDate: workOrders.scheduledDate,
      createdAt: workOrders.createdAt,
    })
    .from(workOrders)
    // ESTA LINHA CONECTA AS DUAS TABELAS
    .innerJoin(clients, eq(workOrders.clientId, clients.id)) 
    .where(eq(workOrders.adminId, adminId))
    .orderBy(desc(workOrders.createdAt));
  
  return orders;
}

export async function listWorkOrders(filters: {
  clientId?: number;
  adminId?: number;
  status?: string;
}) {
  const db = await getDb();
  if (!db) return [];

  let query = db
    .select({
      id: workOrders.id,
      osNumber: workOrders.osNumber,
      title: workOrders.title,
      clientName: clients.name, // Nome do cliente via Join
      status: workOrders.status,
      priority: workOrders.priority,
      scheduledDate: workOrders.scheduledDate,
      createdAt: workOrders.createdAt,
      clientId: workOrders.clientId,
    })
    .from(workOrders)
    .innerJoin(clients, eq(workOrders.clientId, clients.id));

  const conditions = [];
  if (filters.adminId) conditions.push(eq(workOrders.adminId, filters.adminId));
  if (filters.clientId) conditions.push(eq(workOrders.clientId, filters.clientId));
  if (filters.status) conditions.push(eq(workOrders.status, filters.status as any));

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as any;
  }

  return await query.orderBy(desc(workOrders.createdAt));
}

export async function getWorkOrderById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db
    .select({
      id: workOrders.id,
      osNumber: workOrders.osNumber,
      title: workOrders.title,
      description: workOrders.description,
      serviceType: workOrders.serviceType,
      status: workOrders.status,
      priority: workOrders.priority,
      scheduledDate: workOrders.scheduledDate,
      completedAt: workOrders.completedAt,
      estimatedHours: workOrders.estimatedHours,
      actualHours: workOrders.actualHours,
      clientId: workOrders.clientId,
      clientName: clients.name,
      clientEmail: clients.email,
      clientPhone: clients.phone,
      createdAt: workOrders.createdAt,
      updatedAt: workOrders.updatedAt,
    })
    .from(workOrders)
    .innerJoin(clients, eq(workOrders.clientId, clients.id))
    .where(eq(workOrders.id, id))
    .limit(1);
  
  return result.length > 0 ? result[0] : null;
}

export async function updateWorkOrder(id: number, data: Partial<InsertWorkOrder>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(workOrders).set(data).where(eq(workOrders.id, id));
}

export async function deleteWorkOrder(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.delete(workOrders).where(eq(workOrders.id, id));
}

export async function getNextOSNumber() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const year = new Date().getFullYear();
  
  // Buscar todas as OS do ano atual para encontrar o maior número
  const osThisYear = await db
    .select({ osNumber: workOrders.osNumber })
    .from(workOrders)
    .where(sql`${workOrders.osNumber} LIKE ${`OS-${year}-%`}`);
  
  let maxNumber = 0;
  for (const os of osThisYear) {
    const parts = os.osNumber.split("-");
    if (parts.length >= 3) {
      const num = parseInt(parts[2] || "0");
      if (num > maxNumber) maxNumber = num;
    }
  }
  
  const nextNumber = maxNumber + 1;
  return `OS-${year}-${String(nextNumber).padStart(4, "0")}`;
}

// Document filtering functions
export async function getDocumentsByClientIdWithFilters(filters: {
  clientId: number;
  search?: string;
  documentType?: string;
  startDate?: string;
  endDate?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Build conditions array
  const conditions = [eq(clientDocuments.clientId, filters.clientId)];

  if (filters.search) {
    conditions.push(sql`${clientDocuments.title} COLLATE utf8mb4_general_ci LIKE ${`%${filters.search}%`}`);
  }

  if (filters.documentType && filters.documentType !== "all") {
    conditions.push(eq(clientDocuments.documentType, filters.documentType as any));
  }

  if (filters.startDate) {
    conditions.push(gte(clientDocuments.uploadedAt, new Date(filters.startDate)));
  }

  if (filters.endDate) {
    conditions.push(lte(clientDocuments.uploadedAt, new Date(filters.endDate)));
  }

  const results = await db
    .select()
    .from(clientDocuments)
    .where(and(...conditions))
    .orderBy(desc(clientDocuments.uploadedAt));

  return results;
}

export async function getAllDocumentsWithFilters(filters: {
  adminId: number;
  search?: string;
  clientId?: number;
  documentType?: string;
  startDate?: string;
  endDate?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Build conditions array
  const conditions: any[] = [];

  if (filters.clientId) {
    conditions.push(eq(clientDocuments.clientId, filters.clientId));
  }

  if (filters.search) {
    conditions.push(sql`${clientDocuments.title} COLLATE utf8mb4_general_ci LIKE ${`%${filters.search}%`}`);
  }

  if (filters.documentType && filters.documentType !== "all") {
    conditions.push(eq(clientDocuments.documentType, filters.documentType as any));
  }

  if (filters.startDate) {
    conditions.push(gte(clientDocuments.uploadedAt, new Date(filters.startDate)));
  }

  if (filters.endDate) {
    conditions.push(lte(clientDocuments.uploadedAt, new Date(filters.endDate)));
  }

  let query = db
    .select({
      id: clientDocuments.id,
      title: clientDocuments.title,
      description: clientDocuments.description,
      documentType: clientDocuments.documentType,
      fileUrl: clientDocuments.fileUrl,
      fileKey: clientDocuments.fileKey,
      fileSize: clientDocuments.fileSize,
      mimeType: clientDocuments.mimeType,
      uploadedAt: clientDocuments.uploadedAt,
      clientId: clientDocuments.clientId,
      clientName: clients.name,
      clientEmail: clients.email,
    })
    .from(clientDocuments)
    .innerJoin(clients, eq(clientDocuments.clientId, clients.id));

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as any;
  }

  const results = await query.orderBy(desc(clientDocuments.uploadedAt));
  return results;
}

export async function getAllDocumentsByAdminId(adminId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const results = await db
    .select({
      id: clientDocuments.id,
      title: clientDocuments.title,
      clientId: clientDocuments.clientId,
      clientName: clients.name,
      adminId: clientDocuments.adminId,
    })
    .from(clientDocuments)
    .where(eq(clientDocuments.adminId, adminId));

  return results;
}
