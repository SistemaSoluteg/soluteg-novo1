import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { waterTankSensors } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

// ── Auto-discovery ────────────────────────────────────────────────────────────

/**
 * Called every time a sensor publishes a message.
 * Creates the sensor record on first contact; updates lastSeenAt on subsequent messages.
 */
export async function upsertSensorDevice(deviceId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db.execute(sql`
    INSERT INTO waterTankSensors (deviceId, lastSeenAt, active)
    VALUES (${deviceId}, NOW(), 1)
    ON DUPLICATE KEY UPDATE lastSeenAt = NOW()
  `);
}

/**
 * Returns sensor config if the device is fully assigned (clientId + tankName set).
 * Returns null if pending (not yet assigned by admin).
 *
 * Lookup por deviceId — GLOBAL POR DESIGN (é o "login" do sensor via MQTT, sem
 * ctx/tenant disponível nessa ponta). Só ganha o campo tenantId no retorno,
 * usado a jusante (mqttService/waterTankDb/waterTankAlertService) para carimbar
 * as escritas — sem filtro aqui.
 */
export async function getAssignedSensorByDeviceId(deviceId: string): Promise<{
  id: number;
  tenantId: number | null;
  clientId: number;
  adminId: number;
  tankName: string;
  deadVolumePct: number;
  alarm1Pct: number;
  alarm2Pct: number;
  distVazia: number | null;
  distCheia: number | null;
} | null> {
  const db = await getDb();
  if (!db) return null;

  const result = await db.execute(sql`
    SELECT id, tenantId, clientId, adminId, tankName, deadVolumePct, alarm1Pct, alarm2Pct,
           distVazia, distCheia
    FROM waterTankSensors
    WHERE deviceId = ${deviceId}
      AND clientId IS NOT NULL
      AND tankName IS NOT NULL
      AND active = 1
    LIMIT 1
  `);
  const rows = (result as unknown as [any[], any])[0] as any[];
  return rows[0] ?? null;
}

// ── Pending sensors ───────────────────────────────────────────────────────────

// GLOBAL POR DESIGN: sensores pendentes (clientId/tenantId NULL, device anunciado
// mas não atribuído) são um pool compartilhado — qualquer admin vê e pode reivindicar
// qualquer device pendente. Não é vazamento de dado de tenant (pendente não tem dono
// ainda), mas em multi-tenant real é uma política que precisa de decisão futura
// (provavelmente via platformAdmin). Por enquanto mantido global, sem filtro.
export async function listPendingSensors(): Promise<Array<{
  id: number;
  deviceId: string;
  lastSeenAt: Date | null;
  createdAt: Date;
}>> {
  const db = await getDb();
  if (!db) return [];

  const result = await db.execute(sql`
    SELECT id, deviceId, lastSeenAt, createdAt
    FROM waterTankSensors
    WHERE clientId IS NULL
    ORDER BY lastSeenAt DESC, createdAt DESC
  `);
  return (result as unknown as [any[], any])[0] as any[];
}

// ── Assigned sensors ──────────────────────────────────────────────────────────

export async function listSensorsWithStatus(tenantId: number): Promise<Array<{
  id: number;
  deviceId: string | null;
  clientId: number;
  clientName: string;
  tankName: string;
  capacity: number | null;
  notes: string | null;
  deadVolumePct: number;
  alarm1Pct: number;
  alarm2Pct: number;
  alarm3BoiaPct: number;
  alarm3BoiaEnabled: number;
  technicianId: number | null;
  technicianName: string | null;
  technicianPhone: string | null;
  dropStepPct: number;
  tankType: string;
  alertPhone: string | null;
  alertPhone2: string | null;
  distVazia: number | null;
  distCheia: number | null;
  active: number;
  lastSeenAt: Date | null;
  createdAt: Date;
  currentLevel: number | null;
  lastUpdate: Date | null;
  status: string | null;
}>> {
  const db = await getDb();
  if (!db) return [];

  const result = await db.execute(sql`
    SELECT
      s.id, s.deviceId, s.clientId, c.name AS clientName,
      s.tankName, s.capacity, s.notes,
      s.deadVolumePct, s.alarm1Pct, s.alarm2Pct, s.alarm3BoiaPct,
      s.alarm3BoiaEnabled, s.technicianId, s.dropStepPct, s.tankType,
      s.alertPhone, s.alertPhone2, s.distVazia, s.distCheia,
      s.active, s.lastSeenAt, s.createdAt,
      t.name AS technicianName, t.phone AS technicianPhone,
      latest.currentLevel, latest.measuredAt AS lastUpdate, latest.status
    FROM waterTankSensors s
    LEFT JOIN clients c ON c.id = s.clientId
    LEFT JOIN technicians t ON t.id = s.technicianId
    LEFT JOIN (
      SELECT w1.*
      FROM waterTankMonitoring w1
      INNER JOIN (
        SELECT clientId, tankName, MAX(measuredAt) AS maxAt
        FROM waterTankMonitoring
        GROUP BY clientId, tankName
      ) w2 ON w1.clientId = w2.clientId AND w1.tankName = w2.tankName AND w1.measuredAt = w2.maxAt
    ) latest ON latest.clientId = s.clientId AND latest.tankName = s.tankName
    WHERE s.tenantId = ${tenantId} AND s.clientId IS NOT NULL
    ORDER BY c.name, s.tankName
  `);

  return (result as unknown as [any[], any])[0] as any[];
}

