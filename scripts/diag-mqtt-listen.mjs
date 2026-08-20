#!/usr/bin/env node
/**
 * Diagnóstico read-only do broker MQTT — escuta sem alterar nada.
 *
 * Só subscreve (nunca publica) no mesmo tópico que server/mqttService.ts usa em
 * produção. Rodar isso NÃO interfere com o app já rodando: MQTT permite múltiplos
 * subscribers no mesmo tópico, cada um recebe sua própria cópia da mensagem.
 *
 * Uso (no VPS, dentro do diretório da app — reaproveita o .env real):
 *   node scripts/diag-mqtt-listen.mjs [tópico] [segundos]
 *
 * Exemplos:
 *   node scripts/diag-mqtt-listen.mjs                              # tópico padrão, 60s
 *   node scripts/diag-mqtt-listen.mjs "soluteg/sensor/+/level" 120 # 120s
 *   node scripts/diag-mqtt-listen.mjs "soluteg/#" 60               # qualquer coisa no namespace
 */

import { config } from "dotenv";
import mqtt from "mqtt";

config();

const topic = process.argv[2] || "soluteg/sensor/+/level";
const listenMs = Number(process.argv[3] || 60) * 1000;

const brokerUrl = process.env.MQTT_BROKER_URL;
const username = process.env.MQTT_USERNAME || undefined;
const password = process.env.MQTT_PASSWORD || undefined;

if (!brokerUrl) {
  console.error("MQTT_BROKER_URL não definido no .env — abortando.");
  process.exit(1);
}

console.log("Conectando em:", brokerUrl, "| user:", username || "(sem usuário)");
console.log("Tópico:", topic, "| duração:", listenMs / 1000, "s\n");

const client = mqtt.connect(brokerUrl, {
  username,
  password,
  reconnectPeriod: 5000,
  connectTimeout: 10000,
  clientId: "diag-readonly-" + Math.random().toString(16).slice(2, 10),
});

let msgCount = 0;

client.on("connect", () => {
  console.log("✓ Conectado ao broker");
  client.subscribe(topic, (err) => {
    if (err) console.error("✗ Erro ao subscrever:", err);
    else console.log(`✓ Subscrito em ${topic} — aguardando mensagens...\n`);
  });
});

client.on("message", (t, message) => {
  msgCount++;
  console.log(`[${new Date().toISOString()}] ${t} → ${message.toString()}`);
});

client.on("error", (err) => console.error("✗ Erro MQTT:", err.message));
client.on("reconnect", () => console.log("… reconectando"));
client.on("offline", () => console.log("… offline"));

setTimeout(() => {
  console.log(`\n--- Fim (${listenMs / 1000}s). Mensagens recebidas: ${msgCount} ---`);
  client.end(true, () => process.exit(0));
  setTimeout(() => process.exit(0), 2000);
}, listenMs);
