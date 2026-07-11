/**
 * waterTankAlertService.ts
 *
 * Verifica limiares de alarme após cada flush MQTT e dispara alertas WhatsApp + email.
 *
 * Regras de negócio (ver ALARMS.md para detalhes completos):
 *
 * Caixa Superior:
 *   alarm1 → WhatsApp admin + cliente: orientar verificação de cisterna, painel, disjuntor, eletroboias
 *   alarm2 → WhatsApp admin + cliente + cria OS emergencial automaticamente
 *   sci    → WhatsApp admin + cliente (OS já criada no alarm2)
 *   alarm3_boia → WhatsApp admin: pane na boia de corte da bomba (habilitável por sensor)
 *
 * Caixa Inferior:
 *   alarm1 → WhatsApp admin + cliente: orientar verificar entrada de água, racionar
 *   alarm2 → WhatsApp admin + cliente + cria OS emergencial (possível falha na boia inferior)
 *   sci    → WhatsApp admin + cliente (OS já criada no alarm2)
 *   alarm3_boia → WhatsApp admin: pane na boia mecânica (habilitável por sensor)
 *
 * Garantia de entrega:
 *   - Se WhatsApp offline: salva delivered=0 no log → reenviado ao reconectar
 *   - Fallback email se WhatsApp falhar 3x
 */

import { sql } from "drizzle-orm";
import { getDb } from "./db";
import type { SensorAlertState, SensorZone } from "./mqttService";
import { sendPushToUser, type PushPayload } from "./lib/webPush";

const CONFIRM = 5;          // alarm1, drop_step — filtro de ruído (2,5 min de queda)
const CONFIRM_CRITICAL = 1; // alarm2, sci_reserve — nível crítico dispara no primeiro flush

type AlertType =
  | "alarm1"
  | "alarm2"
  | "alarm3_boia"
  | "sci_reserve"
  | "drop_step"
  | "filling"
  | "level_restored"
  | "boia_fault";

interface SensorConfig {
  id: number;
  adminId: number;
  clientId: number;
  clientName: string;
  clientPhone: string | null;
  tankType: "superior" | "inferior";
  deadVolumePct: number;
  alarm1Pct: number;
  alarm2Pct: number;
  alarm3BoiaPct: number;
  alarm3BoiaEnabled: number; // 0 ou 1
  technicianId: number | null;
  technicianPhone: string | null;
  technicianName: string | null;
  dropStepPct: number;
  alertPhone: string | null;
}

function determineZone(level: number, cfg: SensorConfig): SensorZone {
  if (cfg.deadVolumePct > 0 && level < cfg.deadVolumePct) return "sci";
  if (level < cfg.alarm2Pct) return "alarm2";
  if (level < cfg.alarm1Pct) return "alarm1";
  if (level > cfg.alarm3BoiaPct) return "boia_high";
  return "normal";
}

// ── Mensagens por tipo de caixa ───────────────────────────────────────────────

function buildAlarm1Message(tankType: "superior" | "inferior", clientName: string, tankName: string, level: number): string {
  const base = `Cliente: ${clientName}\nCaixa: ${tankName}\nNível atual: ${level}%`;

  if (tankType === "superior") {
    return [
      `⚠️ ATENÇÃO — Caixa d'Água Superior`,
      base,
      ``,
      `Verifique:`,
      `• Nível da cisterna (caixa inferior)`,
      `• Alarmes no painel elétrico`,
      `• Se o disjuntor da bomba está ligado`,
      `• Se houve queda de energia`,
      `• Teste as eletroboias`,
    ].join("\n");
  }

  return [
    `⚠️ ATENÇÃO — Cisterna (Caixa Inferior)`,
    base,
    ``,
    `Verifique a entrada de água da rede pública no prédio.`,
    `Pode haver queda de pressão ou falta d'água.`,
    `Oriente os moradores a racionar o consumo.`,
  ].join("\n");
}

function buildAlarm2Message(tankType: "superior" | "inferior", clientName: string, tankName: string, level: number): string {
  const base = `Cliente: ${clientName}\nCaixa: ${tankName}\nNível atual: ${level}%`;

  if (tankType === "superior") {
    return [
      `🚨 NÍVEL CRÍTICO — Caixa d'Água Superior`,
      base,
      ``,
      `Nível crítico detectado.`,
      `OS emergencial criada automaticamente.`,
      `Técnico será acionado.`,
    ].join("\n");
  }

  return [
    `🚨 NÍVEL CRÍTICO — Cisterna (Caixa Inferior)`,
    base,
    ``,
    `ATENÇÃO: Possível falha na boia inferior.`,
    `DESLIGAR IMEDIATAMENTE A BOMBA DE RECALQUE.`,
    `OS emergencial criada — técnico será acionado para troca da boia.`,
  ].join("\n");
}

