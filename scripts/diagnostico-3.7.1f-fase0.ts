#!/usr/bin/env tsx
/**
 * Fase 0 do plano 3.7.1f — Diagnóstico (read-only).
 *
 * Não altera nada. Roda as queries 0.1/0.2/0.3 do PLANO_3.7.1f.md e,
 * para cada tabela com coluna tenantId, conta linhas totais e NULLs.
 *
 * Uso: pnpm tsx scripts/diagnostico-3.7.1f-fase0.ts
 */

import { config } from "dotenv";
config();

import { assertStagingEnvironment } from "../server/lib/environment";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

async function main() {
  assertStagingEnvironment();
  const db = await getDb();
  if (!db) throw new Error("ABORT: getDb() retornou null (DATABASE_URL ausente ou conexão falhou)");

  const [[dbNameRow]] = await db.execute(sql`SELECT DATABASE() as db`);
  console.log("=== Banco conectado ===");
  console.log(dbNameRow);

  console.log("\n=== 0.1 — Tabelas com coluna tenantId (tipo + nullability) ===");
  const [col01] = await db.execute(sql`
    SELECT TABLE_NAME, COLUMN_TYPE, IS_NULLABLE
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'tenantId'
    ORDER BY TABLE_NAME
  `);
  console.table(col01);

  console.log("\n=== 0.2 — Engine de tenants ===");
  const [eng02] = await db.execute(sql`
    SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('tenants')
  `);
  console.table(eng02);

  console.log("\n=== 0.3 — Tabelas que já têm FK tenantId -> tenants ===");
  const [fk03] = await db.execute(sql`
    SELECT TABLE_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'tenantId'
      AND REFERENCED_TABLE_NAME = 'tenants'
  `);
  console.table(fk03);

  const tables = (col01 as any[]).map((r) => r.TABLE_NAME as string);
  const fkTables = new Set((fk03 as any[]).map((r) => r.TABLE_NAME as string));

  console.log("\n=== Contagem de linhas / NULLs por tabela ===");
  const results: Array<{
    tabela: string;
    linhas: number;
    nulos: number;
    is_nullable: string;
    ja_tem_fk: string;
  }> = [];

  for (const t of tables) {
    try {
      const [[row]] = await db.execute(
        sql.raw(
          `SELECT COUNT(*) AS linhas, SUM(tenantId IS NULL) AS nulos FROM \`${t}\``
        )
      );
      const colInfo = (col01 as any[]).find((r) => r.TABLE_NAME === t);
      results.push({
        tabela: t,
        linhas: Number((row as any).linhas),
        nulos: Number((row as any).nulos ?? 0),
        is_nullable: colInfo?.IS_NULLABLE ?? "?",
        ja_tem_fk: fkTables.has(t) ? "SIM" : "não",
      });
    } catch (e: any) {
      results.push({
        tabela: t,
        linhas: -1,
        nulos: -1,
        is_nullable: "ERRO",
        ja_tem_fk: e?.message ?? String(e),
      });
    }
  }

  console.table(results);

  const comNulls = results.filter((r) => r.nulos > 0);
  const semFkPendente = results.filter((r) => r.ja_tem_fk === "não" && r.nulos === 0);

  console.log(`\nTotal de tabelas com tenantId: ${results.length}`);
  console.log(`Tabelas COM NULLs residuais (precisam de backfill antes de travar): ${comNulls.length}`);
  if (comNulls.length) console.table(comNulls);
  console.log(`Tabelas SEM FK ainda e SEM nulls (candidatas a travar na Fase 2): ${semFkPendente.length}`);

  process.exit(0);
}

main().catch((e) => {
  console.error("ERRO na Fase 0:", e);
  process.exit(1);
});
