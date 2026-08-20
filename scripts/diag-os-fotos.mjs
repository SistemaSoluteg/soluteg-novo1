#!/usr/bin/env node
/**
 * Diagnóstico read-only: investiga fotos "sumidas" de uma OS.
 * Não altera nada — só SELECT.
 *
 * Uso (no VPS, dentro do diretório da app — reaproveita o .env real):
 *   node scripts/diag-os-fotos.mjs <osNumber>
 *
 * Exemplo:
 *   node scripts/diag-os-fotos.mjs 390189
 */

import { config } from "dotenv";
config();

import { createPool } from "mysql2/promise";

const osNumber = process.argv[2];
if (!osNumber) {
  console.error("Uso: node scripts/diag-os-fotos.mjs <osNumber>");
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL não definido — abortando.");
  process.exit(1);
}

const pool = createPool({ uri: url, timezone: "Z" });

async function main() {
  const [[dbRow]] = await pool.query("SELECT DATABASE() as db");
  console.log("Banco:", dbRow);

  console.log("\n=== OS (busca por osNumber, com e sem '#') ===");
  const [osRows] = await pool.query(
    `SELECT id, osNumber, status, clientId, technicianId, startedAt, pausedAt, completedAt, createdAt, updatedAt,
            isRecurring, recurrenceType, parentOsId
     FROM workOrders WHERE osNumber = ? OR osNumber = ?`,
    [osNumber, `#${osNumber}`]
  );
  console.table(osRows);

  if (!osRows.length) {
    console.log("Nenhuma OS encontrada com esse número. Confira o valor exato (com/sem #, zeros à esquerda etc).");
    process.exit(0);
  }

  for (const os of osRows) {
    console.log(`\n=== Anexos da OS id=${os.id} (osNumber=${os.osNumber}) ===`);
    const [attachments] = await pool.query(
      `SELECT id, workOrderId, fileName, category, fileUrl, uploadedAt, uploadedBy, description
       FROM workOrderAttachments WHERE workOrderId = ? ORDER BY uploadedAt`,
      [os.id]
    );
    console.table(attachments);

    console.log(`\n=== Histórico de status da OS id=${os.id} ===`);
    const [history] = await pool.query(
      `SELECT id, changedBy, changedByType, previousStatus, newStatus, notes, createdAt
       FROM workOrderHistory WHERE workOrderId = ? ORDER BY createdAt`,
      [os.id]
    );
    console.table(history);
  }

  // Também busca por número de OS parecido, em caso de recorrência mensal gerando OS nova
  if (osRows.length === 1 && osRows[0].clientId) {
    console.log("\n=== Outras OS do mesmo cliente (verificar se há OS duplicada/recorrente) ===");
    const [siblings] = await pool.query(
      `SELECT id, osNumber, status, createdAt FROM workOrders WHERE clientId = ? ORDER BY createdAt DESC LIMIT 10`,
      [osRows[0].clientId]
    );
    console.table(siblings);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