// ── Assign / update / delete ──────────────────────────────────────────────────

export type AssignData = {
  clientId: number;
  adminId: number;
  tenantId: number;
  tankName: string;
  capacity?: number | null;
  notes?: string | null;
  deadVolumePct?: number;
  alarm1Pct?: number;
  alarm2Pct?: number;
  alarm3BoiaPct?: number;
  alarm3BoiaEnabled?: number; // 1 = habilitado, 0 = desabilitado
  technicianId?: number | null;
  dropStepPct?: number;
  tankType?: "superior" | "inferior";
  alertPhone?: string | null;
  alertPhone2?: string | null;
  distVazia?: number | null;
  distCheia?: number | null;
};

export async function assignSensor(sensorId: number, data: AssignData) {
  const db = await getDb();
  if (!db) throw new Error("DB indisponível");

  return db
    .update(waterTankSensors)
    .set({
      clientId: data.clientId,
      adminId: data.adminId,
      tenantId: data.tenantId,
      tankName: data.tankName,
      capacity: data.capacity ?? null,
      notes: data.notes ?? null,
      deadVolumePct: data.deadVolumePct ?? 0,
      alarm1Pct: data.alarm1Pct ?? 30,
      alarm2Pct: data.alarm2Pct ?? 15,
      alarm3BoiaPct: data.alarm3BoiaPct ?? 90,
      alarm3BoiaEnabled: data.alarm3BoiaEnabled ?? 1,
      technicianId: data.technicianId ?? null,
      dropStepPct: data.dropStepPct ?? 10,
      tankType: data.tankType ?? "superior",
      alertPhone: data.alertPhone ?? null,
      alertPhone2: data.alertPhone2 ?? null,
      distVazia: data.distVazia ?? null,
      distCheia: data.distCheia ?? null,
      active: 1,
    })
    .where(eq(waterTankSensors.id, sensorId));
}

export async function updateSensor(
  id: number,
  tenantId: number,
  data: Partial<Omit<AssignData, "clientId" | "adminId" | "tenantId">>,
) {
  const db = await getDb();
  if (!db) throw new Error("DB indisponível");

  return db
    .update(waterTankSensors)
    .set({ ...data })
    .where(and(eq(waterTankSensors.id, id), eq(waterTankSensors.tenantId, tenantId)));
}

export async function deleteSensor(id: number, tenantId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB indisponível");

  // Pending sensors (tenantId IS NULL) or sensors owned by this tenant can be deleted
  await db.execute(sql`
    DELETE FROM waterTankSensors
    WHERE id = ${id} AND (tenantId IS NULL OR tenantId = ${tenantId})
  `);
}

// ── Dashboard helpers (unchanged) ─────────────────────────────────────────────

