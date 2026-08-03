import { router, adminLocalProcedure } from "../_core/trpc";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  listSensorsWithStatus,
  listPendingSensors,
  assignSensor,
  updateSensor,
  deleteSensor,
  getSensorById,
  getSensorReadingHistory,
  getSensorAlertLog,
} from "../waterTankSensorDb";
import { invalidateSensorCache, invalidateSensorAlertState } from "../mqttService";

const calibrationFields = {
  distVazia: z.number().int().positive().nullable().optional(),
  distCheia: z.number().int().positive().nullable().optional(),
};

const sensorTypeFields = {
  tankType: z.enum(["superior", "inferior"]).default("superior"),
  alarm3BoiaPct: z.number().min(0).max(100).default(90),
  alarm3BoiaEnabled: z.number().int().min(0).max(1).default(1),
  technicianId: z.number().int().positive().nullable().optional(), // técnico acionado no alarm2
  dropStepPct: z.number().min(1).max(50).default(10),
};

const assignFields = {
  clientId: z.number().int().positive(),
  tankName: z.string().min(1).max(100),
  capacity: z.number().int().positive().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  deadVolumePct: z.number().int().min(0).max(99).optional(),
  alarm1Pct: z.number().int().min(0).max(100).optional(),
  alarm2Pct: z.number().int().min(0).max(100).optional(),
  alertPhone: z.string().max(30).nullable().optional(),
  alertPhone2: z.string().max(30).nullable().optional(),
  ...calibrationFields,
  ...sensorTypeFields,
};

const updateFields = {
  tankName: z.string().min(1).max(100),
  capacity: z.number().int().positive().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  deadVolumePct: z.number().int().min(0).max(99).optional(),
  alarm1Pct: z.number().int().min(0).max(100).optional(),
  alarm2Pct: z.number().int().min(0).max(100).optional(),
  alertPhone: z.string().max(30).nullable().optional(),
  alertPhone2: z.string().max(30).nullable().optional(),
  ...calibrationFields,
  ...sensorTypeFields,
};

