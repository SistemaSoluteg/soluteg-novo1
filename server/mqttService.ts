/**
 * mqttService.ts
 *
 * Responsabilidades:
 *  1. Conectar ao broker MQTT e subscrever em soluteg/sensor/+/level
 *  2. Auto-registrar sensores novos como "pendentes" (sem cliente atribuído)
 *  3. Processar leituras de sensores já atribuídos: salvar no DB + SSE + alertas
 *
 * Variáveis de ambiente necessárias:
 *  MQTT_BROKER_URL  — ex: mqtt://broker.hivemq.com ou mqtts://xyz.s1.eu.hivemq.cloud:8883
 *  MQTT_USERNAME    — (opcional) usuário do broker
 *  MQTT_PASSWORD    — (opcional) senha do broker
 *
 * Tópico esperado: soluteg/sensor/{deviceId}/level
 * Payload JSON:    { "level_pct": 73 }
 *
 * No ESP32, configure apenas:
 *   const char* DEVICE_ID = "sensor_01";  // ou use WiFi.macAddress()
 *   topic = "soluteg/sensor/" + DEVICE_ID + "/level"
 */

import type { Response } from "express";

// Map de conexões SSE abertas: clientId → conjunto de Response objects
const sseClients = new Map<number, Set<Response>>();

// ── Cache de configuração dos sensores ───────────────────────────────────────
// Evita 2 DB queries a cada mensagem MQTT (a cada 5 s por sensor).
// TTL de 5 min: mudanças de calibração/atribuição propagam em até 5 min.
const SENSOR_CACHE_TTL = 5 * 60_000;
const UPSERT_THROTTLE  = 5 * 60_000; // lastSeenAt atualizado no máx 1x a cada 5 min

type CachedSensor = {
  data: Awaited<ReturnType<typeof import("./waterTankSensorDb").getAssignedSensorByDeviceId>>;
  cachedAt: number;
};

const sensorConfigCache = new Map<string, CachedSensor>();
const lastUpsertTime    = new Map<string, number>();

async function getCachedSensor(deviceId: string) {
  const now = Date.now();

  // Throttle upsert: só atualiza lastSeenAt no banco a cada UPSERT_THROTTLE ms
  const lastUpsert = lastUpsertTime.get(deviceId) ?? 0;
  if (now - lastUpsert >= UPSERT_THROTTLE) {
    const { upsertSensorDevice } = await import("./waterTankSensorDb");
    await upsertSensorDevice(deviceId);
    lastUpsertTime.set(deviceId, now);
  }

  // Retorna do cache se ainda válido
  const cached = sensorConfigCache.get(deviceId);
  if (cached && now - cached.cachedAt < SENSOR_CACHE_TTL) {
    return cached.data;
  }

  // Cache miss ou expirado — busca no banco e armazena
  const { getAssignedSensorByDeviceId } = await import("./waterTankSensorDb");
  const sensor = await getAssignedSensorByDeviceId(deviceId);
  sensorConfigCache.set(deviceId, { data: sensor, cachedAt: now });
  return sensor;
}

/** Invalida o cache de um sensor imediatamente (ex: após assignSensor/updateSensor) */
export function invalidateSensorCache(deviceId: string) {
  sensorConfigCache.delete(deviceId);
}

// ── Estado de alerta por sensor ───────────────────────────────────────────────
export type SensorZone = "normal" | "alarm1" | "alarm2" | "sci" | "boia_high";

export type SensorAlertState = {
  consecutiveDownCount: number;      // flushes consecutivos confirmando descida
  consecutiveUpCount: number;        // flushes consecutivos confirmando subida
  currentZone: SensorZone;           // zona atual confirmada
  lastDropAlertLevel: number | null; // nível no último alerta progressivo disparado
  fillingNotified: boolean;          // já notificou "enchendo" neste ciclo
  normalizedNotified: boolean;       // já notificou "normalizado (85%)" neste ciclo
  boiaFaultNotified: boolean;        // já notificou "falha de boia" neste ciclo — evita spam
  lastKnownLevel: number | null;
};

const sensorAlertState = new Map<string, SensorAlertState>();

function getOrCreateAlertState(deviceId: string): SensorAlertState {
  if (!sensorAlertState.has(deviceId)) {
    sensorAlertState.set(deviceId, {
      consecutiveDownCount: 0,
      consecutiveUpCount: 0,
      currentZone: "normal",
      lastDropAlertLevel: null,
      fillingNotified: false,
      normalizedNotified: false,
      boiaFaultNotified: false,
      lastKnownLevel: null,
    });
  }
  return sensorAlertState.get(deviceId)!;
}

export function invalidateSensorAlertState(deviceId: string) {
  sensorAlertState.delete(deviceId);
}