function buildAlarm3BoiaMessage(tankType: "superior" | "inferior", clientName: string, tankName: string, level: number, triggerPct: number): string {
  const base = `Cliente: ${clientName}\nCaixa: ${tankName}\nNível atual: ${level}%`;

  if (tankType === "superior") {
    return [
      `🔧 PANE NA BOIA SUPERIOR`,
      base,
      ``,
      `Nível ultrapassou ${triggerPct}%.`,
      `Possível pane na boia de corte da bomba de recalque.`,
      `Verificar imediatamente.`,
    ].join("\n");
  }

  return [
    `🔧 PANE NA BOIA MECÂNICA — Cisterna`,
    base,
    ``,
    `Nível ultrapassou ${triggerPct}%.`,
    `Possível pane na boia mecânica de corte da entrada de água.`,
    `Verificar imediatamente.`,
  ].join("\n");
}

function buildGenericMessage(
  type: AlertType,
  tankType: "superior" | "inferior",
  clientName: string,
  tankName: string,
  currentLevel: number,
  triggerPct: number,
): string {
  const base = `Cliente: ${clientName}\nCaixa: ${tankName}\nNível atual: ${currentLevel}%`;

  switch (type) {
    case "alarm1": return buildAlarm1Message(tankType, clientName, tankName, currentLevel);
    case "alarm2": return buildAlarm2Message(tankType, clientName, tankName, currentLevel);
    case "alarm3_boia": return buildAlarm3BoiaMessage(tankType, clientName, tankName, currentLevel, triggerPct);

    case "drop_step":
      return `📉 NÍVEL CAINDO — Caixa d'Água\n${base}\nSem recuperação desde o último alerta.`;

    case "boia_fault":
      return `🔧 FALHA DE BOIA — Cisterna\n${base}\nCisterna continua baixando — boia de proteção da bomba pode não ter desligado.`;

    case "filling":
      return tankType === "superior"
        ? `📈 ENCHENDO — Caixa d'Água\n${base}\nReservatório começou a encher.`
        : `📈 ENCHENDO — Cisterna\n${base}\nAbastecimento normalizado.`;

    case "level_restored":
      return `✅ NÍVEL RESTAURADO — Caixa d'Água\n${base}\nNível voltou ao normal.`;

    case "sci_reserve":
      return `🔴 EMERGÊNCIA SCI\n${base}\nReserva de incêndio sendo consumida. Acionar abastecimento IMEDIATAMENTE.`;
  }
}

// ── Criação automática de OS emergencial ─────────────────────────────────────

async function createEmergencyWorkOrder(cfg: SensorConfig, tankName: string, currentLevel: number): Promise<number | null> {
  try {
    const { createWorkOrder } = await import("./workOrdersDb");

    const tankLabel = cfg.tankType === "superior" ? "Caixa Superior" : "Cisterna (Inferior)";
    const title = `[AUTOMÁTICO] Nível crítico — ${tankName} (${tankLabel})`;

    const description = cfg.tankType === "superior"
      ? `OS criada automaticamente pelo sistema de monitoramento.\n\nNível atual: ${currentLevel}%\nCaixa: ${tankName} (Superior)\n\nOrientações iniciais:\n- Verificar nível da cisterna\n- Verificar painel elétrico e disjuntores\n- Testar eletroboias`
      : `OS criada automaticamente pelo sistema de monitoramento.\n\nNível atual: ${currentLevel}%\nCaixa: ${tankName} (Cisterna Inferior)\n\nOrientações iniciais:\n- DESLIGAR BOMBA DE RECALQUE IMEDIATAMENTE\n- Verificar boia inferior — possível falha\n- Verificar entrada de água da rede pública`;

    const result = await createWorkOrder({
      adminId: cfg.adminId,
      clientId: cfg.clientId,
      technicianId: cfg.technicianId ?? null,
      type: "emergencial",
      status: "aberta",
      priority: "alta",
      title,
      description,
    } as any);

    console.log(`[ALERTA CAIXA] OS emergencial criada: ${result.osNumber} (id=${result.id})${cfg.technicianId ? ` — técnico id=${cfg.technicianId}` : ""}`);
    return result.id;
  } catch (err: any) {
    console.error("[ALERTA CAIXA] Erro ao criar OS emergencial:", err?.message);
    return null;
  }
}

