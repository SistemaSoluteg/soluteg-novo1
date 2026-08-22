#!/usr/bin/env tsx
/**
 * Fase 2 do plano 3.7.1f — Travamento (produção): NOT NULL + FK tenantId -> tenants(id).
 * VARIANTE DE PRODUÇÃO — uso exclusivo no cutover (ver docs/RUNBOOK_CUTOVER_PRODUCAO.md, Fase 10).
 *
 * Esta é a lista de produção, revisada — difere da lista original de staging
 * (scripts/lock-tenant-not-null-fk.ts) por causa do achado LOCK-02: travar
 * `waterTankSensors` com NOT NULL quebrou 100% da ingestão MQTT em staging
 * (`upsertSensorDevice()` em server/waterTankSensorDb.ts insere sem carimbar
 * tenantId — auto-descoberta de sensor, global por design). Ver docs/PENDENCIAS_TECNICAS.md.
 *
 * Para cada tabela da lista (gerada pela Fase 0 revisada com o Thiago em 19/08/2026):
 *   1. ALTER TABLE <tab> MODIFY COLUMN tenantId INT NOT NULL;
 *   2. ALTER TABLE <tab> ADD CONSTRAINT fk_<tab>_tenant FOREIGN KEY (tenantId) REFERENCES tenants(id);
 * Cada ALTER é um statement isolado (não pipe multi-statement — regra do CLAUDE.md §5.5).
 * Depois de cada tabela, valida via information_schema (IS_NULLABLE + FK presente).
 * Para no primeiro erro (não continua tentando as demais) para manter o estrago localizado.
 *
 * Uso: pnpm tsx scripts/lock-tenant-not-null-fk-producao.ts
 */

import { config } from "dotenv";
config();

import { assertProductionEnvironment } from "../server/lib/environment";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

// Conjunto definitivo (Fase 0 revisada em 19/08/2026): todas as tabelas com tenantId
// que já estão com 0 NULLs e ainda sem FK. Exclui: condominiums/gestors (já travadas
// na 3.7.1b) e notificationLogs (NOTIF-01, fica nullable até a 3.7.9).
const TABELAS = [
  "admins",
  "auditLog",
  "budgetAttachments",
  "budgetHistory",
  "budgetItems",
  "budgets",
  // PDV (cashTransactions/categories/customers/products/saleItems/sales) REMOVIDO
  // da lista de produção — achado LOCK-03 (22/08/2026, durante a Fase 10 do cutover):
  // essas tabelas no MySQL são um ESPELHO do PDV (que roda em TiDB Cloud). O único
  // caminho de escrita delas no MySQL é pdvRouter.migrate.fromTidb (server/routers/
  // pdv.router.ts:421), que faz mysql.insert(table).values(chunk) SEM carimbar
  // tenantId. Travar NOT NULL quebraria o próximo sync do TiDB (mesma classe do
  // LOCK-02/waterTankSensors). PDV é tenant-1-only e gated (pdvProcedure), então
  // tenantId nullable aqui é baixo risco. Pra travar depois: carimbar tenantId=1
  // no fromTidb primeiro. Ver docs/PENDENCIAS_TECNICAS.md.
  "checklistInstances",
  "clientDocuments",
  "clients",
  "configuracoesTecnico",
  "inspectionReports",
  "inspectionTasks",
  "invites",
  "laudoCitacoes",
  "laudoFotos",
  "laudoMedicoes",
  "laudoTecnicos",
  "laudos",
  "notificationContacts",
  "pushSubscriptions",
  "reports",
  "technicians",
  "waterTankAlertLog",
  "waterTankFaultLog",
  "waterTankMonitoring",
  // "waterTankSensors" REMOVIDA da lista de produção — achado LOCK-02 (20/08/2026):
  // travar esta tabela com NOT NULL quebrou 100% da ingestão MQTT em staging, porque
  // upsertSensorDevice() (server/waterTankSensorDb.ts) faz INSERT...ON DUPLICATE KEY
  // UPDATE sem carimbar tenantId (auto-descoberta de sensor, global por design).
  // Revertida manualmente em staging; fica fora do NOT NULL também em produção.
  // Ver docs/PENDENCIAS_TECNICAS.md.
  "workOrderAttachments",
  "workOrderComments",
  "workOrderHistory",
  "workOrderMaterials",
  "workOrderTasks",
  "workOrderTimeTracking",
  "workOrders",
];

async function main() {
  assertProductionEnvironment();
  const db = await getDb();
  if (!db) throw new Error("ABORT: getDb() retornou null");

  const [[dbNameRow]] = await db.execute(sql`SELECT DATABASE() as db`);
  console.log("Banco:", dbNameRow);
  console.log(`Tabelas a travar: ${TABELAS.length}\n`);

  const sucesso: string[] = [];
  const falha: Array<{ tabela: string; etapa: string; erro: string }> = [];

  for (const t of TABELAS) {
    console.log(`--- ${t} ---`);
    try {
      // 0. Guarda: 0 nulls antes de qualquer coisa (defesa em profundidade)
      const [[nullCheck]] = await db.execute(
        sql.raw(`SELECT SUM(tenantId IS NULL) as nulos FROM \`${t}\``)
      );
      const nulos = Number((nullCheck as any).nulos ?? 0);
      if (nulos > 0) {
        throw new Error(`ABORT: ${t} ainda tem ${nulos} NULL(s) — não deveria chegar aqui`);
      }

      // 1. NOT NULL
      await db.execute(sql.raw(`ALTER TABLE \`${t}\` MODIFY COLUMN tenantId INT NOT NULL`));
      console.log(`  [1/2] NOT NULL aplicado`);

      // 2. FK
      const fkName = `fk_${t}_tenant`;
      await db.execute(
        sql.raw(
          `ALTER TABLE \`${t}\` ADD CONSTRAINT \`${fkName}\` FOREIGN KEY (tenantId) REFERENCES tenants(id)`
        )
      );
      console.log(`  [2/2] FK aplicada (${fkName})`);

      // 3. Validação
      const [[colCheck]] = await db.execute(
        sql.raw(
          `SELECT IS_NULLABLE FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${t}' AND COLUMN_NAME = 'tenantId'`
        )
      );
      const [[fkCheck]] = await db.execute(
        sql.raw(
          `SELECT CONSTRAINT_NAME, REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${t}' AND COLUMN_NAME = 'tenantId'
             AND REFERENCED_TABLE_NAME = 'tenants'`
        )
      );

      const isNullable = (colCheck as any)?.IS_NULLABLE;
      const hasFk = !!fkCheck;

      if (isNullable !== "NO") throw new Error(`validação falhou: IS_NULLABLE=${isNullable}`);
      if (!hasFk) throw new Error(`validação falhou: FK não encontrada`);

      console.log(`  ✓ validado: NOT NULL + FK confirmados\n`);
      sucesso.push(t);
    } catch (e: any) {
      console.error(`  ✗ ERRO em ${t}: ${e.message}\n`);
      falha.push({ tabela: t, etapa: "?", erro: e.message });
      break; // para no primeiro erro
    }
  }

  console.log("\n=== RESUMO ===");
  console.log(`Sucesso: ${sucesso.length}/${TABELAS.length}`);
  console.table(sucesso);
  if (falha.length) {
    console.log(`Falha: ${falha.length}`);
    console.table(falha);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("ERRO FATAL:", e);
  process.exit(1);
});