// ── Buffer de leituras (30 s) ─────────────────────────────────────────────────
// Sensores JSN-SR04T: guarda a MAIOR distância do intervalo (= menor nível = leitura
// mais conservadora). Sensores legacy (level_pct): guarda o maior nível.
const BUFFER_MS = 30_000;

type BufferEntry = {
  // Para sensores distance_cm: acumula maior distância (distância maior = nível menor)
  maxDistanceCm: number | null;
  distVazia: number | null;
  distCheia: number | null;
  // Para sensores level_pct legacy
  maxLevel: number;
  timer: ReturnType<typeof setTimeout>;
  sensor: {
    id: number;
    tenantId: number | null;
    clientId: number;
    adminId: number;
    tankName: string;
    deadVolumePct: number;
    alarm1Pct: number;
    alarm2Pct: number;
  };
};

const readingBuffer = new Map<string, BufferEntry>();

async function flushBuffer(deviceId: string) {
  const entry = readingBuffer.get(deviceId);
  if (!entry) return;
  readingBuffer.delete(deviceId);

  // Converte distância → nível se for sensor de distância
  let currentLevel: number;
  if (entry.maxDistanceCm !== null && entry.distVazia !== null && entry.distCheia !== null) {
    const raw = (entry.distVazia - entry.maxDistanceCm) / (entry.distVazia - entry.distCheia) * 100;
    currentLevel = Math.max(0, Math.min(100, Math.round(raw)));
    console.log(`[MQTT] flush ${deviceId} → ${entry.sensor.tankName}: dist_max=${entry.maxDistanceCm}cm → ${currentLevel}% (30 s)`);
  } else {
    currentLevel = entry.maxLevel;
    console.log(`[MQTT] flush ${deviceId} → ${entry.sensor.tankName}: ${currentLevel}% (max level_pct de 30 s)`);
  }

  const { saveWaterTankReading } = await import("./waterTankDb");
  // Best-effort: grava mesmo se entry.sensor.tenantId vier null (sem fail-closed —
  // ver comentário em saveWaterTankReading).
  await saveWaterTankReading({
    clientId: entry.sensor.clientId,
    adminId: entry.sensor.adminId,
    tenantId: entry.sensor.tenantId,
    tankName: entry.sensor.tankName,
    currentLevel,
  });

  const state = getOrCreateAlertState(deviceId);
  const previousZone = state.currentZone;

  // Primeira leitura: assume nível anterior como 101% para que qualquer nível
  // abaixo do normal seja detectado como "descida" já no primeiro flush.
  const prevLevel = state.lastKnownLevel ?? 101;
  const strictlyDown = currentLevel < prevLevel;
  const strictlyUp   = currentLevel > prevLevel;

  // Nível estável em zona de alarme: se o nível não subiu e já estava acumulando
  // contagem de descida, continua contando — resolve o caso em que o nível trava
  // em 0% e não consegue mais diminuir (ex: caixa vazia).
  const stableInAlarm = !strictlyDown && !strictlyUp
    && state.consecutiveDownCount > 0
    && currentLevel <= entry.sensor.alarm1Pct;

  const isGoingDown = strictlyDown || stableInAlarm;
  const isGoingUp   = strictlyUp;

  // Broadcast SSE após calcular tendência (isGoingDown/Up já declarados)
  broadcastTankUpdate(entry.sensor.clientId, {
    type: "level_update",
    tankName: entry.sensor.tankName,
    currentLevel,
    trend: isGoingDown ? "down" : isGoingUp ? "up" : "stable",
    measuredAt: new Date().toISOString(),
  });

  if (isGoingDown) {
    state.consecutiveDownCount++;
    state.consecutiveUpCount = 0;
  } else if (isGoingUp) {
    state.consecutiveUpCount++;
    state.consecutiveDownCount = 0;
  }

  state.lastKnownLevel = currentLevel;

  const { checkAndSendAlerts } = await import("./waterTankAlertService");
  checkAndSendAlerts({
    sensorId: entry.sensor.id,
    clientId: entry.sensor.clientId,
    tankName: entry.sensor.tankName,
    currentLevel,
    state,
    previousZone,
    isGoingDown,
    isGoingUp,
  }).catch((e: Error) => console.error("[MQTT] Erro ao verificar alertas:", e.message));
}

export function addSseClient(clientId: number, res: Response): void {
  if (!sseClients.has(clientId)) sseClients.set(clientId, new Set());
  sseClients.get(clientId)!.add(res);
}

export function removeSseClient(clientId: number, res: Response): void {
  sseClients.get(clientId)?.delete(res);
  if (sseClients.get(clientId)?.size === 0) sseClients.delete(clientId);
}