// ── Envio com rastreamento de entrega ─────────────────────────────────────────

async function sendWithTracking(phone: string, message: string): Promise<{ delivered: boolean; error?: string }> {
  const { sendWhatsappToNumber } = await import("./whatsapp");
  try {
    await sendWhatsappToNumber(phone, message);
    return { delivered: true };
  } catch (err: any) {
    return { delivered: false, error: err?.message || "Erro desconhecido" };
  }
}

// ── Função principal ───────────────────────────────────────────────────────────

export async function checkAndSendAlerts(params: {
  sensorId: number;
  clientId: number;
  tankName: string;
  currentLevel: number;
  state: SensorAlertState;
  previousZone: SensorZone;
  isGoingDown: boolean;
  isGoingUp: boolean;
}): Promise<void> {
  const { sensorId, clientId, tankName, currentLevel, state, previousZone, isGoingDown, isGoingUp } = params;

  try {
    const db = await getDb();
    if (!db) return;

    const configResult = await db.execute(sql`
      SELECT
        s.id, s.adminId, s.clientId, s.tankType, s.deadVolumePct,
        s.alarm1Pct, s.alarm2Pct, s.alarm3BoiaPct, s.alarm3BoiaEnabled,
        s.technicianId, s.dropStepPct, s.alertPhone,
        c.name AS clientName, c.phone AS clientPhone,
        t.name AS technicianName, t.phone AS technicianPhone
      FROM waterTankSensors s
      JOIN clients c ON c.id = s.clientId
      LEFT JOIN technicians t ON t.id = s.technicianId
      WHERE s.id = ${sensorId}
      LIMIT 1
    `);
    const configs = (configResult as unknown as [any[], any])[0] as any[];
    if (!configs.length) return;

    const cfg: SensorConfig = configs[0];
    const zone = determineZone(currentLevel, cfg);

    const fire = async (
      alertType: AlertType,
      triggerPct: number,
      direction: "down" | "up",
      observation: string | null,
      phones: string[],
      osId: number | null = null,
    ) => {
      const message = buildGenericMessage(alertType, cfg.tankType, cfg.clientName, tankName, currentLevel, triggerPct);

      // ── Tentativa de Web Push para o CLIENTE ─────────────────────────────────
      // Se o cliente tiver o portal PWA com notificações ativas, entregamos via push.
      // Se o push for bem-sucedido, removemos o telefone do cliente da lista WhatsApp
      // (admin e técnico ainda recebem WhatsApp normalmente).
      // O sistema de retry do waterTankAlertLog não é alterado.
      let clientPushDelivered = false;
      if (cfg.clientId) {
        try {
          const pushPayload: PushPayload = {
            title:              `⚠️ Alerta — ${tankName}`,
            body:               `Nível: ${currentLevel}% — ${message.split("\n")[0]}`,
            icon:               "/icon-192.png",
            badge:              "/badge-72.png",
            url:                "/client/water-tank",
            tag:                `alarm-${sensorId}`,
            requireInteraction: alertType === "alarm2" || alertType === "sci_reserve",
          };
          const pushResult = await sendPushToUser(cfg.clientId, "client", pushPayload);
          if (pushResult.delivered) {
            clientPushDelivered = true;
            console.log(`[PUSH] Alerta ${alertType} entregue via push para clientId=${cfg.clientId} — WhatsApp do cliente suprimido`);
          }
        } catch (pushErr: any) {
          // Push falhou — segue normalmente para WhatsApp
          console.warn("[PUSH] Erro ao tentar push de alarme:", pushErr?.message);
        }
      }

      // Remove o telefone do cliente da lista WhatsApp se push foi entregue
      // Técnico e alertPhone continuam recebendo WhatsApp
      let phonesToNotify = phones;
      if (clientPushDelivered && cfg.clientPhone) {
        phonesToNotify = phones.filter(p => p !== cfg.clientPhone);
      }

      let delivered = false;
      const errors: string[] = [];

      if (phonesToNotify.length === 0 && !clientPushDelivered) {
        errors.push("Nenhum telefone configurado para este sensor/cliente");
      }

      // Considera entregue se push chegou (mesmo sem WhatsApp)
      if (clientPushDelivered) delivered = true;

      for (const phone of phonesToNotify) {
        const result = await sendWithTracking(phone, message);
        if (result.delivered) {
          delivered = true;
        } else {
          errors.push(`${phone}: ${result.error || "falha"}`);
        }
      }

      // Fallback email se todos os WhatsApp falharam
      if (!delivered && errors.length > 0) {
        const subject = `[Soluteg] ${alertType.toUpperCase()} — ${tankName} (${currentLevel}%)`;
        const { sendAlertEmail } = await import("./emailService");
        const emailSent = await sendAlertEmail(subject, message);
        if (emailSent) {
          delivered = true;
          console.log(`[ALERTA CAIXA] Email de fallback enviado para ${alertType}`);
        }
      }

      const deliveryError = errors.length > 0 && !delivered ? errors.join("; ") : null;

      await db!.execute(sql`
        INSERT INTO waterTankAlertLog
          (sensorId, clientId, tankName, alertType, triggerPct, currentLevel, sentTo,
           direction, tankType, observation, delivered, deliveryError, osId)
        VALUES
          (${sensorId}, ${clientId}, ${tankName}, ${alertType}, ${triggerPct},
           ${currentLevel}, ${phonesToNotify.join(", ") || null}, ${direction}, ${cfg.tankType},
           ${observation}, ${delivered ? 1 : 0}, ${deliveryError}, ${osId})
      `);

      console.log(`[ALERTA CAIXA] ${alertType.toUpperCase()} — ${tankName} (${cfg.tankType}): ${currentLevel}% | delivered=${delivered}`);
    }

    // Destinatários padrão: cliente + telefone extra do sensor + técnico
    const getPhones = (): string[] => {
      const phones: string[] = [];
      if (cfg.clientPhone) phones.push(cfg.clientPhone);
      if (cfg.alertPhone && cfg.alertPhone !== cfg.clientPhone) phones.push(cfg.alertPhone);
      if (cfg.technicianPhone && !phones.includes(cfg.technicianPhone)) phones.push(cfg.technicianPhone);
      return phones;
    };

    // Destinatários admin/técnico (sem cliente) — para alertas operacionais
    const getAdminPhones = (): string[] => {
      const phones: string[] = [];
      if (cfg.alertPhone) phones.push(cfg.alertPhone);
      else if (cfg.clientPhone) phones.push(cfg.clientPhone);
      if (cfg.technicianPhone && !phones.includes(cfg.technicianPhone)) phones.push(cfg.technicianPhone);
      return phones;
    };

    // ── DESCENDO ─────────────────────────────────────────────────────────────

    if (isGoingDown) {

      // Alarm2 e SCI disparam com CONFIRM_CRITICAL (1 flush) — nível crítico exige resposta imediata.
      // Não aguardar os 5 flushes do CONFIRM normal, pois a caixa pode esvaziar em segundos.
      if (state.consecutiveDownCount >= CONFIRM_CRITICAL) {

        // SCI — reserva de incêndio (OS já criada no alarm2 — só notifica)
        if (zone === "sci" && previousZone !== "sci") {
          await fire("sci_reserve", cfg.deadVolumePct, "down", "Consumo da reserva SCI", getPhones());
          state.currentZone = "sci";
        }

        // Alarm2 — cria OS emergencial + notifica todos (admin, cliente, técnico via getPhones)
        if (zone === "alarm2" && previousZone !== "alarm2" && previousZone !== "sci") {
          const osId = await createEmergencyWorkOrder(cfg, tankName, currentLevel);
          await fire("alarm2", cfg.alarm2Pct, "down", `Nível crítico — ${cfg.tankType}`, getPhones(), osId);
          if (!cfg.technicianPhone) {
            console.warn(`[ALERTA CAIXA] alarm2 disparado mas sensor_id=${sensorId} não tem técnico configurado`);
          }
          state.lastDropAlertLevel = currentLevel;
          state.currentZone = "alarm2";
          state.normalizedNotified = false;
        }
      }

      // Alarm1, drop_step e boia_fault usam CONFIRM completo (5 flushes = 2,5 min) —
      // nível de atenção tolera espera para filtrar ruído do sensor.
      if (state.consecutiveDownCount >= CONFIRM) {

        // Alerta progressivo dentro de alarm1
        if (zone === "alarm1" && state.lastDropAlertLevel !== null) {
          if ((state.lastDropAlertLevel - currentLevel) >= cfg.dropStepPct) {
            await fire("drop_step", currentLevel, "down", `Nível caindo — ${cfg.tankType}`, getPhones());
            state.lastDropAlertLevel = currentLevel;
          }
        }

        // Alarm1 — notifica admin + cliente + técnico (inclui vinda de boia_high)
        if (zone === "alarm1" && (previousZone === "normal" || previousZone === "boia_high")) {
          await fire("alarm1", cfg.alarm1Pct, "down", `Nível de atenção — ${cfg.tankType}`, getPhones());
          state.lastDropAlertLevel = currentLevel;
          state.currentZone = "alarm1";
          state.normalizedNotified = false;
        }

        // Boia fault — cisterna continua baixando sem recuperação
        if (
          cfg.tankType === "inferior" &&
          zone === "alarm2" &&
          previousZone === "alarm2" &&
          state.consecutiveDownCount >= CONFIRM * 2
        ) {
          await fire("boia_fault", cfg.alarm2Pct, "down", "Boia inferior com falha", getPhones());
        }
      }
    }

    // ── SUBINDO ──────────────────────────────────────────────────────────────

    if (isGoingUp && state.consecutiveUpCount >= CONFIRM) {

      // Alarm3 boia — nível alto (pane na boia de corte) — só se habilitado
      if (zone === "boia_high" && previousZone !== "boia_high" && cfg.alarm3BoiaEnabled) {
        await fire("alarm3_boia", cfg.alarm3BoiaPct, "up", `Nível alto — ${cfg.tankType}`, getAdminPhones());
        state.currentZone = "boia_high";
      }

      // Filling — estava em alarme há pelo menos 2,5 min e começou a encher
      // 2,5 min = CONFIRM (5) × 30s de buffer — confirma que não é leitura espúria
      if (previousZone !== "normal" && previousZone !== "boia_high" && !state.fillingNotified) {
        await fire("filling", cfg.alarm1Pct, "up", "Reservatório enchendo", getAdminPhones());
        state.fillingNotified = true;
      }

      // Nível restaurado — exige o mesmo CONFIRM que a entrada em alarme:
      // 5 leituras consecutivas subindo acima de 85% antes de confirmar recuperação.
      // Sem esse guard, um spike de ruído único a 100% já disparava o aviso.
      const wasLowAlarm = state.currentZone === "alarm1" || state.currentZone === "alarm2" || state.currentZone === "sci";
      if (currentLevel >= 85 && wasLowAlarm && !state.normalizedNotified) {
        await fire("level_restored", 85, "up", "Nível normalizado — 85%", getPhones());
        state.normalizedNotified = true;
        state.currentZone = "normal";
        state.lastDropAlertLevel = null;
        state.fillingNotified = false;
        state.consecutiveDownCount = 0;
      }
    }
  } catch (err: any) {
    console.error("[ALERTA CAIXA] Erro ao verificar alertas:", err?.message);
  }
}

