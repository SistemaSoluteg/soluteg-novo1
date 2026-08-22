#!/usr/bin/env tsx
/**
 * Backfill final de tenantId IS NULL — Sub-fase 3.7.2 (fechamento) → alimenta a 3.7.1f
 * VARIANTE DE PRODUÇÃO — uso exclusivo no cutover (ver docs/RUNBOOK_CUTOVER_PRODUCAO.md, Fase 9).
 *
 * Uso:
 *   pnpm tsx scripts/backfill-tenant-null-producao.ts           (DRY-RUN: só reporta contagens)
 *   pnpm tsx scripts/backfill-tenant-null-producao.ts --apply    (aplica backfills determinísticos)
 *
 * O que faz:
 *   1. Varre TODAS as tabelas do banco que possuem coluna `tenantId`
 *      (via information_schema) e conta quantas linhas têm tenantId IS NULL.
 *   2. Em --apply, executa apenas os backfills DETERMINÍSTICOS (derivados de
 *      uma entidade pai inequívoca). Tabelas cuja origem do tenant é ambígua
 *      são apenas reportadas para decisão manual.
 *
 * Cobertura (todas as levas da 3.7.2, cada uma com FK-pai inequívoca):
 *   - laudos + sub-tabelas (via clienteId/osId)
 *   - pushSubscriptions (via clientId/technicianId + userType)
 *   - clientDocuments (via clientId)
 *   - sub-tabelas de OS: workOrderTasks/Materials/Attachments/Comments/TimeTracking (via workOrderId)
 *   - checklists: inspectionTasks (via workOrderId), checklistInstances (via inspectionTaskId)
 *   - caixa d'água: waterTankSensors atribuídos, waterTankMonitoring/AlertLog/FaultLog (via clientId)
 *   - sub-tabelas de orçamento: budgetItems/History/Attachments (via budgetId)
 *
 * Segurança:
 *   - assertProductionEnvironment() aborta se não estiver no banco de produção.
 *   - PDV (categories/sales/saleItems/cashTransactions/customers/products) fica
 *     FORA por design — módulo é tenant-1-only, sem coluna tenantId multi-tenant.
 *   - waterTankSensors PENDENTES (clientId IS NULL — sensor MQTT ainda não atribuído
 *     a nenhum cliente) ficam com tenantId NULL de propósito: não há tenant pra derivar
 *     ainda, e o JOIN abaixo naturalmente não casa essas linhas (não precisa de WHERE extra).
 *
 * Pré-requisito: rodar DEPOIS do deploy do código (Fase 8 do runbook), cobrindo a janela
 * entre a migração de dados (Fase 7) e o deploy. Este é o script único que deve zerar
 * (no que for derivável) o `tenantId IS NULL` residual em produção antes de travar
 * NOT NULL na Fase 10.
 */

import { config } from "dotenv";
config();

import { assertProductionEnvironment } from "../server/lib/environment";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

const isApply = process.argv.includes("--apply");
const MODE = isApply ? "APPLY" : "DRY-RUN";