export function broadcastTankUpdate(clientId: number, data: object): void {
  const clients = sseClients.get(clientId);
  if (!clients?.size) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      // Conexão fechada — será limpa no evento "close" do request
    }
  }
}

export function initMqtt(): void {
  // Staging: permite desabilitar MQTT via .env para evitar conflito com produção
  if (process.env.MQTT_DISABLED === "true") {
    console.log("[MQTT] MQTT_DISABLED=true — serviço MQTT desabilitado (staging)");
    return;
  }
  
  const brokerUrl = process.env.MQTT_BROKER_URL;

  if (!brokerUrl) {
    console.log("[MQTT] MQTT_BROKER_URL não configurado — serviço MQTT desabilitado");
    return;
  }

  import("mqtt")
    .then((mqttLib) => {
      const options = {
        username: process.env.MQTT_USERNAME || undefined,
        password: process.env.MQTT_PASSWORD || undefined,
        reconnectPeriod: 5_000,
        connectTimeout: 10_000,
      };

      const client = mqttLib.connect(brokerUrl, options);

      client.on("connect", () => {
        console.log("[MQTT] Conectado:", brokerUrl);
        client.subscribe("soluteg/sensor/+/level", (err) => {
          if (err) console.error("[MQTT] Erro ao subscrever:", err);
          else console.log("[MQTT] Subscrito em soluteg/sensor/+/level");
        });
      });

      client.on("message", async (topic: string, message: Buffer) => {
        try {
          // Formato: soluteg/sensor/{deviceId}/level
          const parts = topic.split("/");
          if (parts.length !== 4 || parts[0] !== "soluteg" || parts[1] !== "sensor" || parts[3] !== "level") return;

          const deviceId = parts[2];
          if (!deviceId) return;

          const payload = JSON.parse(message.toString());

          // Cache: evita 2 DB queries a cada 5s — reutiliza config por até 5 min
          const sensor = await getCachedSensor(deviceId);
          if (!sensor) {
            console.log(`[MQTT] Sensor ${deviceId} aguardando atribuição — leitura ignorada`);
            return;
          }

          // Support both payload formats:
          //   { "distance_cm": 67 }  → guarda distância bruta; flush converte usando calibração
          //   { "level_pct": 73 }    → usado diretamente (legacy / pré-calibrado)
          const existing = readingBuffer.get(deviceId);

          if (payload.distance_cm != null && sensor.distVazia != null && sensor.distCheia != null) {
            const dist = Number(payload.distance_cm);
            if (isNaN(dist)) return;
            if (existing) {
              // Maior distância = menor nível = leitura mais conservadora
              if (dist > existing.maxDistanceCm!) existing.maxDistanceCm = dist;
              console.log(`[MQTT] ${deviceId} dist=${dist}cm buffered (max=${existing.maxDistanceCm}cm)`);
            } else {
              const timer = setTimeout(() => flushBuffer(deviceId), BUFFER_MS);
              readingBuffer.set(deviceId, {
                maxDistanceCm: dist, distVazia: sensor.distVazia, distCheia: sensor.distCheia,
                maxLevel: 0, timer, sensor,
              });
              console.log(`[MQTT] ${deviceId} buffer iniciado dist=${dist}cm — flush em ${BUFFER_MS / 1000}s`);
            }
          } else if (payload.level_pct != null) {
            const lvl = Math.max(0, Math.min(100, Math.round(Number(payload.level_pct))));
            if (isNaN(lvl)) return;
            if (existing) {
              if (lvl > existing.maxLevel) existing.maxLevel = lvl;
              console.log(`[MQTT] ${deviceId} level=${lvl}% buffered (max=${existing.maxLevel}%)`);
            } else {
              const timer = setTimeout(() => flushBuffer(deviceId), BUFFER_MS);
              readingBuffer.set(deviceId, {
                maxDistanceCm: null, distVazia: null, distCheia: null,
                maxLevel: lvl, timer, sensor,
              });
              console.log(`[MQTT] ${deviceId} buffer iniciado level=${lvl}% — flush em ${BUFFER_MS / 1000}s`);
            }
          } else if (payload.distance_cm != null) {
            console.warn(`[MQTT] Sensor ${deviceId} enviou distance_cm mas calibração não configurada — configure dist. vazia/cheia no portal`);
          } else {
            console.warn(`[MQTT] Payload inválido do sensor ${deviceId}:`, payload);
          }
        } catch (err) {
          console.error("[MQTT] Erro ao processar mensagem:", err);
        }
      });

      client.on("error", (err: Error) => console.error("[MQTT] Erro:", err.message));
      client.on("reconnect", () => console.log("[MQTT] Reconectando..."));
      client.on("offline", () => console.log("[MQTT] Offline"));
    })
    .catch((err) => {
      console.error("[MQTT] Falha ao carregar biblioteca mqtt:", err);
    });
}