// ── Reprocessamento de alertas não entregues ──────────────────────────────────

/**
 * Chamada ao reconectar o WhatsApp. Busca alertas das últimas 24h com
 * delivered=0 e tenta reenviá-los.
 */
export async function retryUndeliveredAlerts(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    const rows = (await db.execute(sql`
      SELECT
        al.id, al.sentTo, al.alertType, al.tankName, al.currentLevel,
        al.triggerPct, al.tankType, al.observation,
        c.name AS clientName
      FROM waterTankAlertLog al
      JOIN waterTankSensors s ON s.id = al.sensorId
      JOIN clients c ON c.id = al.clientId
      WHERE al.delivered = 0
        AND al.sentAt > NOW() - INTERVAL 24 HOUR
      ORDER BY al.sentAt ASC
    `) as unknown as [any[], any])[0] as any[];

    if (!rows.length) return;

    console.log(`[ALERTA CAIXA] Reprocessando ${rows.length} alerta(s) não entregue(s)...`);

    const { sendWhatsappToNumber } = await import("./whatsapp");

    for (const row of rows) {
      const phones = row.sentTo ? row.sentTo.split(", ").map((p: string) => p.trim()) : [];
      if (!phones.length) continue;

      const message = buildGenericMessage(
        row.alertType as AlertType,
        row.tankType as "superior" | "inferior",
        row.clientName,
        row.tankName,
        row.currentLevel,
        row.triggerPct,
      );

      let delivered = false;
      for (const phone of phones) {
        try {
          await sendWhatsappToNumber(phone, message);
          delivered = true;
        } catch (_) {}
      }

      if (delivered) {
        await db.execute(sql`
          UPDATE waterTankAlertLog SET delivered = 1, deliveryError = NULL WHERE id = ${row.id}
        `);
        console.log(`[ALERTA CAIXA] Alerta ${row.id} (${row.alertType}) reenviado com sucesso`);
      }
    }
  } catch (err: any) {
    console.error("[ALERTA CAIXA] Erro ao reprocessar alertas:", err?.message);
  }
}