export async function getSensorById(sensorId: number, tenantId: number): Promise<{
  id: number;
  deviceId: string | null;
  clientId: number;
  clientName: string;
  clientPhone: string | null;
  tankName: string;
  capacity: number | null;
  notes: string | null;
  deadVolumePct: number;
  alarm1Pct: number;
  alarm2Pct: number;
  alarm3BoiaPct: number;
  dropStepPct: number;
  tankType: string;
  alertPhone: string | null;
  alertPhone2: string | null;
  active: number;
  createdAt: Date;
  currentLevel: number | null;
  lastUpdate: Date | null;
} | null> {
  const db = await getDb();
  if (!db) return null;

  const result = await db.execute(sql`
    SELECT s.id, s.deviceId, s.clientId, c.name AS clientName, c.phone AS clientPhone,
           s.tankName, s.capacity, s.notes,
           s.deadVolumePct, s.alarm1Pct, s.alarm2Pct, s.alarm3BoiaPct, s.dropStepPct, s.tankType,
           s.alertPhone, s.alertPhone2, s.active, s.createdAt,
           latest.currentLevel, latest.measuredAt AS lastUpdate
    FROM waterTankSensors s
    LEFT JOIN clients c ON c.id = s.clientId
    LEFT JOIN (
      SELECT currentLevel, measuredAt, clientId, tankName
      FROM waterTankMonitoring
      WHERE clientId = (SELECT clientId FROM waterTankSensors WHERE id = ${sensorId})
        AND tankName = (SELECT tankName FROM waterTankSensors WHERE id = ${sensorId})
      ORDER BY measuredAt DESC
      LIMIT 1
    ) latest ON latest.clientId = s.clientId AND latest.tankName = s.tankName
    WHERE s.id = ${sensorId} AND s.tenantId = ${tenantId}
    LIMIT 1
  `);
  const rows = (result as unknown as [any[], any])[0] as any[];
  return rows[0] ?? null;
}

/**
 * Retorna histórico downsampled para o período pedido.
 * Usa MAX(currentLevel) por bucket de tempo para evitar enviar dezenas de
 * milhares de pontos ao cliente — e ainda preservar picos reais.
 *
 * Bucket automático:
 *   ≤ 0.25 d (6 h) → 5 min  → ≈ 72 pontos
 *   ≤ 1 d          → 15 min → ≈ 96 pontos
 *   ≤ 7 d          → 1 h    → ≈ 168 pontos
 *   ≤ 30 d         → 4 h    → ≈ 180 pontos
 */
export async function getSensorReadingHistory(
  clientId: number,
  tankName: string,
  days = 1,
): Promise<Array<{ currentLevel: number; measuredAt: Date }>> {
  const db = await getDb();
  if (!db) return [];

  let bucketSeconds: number;
  if (days <= 0.25)     bucketSeconds = 300;     // 5 min
  else if (days <= 1)   bucketSeconds = 900;     // 15 min
  else if (days <= 7)   bucketSeconds = 3600;    // 1 h
  else                  bucketSeconds = 14400;   // 4 h

  // MySQL não aceita bind param dentro de INTERVAL, nem em literais inteiros
  // de FLOOR/FROM_UNIXTIME quando são repetidos. Usamos sql.raw() para esses.
  const b = sql.raw(String(bucketSeconds));
  // Drizzle com mysql2 não converte Date → datetime automaticamente em sql``.
  // Formata manualmente como 'YYYY-MM-DD HH:MM:SS' em UTC.
  const cutoffDate = new Date(Date.now() - days * 86400 * 1000);
  const cutoff = sql.raw(`'${cutoffDate.toISOString().slice(0, 19).replace("T", " ")}'`);

  const result = await db.execute(sql`
    SELECT MAX(currentLevel) AS currentLevel, bucket AS measuredAt
    FROM (
      SELECT
        currentLevel,
        FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(measuredAt) / ${b}) * ${b}) AS bucket
      FROM waterTankMonitoring
      WHERE clientId  = ${clientId}
        AND tankName  = ${tankName}
        AND measuredAt >= ${cutoff}
    ) t
    GROUP BY bucket
    ORDER BY bucket ASC
  `);
  return (result as unknown as [any[], any])[0] as any[];
}

export async function getSensorAlertLog(
  sensorId: number,
  limit = 50,
): Promise<Array<{
  id: number;
  alertType: string;
  triggerPct: number;
  currentLevel: number;
  sentTo: string | null;
  sentAt: Date;
}>> {
  const db = await getDb();
  if (!db) return [];

  const result = await db.execute(sql`
    SELECT id, alertType, triggerPct, currentLevel, sentTo, sentAt
    FROM waterTankAlertLog
    WHERE sensorId = ${sensorId}
    ORDER BY sentAt DESC
    LIMIT ${limit}
  `);
  return (result as unknown as [any[], any])[0] as any[];
}
