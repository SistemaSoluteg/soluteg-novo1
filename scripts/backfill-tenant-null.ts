#!/usr/bin/env tsx
/**
 * Backfill final de tenantId IS NULL — Sub-fase 3.7.2 (fechamento)
 *
 * Uso:
 *   pnpm tsx scripts/backfill-tenant-null.ts           (DRY-RUN: só reporta contagens)
 *   pnpm tsx scripts/backfill-tenant-null.ts --apply    (aplica backfills determinísticos)
 *
 * O que faz:
 *   1. Varre TODAS as tabelas do banco que possuem coluna `tenantId`
 *      (via information_schema) e conta quantas linhas têm tenantId IS NULL.
 *   2. Em --apply, executa apenas os backfills DETERMINÍSTICOS (derivados de
 *      uma entidade pai inequívoca). Tabelas cuja origem do tenant é ambígua
 *      são apenas reportadas para decisão manual.
 *
 * Segurança:
 *   - assertStagingEnvironment() aborta se não estiver no banco de staging.
 *   - PDV (categories/sales/saleItems/cashTransactions/customers/products) fica
 *     FORA por design — módulo é tenant-1-only, sem coluna tenantId multi-tenant.
 *
 * Pré-requisito: rodar DEPOIS do deploy da 3.7.2 no staging, após um ciclo de uso.
 */

import { config } from "dotenv";
config();

import { assertStagingEnvironment } from "../server/lib/environment";
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
];

// Tabelas cujo tenant NÃO é derivável por join simples → decisão manual.
// (Hoje só o tenant 1/JNC usa laudos, então o resíduo provavelmente é tenant 1,
//  mas não hardcodamos — reportamos para o Thiago decidir.)
const AMBIGUAS = ["configuracoesTecnico", "laudos (residual sem cliente nem OS)"];

async function main() {
  console.log(`\n${"=".repeat(58)}`);
  console.log(`  Backfill tenantId IS NULL — 3.7.2 — Modo: ${MODE}`);
  console.log(`${"=".repeat(58)}\n`);

  assertStagingEnvironment();

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
