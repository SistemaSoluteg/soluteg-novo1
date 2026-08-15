import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { waterTankMonitoring } from "../drizzle/schema";

function computeStatus(level: number): "otimo" | "bom" | "alerta" | "critico" {
  if (level >= 75) return "otimo";
  if (level >= 50) return "bom";
  if (level >= 25) return "alerta";
  return "critico";
}

export async function saveWaterTankReading(data: {
  clientId: number;
  adminId: number;
  tenantId?: number | null;
  tankName: string;
  currentLevel: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB indisponível");

  // Carimbo best-effort de tenantId — SEM fail-closed. Esta é a ponta de ingestão
  // (MQTT + registro manual): perder uma leitura de nível por tenantId ausente é
  // risco real (caixa secar/transbordar sem alerta). tenantId null é aceito e
  // corrigido depois por backfill.
  return db.insert(waterTankMonitoring).values({
    clientId: data.clientId,
    adminId: data.adminId,
    tenantId: data.tenantId ?? null,
    tankName: data.tankName,
    currentLevel: data.currentLevel,
    status: computeStatus(data.currentLevel),
  });
}

export async function getAllTankHistories(
  clientId: number,
): Promise<Record<string, Array<{ level: number; time: Date }>>> {
  const db = await getDb();
  if (!db) return {};

  // Fetch last 500 readings (covers ~50 per tank for up to 10 tanks), then group in JS
  const result = await db.execute(sql`
    SELECT tankName, currentLevel AS level, measuredAt AS time
    FROM waterTankMonitoring
    WHERE clientId = ${clientId}
    ORDER BY measuredAt DESC
    LIMIT 500
  `);
  const rows = (result as unknown as [any[], any])[0] as any[];

  const byTank: Record<string, Array<{ level: number; time: Date }>> = {};
  for (const row of rows) {
    const name = row.tankName as string;
    if (!byTank[name]) byTank[name] = [];
    if (byTank[name].length < 60) {
      byTank[name].push({ level: Number(row.level), time: row.time });
    }
  }
  // Reverse to chronological order per tank
  for (const k of Object.keys(byTank)) byTank[k].reverse();
  return byTank;
}

export async function getClientAlertLog(
  clientId: number,
  tankName: string,
  limit = 20,
): Promise<Array<{
  id: number;
  alertType: string;
  triggerPct: number;
  currentLevel: number;
  sentAt: Date;
}>> {
  const db = await getDb();
  if (!db) return [];

  const result = await db.execute(sql`
    SELECT a.id, a.alertType, a.triggerPct, a.currentLevel, a.sentAt
    FROM waterTankAlertLog a
    JOIN waterTankSensors s ON s.id = a.sensorId
    WHERE s.clientId = ${clientId}
      AND s.tankName = ${tankName}
    ORDER BY a.sentAt DESC
    LIMIT ${limit}
  `);
  return (result as unknown as [any[], any])[0] as any[];
}

export async function getLatestTankReadings(clientId: number): Promise<Array<{
  id: number | null;
  tankName: string;
  currentLevel: number | null;
  capacity: number | null;
  status: string | null;
  notes: string | null;
  measuredAt: Date | null;
  deadVolumePct: number;
  alarm1Pct: number;
  alarm2Pct: number;
}>> {
  const db = await getDb();
  if (!db) return [];

  const [rows] = await db.execute(sql`
    SELECT
      latest.id,
      s.tankName,
      latest.currentLevel,
      COALESCE(s.capacity, latest.capacity) AS capacity,
      latest.status,
      COALESCE(s.notes, latest.notes) AS notes,
      latest.measuredAt,
      s.deadVolumePct,
      s.alarm1Pct,
      s.alarm2Pct
    FROM waterTankSensors s
    LEFT JOIN (
      SELECT w1.*
      FROM waterTankMonitoring w1
      INNER JOIN (
        SELECT tankName, MAX(measuredAt) AS maxAt
        FROM waterTankMonitoring
        WHERE clientId = ${clientId}
        GROUP BY tankName
      ) w2 ON w1.tankName = w2.tankName AND w1.measuredAt = w2.maxAt
      WHERE w1.clientId = ${clientId}
    ) latest ON latest.tankName = s.tankName
    WHERE s.clientId = ${clientId} AND s.active = 1
    ORDER BY s.tankName
  `);

  return rows as any;
}