// Backfills determinísticos: tenantId derivado de uma FK pai inequívoca.
// Cada entrada é (tabela filha) ← join na (tabela pai) que já tem tenantId.
//
// ORDEM IMPORTA — pais ANTES de filhos. Os backfills-filho (laudoFotos/Medicoes/
// Tecnicos/Citacoes) têm `WHERE l.tenantId IS NOT NULL`, ou seja, dependem de
// `laudos.tenantId` já preenchido. Se `laudos` fosse backfillado depois, um laudo
// legado (tenantId=NULL) teria seus filhos ignorados neste passo e eles ficariam
// órfãos num único --apply. Por isso `laudos (via cliente/OS)` vêm primeiro.
//
// Mesma regra vale para `checklistInstances`, que depende de `inspectionTasks.tenantId`
// já preenchido — por isso `inspectionTasks (via OS)` vem ANTES de `checklistInstances
// (via inspectionTask)` na lista abaixo. As demais entradas novas (clientDocuments,
// sub-tabelas de OS, caixa d'água, sub-tabelas de orçamento) derivam direto de uma
// tabela-pai que já deveria estar preenchida desde a migração inicial (3.7.1e) ou
// pelas guardas fail-closed da 3.7.2, então a ordem entre elas não importa.
const BACKFILLS_DETERMINISTICOS: Array<{ tabela: string; sqlUpdate: string; regra: string }> = [
  {
    tabela: "laudos (via cliente)",
    regra: "laudos.tenantId ← clients.tenantId (via clienteId)",
    sqlUpdate: `UPDATE laudos l JOIN clients c ON l.clienteId = c.id
                SET l.tenantId = c.tenantId
                WHERE l.tenantId IS NULL AND c.tenantId IS NOT NULL`,
  },
  {
    tabela: "laudos (via OS)",
    regra: "laudos.tenantId ← workOrders.tenantId (via osId), p/ laudos sem cliente",
    sqlUpdate: `UPDATE laudos l JOIN workOrders w ON l.osId = w.id
                SET l.tenantId = w.tenantId
                WHERE l.tenantId IS NULL AND w.tenantId IS NOT NULL`,
  },
  {
    tabela: "laudoFotos",
    regra: "laudoFotos.tenantId ← laudos.tenantId (via laudoId)",
    sqlUpdate: `UPDATE laudoFotos f JOIN laudos l ON f.laudoId = l.id
                SET f.tenantId = l.tenantId
                WHERE f.tenantId IS NULL AND l.tenantId IS NOT NULL`,
  },
  {
    tabela: "laudoMedicoes",
    regra: "laudoMedicoes.tenantId ← laudos.tenantId (via laudoId)",
    sqlUpdate: `UPDATE laudoMedicoes m JOIN laudos l ON m.laudoId = l.id
                SET m.tenantId = l.tenantId
                WHERE m.tenantId IS NULL AND l.tenantId IS NOT NULL`,
  },
  {
    tabela: "laudoTecnicos",
    regra: "laudoTecnicos.tenantId ← laudos.tenantId (via laudoId)",
    sqlUpdate: `UPDATE laudoTecnicos t JOIN laudos l ON t.laudoId = l.id
                SET t.tenantId = l.tenantId
                WHERE t.tenantId IS NULL AND l.tenantId IS NOT NULL`,
  },
  {
    tabela: "laudoCitacoes",
    regra: "laudoCitacoes.tenantId ← laudos.tenantId (via laudoId)",
    sqlUpdate: `UPDATE laudoCitacoes c JOIN laudos l ON c.laudoId = l.id
                SET c.tenantId = l.tenantId
                WHERE c.tenantId IS NULL AND l.tenantId IS NOT NULL`,
  },
  {
    tabela: "pushSubscriptions (cliente)",
    regra: "pushSubscriptions.tenantId ← clients.tenantId (userType=client)",
    sqlUpdate: `UPDATE pushSubscriptions p JOIN clients c ON p.userId = c.id
                SET p.tenantId = c.tenantId
                WHERE p.tenantId IS NULL AND p.userType = 'client' AND c.tenantId IS NOT NULL`,
  },
  {
    tabela: "pushSubscriptions (técnico)",
    regra: "pushSubscriptions.tenantId ← technicians.tenantId (userType=technician)",
    sqlUpdate: `UPDATE pushSubscriptions p JOIN technicians t ON p.userId = t.id
                SET p.tenantId = t.tenantId
                WHERE p.tenantId IS NULL AND p.userType = 'technician' AND t.tenantId IS NOT NULL`,
  },
  {
    tabela: "clientDocuments",
    regra: "clientDocuments.tenantId ← clients.tenantId (via clientId)",
    sqlUpdate: `UPDATE clientDocuments d JOIN clients c ON d.clientId = c.id
                SET d.tenantId = c.tenantId
                WHERE d.tenantId IS NULL AND c.tenantId IS NOT NULL`,
  },
  {
    tabela: "workOrderTasks",
    regra: "workOrderTasks.tenantId ← workOrders.tenantId (via workOrderId)",
    sqlUpdate: `UPDATE workOrderTasks x JOIN workOrders wo ON x.workOrderId = wo.id
                SET x.tenantId = wo.tenantId
                WHERE x.tenantId IS NULL AND wo.tenantId IS NOT NULL`,
  },
  {
    tabela: "workOrderMaterials",
    regra: "workOrderMaterials.tenantId ← workOrders.tenantId (via workOrderId)",
    sqlUpdate: `UPDATE workOrderMaterials x JOIN workOrders wo ON x.workOrderId = wo.id
                SET x.tenantId = wo.tenantId
                WHERE x.tenantId IS NULL AND wo.tenantId IS NOT NULL`,
  },
  {
    tabela: "workOrderAttachments",
    regra: "workOrderAttachments.tenantId ← workOrders.tenantId (via workOrderId)",
    sqlUpdate: `UPDATE workOrderAttachments x JOIN workOrders wo ON x.workOrderId = wo.id
                SET x.tenantId = wo.tenantId
                WHERE x.tenantId IS NULL AND wo.tenantId IS NOT NULL`,
  },
  {
    tabela: "workOrderComments",
    regra: "workOrderComments.tenantId ← workOrders.tenantId (via workOrderId)",
    sqlUpdate: `UPDATE workOrderComments x JOIN workOrders wo ON x.workOrderId = wo.id
                SET x.tenantId = wo.tenantId
                WHERE x.tenantId IS NULL AND wo.tenantId IS NOT NULL`,
  },
  {
    tabela: "workOrderTimeTracking",
    regra: "workOrderTimeTracking.tenantId ← workOrders.tenantId (via workOrderId)",
    sqlUpdate: `UPDATE workOrderTimeTracking x JOIN workOrders wo ON x.workOrderId = wo.id
                SET x.tenantId = wo.tenantId
                WHERE x.tenantId IS NULL AND wo.tenantId IS NOT NULL`,
  },
  {
    tabela: "workOrderHistory",
    regra: "workOrderHistory.tenantId ← workOrders.tenantId (via workOrderId)",
    sqlUpdate: `UPDATE workOrderHistory x JOIN workOrders wo ON x.workOrderId = wo.id
                SET x.tenantId = wo.tenantId
                WHERE x.tenantId IS NULL AND wo.tenantId IS NOT NULL`,
  },
  {
    tabela: "inspectionTasks",
    regra: "inspectionTasks.tenantId ← workOrders.tenantId (via workOrderId)",
    sqlUpdate: `UPDATE inspectionTasks it JOIN workOrders wo ON it.workOrderId = wo.id
                SET it.tenantId = wo.tenantId
                WHERE it.tenantId IS NULL AND wo.tenantId IS NOT NULL`,
  },
  {
    // Depende de inspectionTasks.tenantId já preenchido — por isso vem DEPOIS da entrada acima.
    tabela: "checklistInstances",
    regra: "checklistInstances.tenantId ← inspectionTasks.tenantId (via inspectionTaskId)",
    sqlUpdate: `UPDATE checklistInstances ci JOIN inspectionTasks it ON ci.inspectionTaskId = it.id
                SET ci.tenantId = it.tenantId
                WHERE ci.tenantId IS NULL AND it.tenantId IS NOT NULL`,
  },
  {
    // Só sensores JÁ atribuídos (clientId preenchido). Pendentes ficam de fora por design.
    tabela: "waterTankSensors (atribuídos)",
    regra: "waterTankSensors.tenantId ← clients.tenantId (via clientId, quando atribuído)",
    sqlUpdate: `UPDATE waterTankSensors s JOIN clients c ON s.clientId = c.id
                SET s.tenantId = c.tenantId
                WHERE s.tenantId IS NULL AND c.tenantId IS NOT NULL`,
  },
  {
    tabela: "waterTankMonitoring",
    regra: "waterTankMonitoring.tenantId ← clients.tenantId (via clientId)",
    sqlUpdate: `UPDATE waterTankMonitoring m JOIN clients c ON m.clientId = c.id
                SET m.tenantId = c.tenantId
                WHERE m.tenantId IS NULL AND c.tenantId IS NOT NULL`,
  },
  {
    tabela: "waterTankAlertLog",
    regra: "waterTankAlertLog.tenantId ← clients.tenantId (via clientId)",
    sqlUpdate: `UPDATE waterTankAlertLog a JOIN clients c ON a.clientId = c.id
                SET a.tenantId = c.tenantId
                WHERE a.tenantId IS NULL AND c.tenantId IS NOT NULL`,
  },
  {
    tabela: "waterTankFaultLog",
    regra: "waterTankFaultLog.tenantId ← clients.tenantId (via clientId)",
    sqlUpdate: `UPDATE waterTankFaultLog f JOIN clients c ON f.clientId = c.id
                SET f.tenantId = c.tenantId
                WHERE f.tenantId IS NULL AND c.tenantId IS NOT NULL`,
  },
  {
    tabela: "budgetItems",
    regra: "budgetItems.tenantId ← budgets.tenantId (via budgetId)",
    sqlUpdate: `UPDATE budgetItems x JOIN budgets b ON x.budgetId = b.id
                SET x.tenantId = b.tenantId
                WHERE x.tenantId IS NULL AND b.tenantId IS NOT NULL`,
  },
  {
    tabela: "budgetHistory",
    regra: "budgetHistory.tenantId ← budgets.tenantId (via budgetId)",
    sqlUpdate: `UPDATE budgetHistory x JOIN budgets b ON x.budgetId = b.id
                SET x.tenantId = b.tenantId
                WHERE x.tenantId IS NULL AND b.tenantId IS NOT NULL`,
  },
  {
    tabela: "budgetAttachments",
    regra: "budgetAttachments.tenantId ← budgets.tenantId (via budgetId)",
    sqlUpdate: `UPDATE budgetAttachments x JOIN budgets b ON x.budgetId = b.id
                SET x.tenantId = b.tenantId
                WHERE x.tenantId IS NULL AND b.tenantId IS NOT NULL`,
  },
];