export const waterTankAdminRouter = router({
  /** Sensors waiting for assignment (clientId is null) */
  listPending: adminLocalProcedure
    .input(z.object({ adminId: z.number() }))
    .query(async () => {
      return listPendingSensors();
    }),

  /** Sensors already assigned to a client under this admin */
  listSensors: adminLocalProcedure
    .input(z.object({ adminId: z.number() }))
    .query(async ({ input }) => {
      return listSensorsWithStatus(input.adminId);
    }),

  /** Assign a pending sensor to a client and name the tank */
  assignSensor: adminLocalProcedure
    .input(z.object({ adminId: z.number(), sensorId: z.number(), ...assignFields }))
    .mutation(async ({ input }) => {
      // Busca deviceId para invalidar caches após a atribuição
      const db = await getDb();
      const devResult = db ? await db.execute(sql`SELECT deviceId FROM waterTankSensors WHERE id = ${input.sensorId} LIMIT 1`) : null;
      const deviceId: string | null = devResult ? ((devResult as unknown as [any[], any])[0] as any[])[0]?.deviceId ?? null : null;

      await assignSensor(input.sensorId, {
        clientId: input.clientId,
        adminId: input.adminId,
        tankName: input.tankName,
        capacity: input.capacity ?? null,
        notes: input.notes ?? null,
        deadVolumePct: input.deadVolumePct ?? 0,
        alarm1Pct: input.alarm1Pct ?? 30,
        alarm2Pct: input.alarm2Pct ?? 15,
        alarm3BoiaPct: input.alarm3BoiaPct,
        alarm3BoiaEnabled: input.alarm3BoiaEnabled,
        technicianId: input.technicianId ?? null,
        dropStepPct: input.dropStepPct,
        tankType: input.tankType,
        alertPhone: input.alertPhone ?? null,
        alertPhone2: input.alertPhone2 ?? null,
        distVazia: input.distVazia ?? null,
        distCheia: input.distCheia ?? null,
      });

      if (deviceId) {
        invalidateSensorCache(deviceId);
        invalidateSensorAlertState(deviceId);
      }
      return { ok: true };
    }),

  /** Update config of an already-assigned sensor */
  updateSensor: adminLocalProcedure
    .input(z.object({ adminId: z.number(), sensorId: z.number(), ...updateFields }))
    .mutation(async ({ input }) => {
      // Busca deviceId para invalidar caches após a atualização
      const db = await getDb();
      const devResult = db ? await db.execute(sql`SELECT deviceId FROM waterTankSensors WHERE id = ${input.sensorId} AND adminId = ${input.adminId} LIMIT 1`) : null;
      const deviceId: string | null = devResult ? ((devResult as unknown as [any[], any])[0] as any[])[0]?.deviceId ?? null : null;

      await updateSensor(input.sensorId, input.adminId, {
        tankName: input.tankName,
        capacity: input.capacity ?? null,
        notes: input.notes ?? null,
        deadVolumePct: input.deadVolumePct ?? 0,
        alarm1Pct: input.alarm1Pct ?? 30,
        alarm2Pct: input.alarm2Pct ?? 15,
        alarm3BoiaPct: input.alarm3BoiaPct,
        alarm3BoiaEnabled: input.alarm3BoiaEnabled,
        technicianId: input.technicianId ?? null,
        dropStepPct: input.dropStepPct,
        tankType: input.tankType,
        alertPhone: input.alertPhone ?? null,
        alertPhone2: input.alertPhone2 ?? null,
        distVazia: input.distVazia ?? null,
        distCheia: input.distCheia ?? null,
      });

      if (deviceId) {
        invalidateSensorCache(deviceId);
        invalidateSensorAlertState(deviceId);
      }
      return { ok: true };
    }),

  deleteSensor: adminLocalProcedure
    .input(z.object({ adminId: z.number(), sensorId: z.number() }))
    .mutation(async ({ input }) => {
      await deleteSensor(input.sensorId, input.adminId);
      return { ok: true };
    }),

  getSensorDashboard: adminLocalProcedure
    .input(z.object({ adminId: z.number(), sensorId: z.number(), days: z.number().positive().max(30).optional() }))
    .query(async ({ input }) => {
      const sensor = await getSensorById(input.sensorId, input.adminId);
      if (!sensor) throw new Error("Sensor não encontrado");
      const [history, alerts] = await Promise.all([
        getSensorReadingHistory(sensor.clientId, sensor.tankName, input.days ?? 1),
        getSensorAlertLog(input.sensorId),
      ]);
      return { sensor, history, alerts };
    }),

  /** Registra uma falha de equipamento vinculada a um sensor */
  registerFault: adminLocalProcedure
    .input(z.object({
      adminId: z.number(),
      sensorId: z.number(),
      faultType: z.enum(["boia", "cebola", "bomba", "falta_agua", "tubulacao", "acionamento", "fiacao", "outro"]),
      description: z.string().optional(),
      osId: z.number().optional(),
      registeredBy: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB indisponível");

      // Valida que o sensor pertence ao admin e obtém clientId / tankName
      const sensorResult = await db.execute(sql`
        SELECT id, clientId, tankName
        FROM waterTankSensors
        WHERE id = ${input.sensorId} AND adminId = ${input.adminId}
        LIMIT 1
      `);
      const sensors = (sensorResult as unknown as [any[], any])[0] as any[];
      if (!sensors.length) throw new Error("Sensor não encontrado");
      const sensor = sensors[0];

      // Última leitura do sensor
      const levelResult = await db.execute(sql`
        SELECT currentLevel
        FROM waterTankMonitoring
        WHERE clientId = ${sensor.clientId} AND tankName = ${sensor.tankName}
        ORDER BY measuredAt DESC
        LIMIT 1
      `);
      const levels = (levelResult as unknown as [any[], any])[0] as any[];
      const levelAtFault: number = levels[0]?.currentLevel ?? 0;

      // Valida que a OS vinculada pertence ao mesmo admin (se fornecida)
      let resolvedOsId: number | null = null;
      if (input.osId != null) {
        const osCheck = await db.execute(sql`
          SELECT id FROM workOrders WHERE id = ${input.osId} AND adminId = ${input.adminId} LIMIT 1
        `);
        const osRows = (osCheck as unknown as [any[], any])[0] as any[];
        if (osRows.length) resolvedOsId = input.osId;
        // Se não encontrar, ignora silenciosamente (não vincula OS inválida)
      }

      const insertResult = await db.execute(sql`
        INSERT INTO waterTankFaultLog
          (sensorId, clientId, tankName, faultType, description, levelAtFault, osId, registeredBy)
        VALUES
          (${input.sensorId}, ${sensor.clientId}, ${sensor.tankName},
           ${input.faultType}, ${input.description ?? null}, ${levelAtFault},
           ${resolvedOsId}, ${input.registeredBy ?? null})
      `);
      const insertId = (insertResult as unknown as [any, any])[0].insertId as number;

      return { success: true, id: insertId };
    }),

  /** Lista falhas registradas de sensores do admin */
  listFaults: adminLocalProcedure
    .input(z.object({
      adminId: z.number(),
      sensorId: z.number().optional(),
      limit: z.number().default(50),
      offset: z.number().default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      const sensorFilter = input.sensorId != null
        ? sql`AND f.sensorId = ${input.sensorId}`
        : sql``;

      const result = await db.execute(sql`
        SELECT
          f.id, f.sensorId, f.clientId, f.tankName, f.faultType,
          f.description, f.levelAtFault, f.osId, f.registeredBy, f.createdAt,
          wo.osNumber
        FROM waterTankFaultLog f
        JOIN waterTankSensors s ON s.id = f.sensorId
        LEFT JOIN workOrders wo ON wo.id = f.osId
        WHERE s.adminId = ${input.adminId}
        ${sensorFilter}
        ORDER BY f.createdAt DESC
        LIMIT ${input.limit} OFFSET ${input.offset}
      `);

      return (result as unknown as [any[], any])[0] as any[];
    }),

  /** Estatísticas de falhas e alertas do período */
  getFaultStats: adminLocalProcedure
    .input(z.object({
      adminId: z.number(),
      sensorId: z.number().optional(),
      days: z.number().default(30),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { byType: [], totalFaults: 0, totalAlerts: 0 };

      const cutoff = sql.raw(
        `'${new Date(Date.now() - input.days * 86400 * 1000).toISOString().slice(0, 19).replace("T", " ")}'`,
      );
      const sensorFilter = input.sensorId != null
        ? sql`AND f.sensorId = ${input.sensorId}`
        : sql``;
      const sensorFilterAlert = input.sensorId != null
        ? sql`AND al.sensorId = ${input.sensorId}`
        : sql``;

      const [byTypeResult, totalsResult] = await Promise.all([
        db.execute(sql`
          SELECT
            f.faultType,
            COUNT(*) AS count,
            MAX(f.createdAt) AS lastOccurrence,
            MIN(f.createdAt) AS firstOccurrence
          FROM waterTankFaultLog f
          JOIN waterTankSensors s ON s.id = f.sensorId
          WHERE s.adminId = ${input.adminId}
            AND f.createdAt >= ${cutoff}
            ${sensorFilter}
          GROUP BY f.faultType
          ORDER BY count DESC
        `),
        db.execute(sql`
          SELECT
            (SELECT COUNT(*) FROM waterTankAlertLog al
             JOIN waterTankSensors s ON s.id = al.sensorId
             WHERE s.adminId = ${input.adminId}
               AND al.sentAt >= ${cutoff}
               ${sensorFilterAlert}
            ) AS totalAlerts,
            (SELECT COUNT(*) FROM waterTankFaultLog f
             JOIN waterTankSensors s ON s.id = f.sensorId
             WHERE s.adminId = ${input.adminId}
               AND f.createdAt >= ${cutoff}
               ${sensorFilter}
            ) AS totalFaults
        `),
      ]);

      const byType = (byTypeResult as unknown as [any[], any])[0] as any[];
      const totals = ((totalsResult as unknown as [any[], any])[0] as any[])[0] ?? {};

      return {
        byType,
        totalFaults: Number(totals.totalFaults ?? 0),
        totalAlerts: Number(totals.totalAlerts ?? 0),
      };
    }),

  /** Alertas recentes disparados pelos sensores do admin */
  listRecentAlerts: adminLocalProcedure
    .input(z.object({
      adminId: z.number(),
      limit: z.number().default(20),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      const result = await db.execute(sql`
        SELECT
          al.sensorId, al.tankName, c.name AS clientName,
          al.alertType, al.currentLevel, al.triggerPct,
          al.direction, al.tankType, al.observation, al.sentAt
        FROM waterTankAlertLog al
        JOIN waterTankSensors s ON s.id = al.sensorId
        JOIN clients c ON c.id = al.clientId
        WHERE s.adminId = ${input.adminId}
        ORDER BY al.sentAt DESC
        LIMIT ${input.limit}
      `);

      return (result as unknown as [any[], any])[0] as any[];
    }),
});