// Tabelas cujo tenant NÃO é derivável por join simples → decisão manual.
// (Hoje só o tenant 1/JNC usa laudos, então o resíduo provavelmente é tenant 1,
//  mas não hardcodamos — reportamos para o Thiago decidir.)
//
// `notificationLogs` é um caso à parte: a origem NÃO é ambígua (userId + userType
// dá pra derivar via clients/technicians/admins, igual pushSubscriptions), mas o
// gap real está no caminho de escrita — `server/lib/notifications.ts` insere sem
// nunca carimbar tenantId, então cada linha nova nasce NULL de novo. Backfill sozinho
// não resolve; fica fora da lista de determinísticos até esse gap ser corrigido no
// código (achado durante a extensão deste script, fora do escopo da leva original —
// avaliar junto da 3.7.9, que já vai mexer no fluxo de notificações).
const AMBIGUAS = [
  "configuracoesTecnico",
  "laudos (residual sem cliente nem OS)",
  "notificationLogs (origem derivável, mas o INSERT em server/lib/notifications.ts não carimba tenantId — corrigir o código antes/junto do backfill)",
];

async function main() {
  console.log(`\n${"=".repeat(58)}`);
  console.log(`  Backfill tenantId IS NULL — 3.7.2 — Modo: ${MODE}`);
  console.log(`${"=".repeat(58)}\n`);

  assertProductionEnvironment();

  const db = await getDb();
  if (!db) throw new Error("Banco indisponível");

  // 1. Descobrir todas as tabelas com coluna tenantId
  const dbName = process.env.DB_NAME;
  const colsResult: any = await db.execute(sql`
    SELECT TABLE_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = ${dbName} AND COLUMN_NAME = 'tenantId'
    ORDER BY TABLE_NAME
  `);
  const tabelas: string[] = (colsResult[0] as any[]).map((r) => r.TABLE_NAME);

  console.log(`Tabelas com coluna tenantId: ${tabelas.length}\n`);

  // 2. Contar NULLs por tabela (ANTES)
  console.log("── Contagem de tenantId IS NULL (ANTES) ──────────────────");
  const antes: Record<string, number> = {};
  for (const t of tabelas) {
    const r: any = await db.execute(
      sql.raw(`SELECT COUNT(*) AS n FROM \`${t}\` WHERE tenantId IS NULL`)
    );
    const n = Number((r[0] as any[])[0].n);
    antes[t] = n;
    console.log(`  ${t.padEnd(28)} ${n}`);
  }

  const totalNulls = Object.values(antes).reduce((a, b) => a + b, 0);
  console.log(`\n  TOTAL de linhas com tenantId NULL: ${totalNulls}\n`);

  // 3. Aplicar backfills determinísticos (só em --apply)
  if (isApply) {
    console.log("── Aplicando backfills determinísticos ───────────────────");
    for (const bf of BACKFILLS_DETERMINISTICOS) {
      const r: any = await db.execute(sql.raw(bf.sqlUpdate.replace(/\s+/g, " ")));
      const afetadas = (r[0] as any)?.affectedRows ?? 0;
      console.log(`  ${bf.tabela.padEnd(30)} +${afetadas}  (${bf.regra})`);
    }

    // 4. Recontar NULLs (DEPOIS)
    console.log("\n── Contagem de tenantId IS NULL (DEPOIS) ─────────────────");
    for (const t of tabelas) {
      const r: any = await db.execute(
        sql.raw(`SELECT COUNT(*) AS n FROM \`${t}\` WHERE tenantId IS NULL`)
      );
      const n = Number((r[0] as any[])[0].n);
      const delta = antes[t] - n;
      console.log(`  ${t.padEnd(28)} ${n}${delta > 0 ? `  (-${delta})` : ""}`);
    }
  } else {
    console.log("── Backfills que SERIAM aplicados em --apply ─────────────");
    for (const bf of BACKFILLS_DETERMINISTICOS) {
      console.log(`  • ${bf.regra}`);
    }
  }

  console.log("\n── Decisão manual necessária (origem de tenant ambígua) ──");
  for (const a of AMBIGUAS) console.log(`  • ${a}`);
  console.log("\n(PDV fica de fora por design — tenant-1-only, sem coluna multi-tenant.)\n");

  process.exit(0);
}

main().catch((e) => {
  console.error("❌ Erro no backfill:", e);
  process.exit(1);
});
