#!/usr/bin/env tsx
/**
 * Script de migração para multi-tenant — Sub-fases 3.7.1d/e
 *
 * Uso:
 *   pnpm tsx scripts/migrate-to-multi-tenant.ts          (DRY-RUN, padrão)
 *   pnpm tsx scripts/migrate-to-multi-tenant.ts --apply  (aplicação real)
 *
 * Pré-requisitos:
 *   - Sub-fases 3.7.1a, 3.7.1b, 3.7.1c já aplicadas no banco staging
 *   - DB_NAME=d5ea2e96_tst e DATABASE_URL no .env apontando para staging
 *   - Backup recente antes de usar --apply
 */

import { config } from 'dotenv';
config();

import { assertStagingEnvironment, maskEmail } from '../server/lib/environment';
import { drizzle } from 'drizzle-orm/mysql2';
import { sql, eq } from 'drizzle-orm';
import {
  tenants,
  platformAdmins,
  migrationAuditLog,
} from '../drizzle/schema';
import type {
  InsertTenant,
  InsertPlatformAdmin,
  InsertMigrationAuditLog,
} from '../drizzle/schema';
import bcrypt from 'bcrypt';
import * as readline from 'readline';

// ── Modo de execução ────────────────────────────────────────────────────────

const isApply = process.argv.includes('--apply');
const MODE = isApply ? 'APPLY' : 'DRY-RUN';
const MIGRATION_NAME = '3.7.1e-populate-tenants';
const START = Date.now();

console.log(`\n${'='.repeat(58)}`);
console.log(`  Migração Multi-tenant 3.7.1d/e — Modo: ${MODE}`);
console.log(`${'='.repeat(58)}\n`);

// ── 38 tabelas operacionais da Sub-fase 3.7.1c ──────────────────────────────
// Ordem: tabelas com mais dados primeiro para feedback visual rápido

const TABELAS_OPERACIONAIS = [
  'clients',            'workOrders',           'budgets',
  'products',           'workOrderHistory',     'workOrderTasks',
  'workOrderMaterials', 'workOrderAttachments', 'workOrderComments',
  'workOrderTimeTracking', 'budgetItems',        'budgetHistory',
  'budgetAttachments',  'inspectionReports',    'inspectionTasks',
  'checklistInstances', 'waterTankMonitoring',  'waterTankSensors',
  'waterTankAlertLog',  'waterTankFaultLog',    'laudos',
  'laudoFotos',         'laudoMedicoes',        'laudoTecnicos',
  'laudoCitacoes',      'configuracoesTecnico', 'technicians',
  'clientDocuments',    'reports',              'invites',
  'notificationContacts', 'notificationLogs',   'pushSubscriptions',
  'categories',         'sales',                'saleItems',
  'cashTransactions',   'customers',
] as const;

// Contagens mínimas esperadas para validação de integridade dos dados
const CONTAGENS_MINIMAS: Record<string, number> = {
  clients:    29,
  workOrders: 76,
  budgets:    19,
  products:   270,
};

// ── Dados fixos dos tenants ─────────────────────────────────────────────────

const TENANT_JNC: InsertTenant = {
  name:             'JNC Comércio e Serviços',
  slug:             'jnc',
  isPlatformTenant: 0,
  logoUrl:          null,
  primaryColor:     '#D4A84B',
  whatsappNumber:   '(13) 98164-8402',
  contactEmail:     'contato@soluteg.com.br',
  cnpj:             null,
  address:          null,
  city:             'Praia Grande',
  state:            'SP',
  active:           1,
};

const TENANT_SOLUTEG: InsertTenant = {
  name:             'Soluteg Direto',
  slug:             'soluteg-direto',
  isPlatformTenant: 1,
  logoUrl:          null,
  primaryColor:     '#D4A84B',
  whatsappNumber:   null,
  contactEmail:     'contato@soluteg.com.br',
  cnpj:             null,
  address:          null,
  city:             null,
  state:            null,
  active:           1,
};

const ADMIN_EMAIL = 'thiagodll69@gmail.com';
const ADMIN_NAME  = 'Thiago Lopes';

// ── Utilitários de output ───────────────────────────────────────────────────

function step(titulo: string)  { console.log(`\n── ${titulo} ──`); }
function ok(msg: string)       { console.log(`  ✓ ${msg}`); }
function noop(msg: string)     { console.log(`  — ${msg}`); }
function warn(msg: string)     { console.log(`  ⚠ ${msg}`); }
function dry(msg: string)      { console.log(`  [DRY] ${msg}`); }
function fail(msg: string)     { console.error(`  ✗ ${msg}`); }

// ── Utilitários de I/O ──────────────────────────────────────────────────────

async function promptText(q: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(q, a => { rl.close(); resolve(a.trim()); }));
}

async function promptSilent(q: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return promptText(q);
  }
  return new Promise(resolve => {
    process.stdout.write(q);
    let buf = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const handler = (c: string) => {
      if (c === '\r' || c === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', handler);
        process.stdout.write('\n');
        resolve(buf);
      } else if (c === '') {
        // Ctrl+C
        process.stdin.setRawMode(false);
        process.stdout.write('\n');
        process.exit(0);
      } else if (c === '') {
        if (buf.length > 0) { buf = buf.slice(0, -1); process.stdout.write('\b \b'); }
      } else {
        buf += c;
        process.stdout.write('*');
      }
    };
    process.stdin.on('data', handler);
  });
}

// ── Utilitários de banco ────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

async function tabelaExiste(db: AnyDb, tabela: string): Promise<boolean> {
  const [rows] = await db.execute(sql.raw(
    `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${tabela}'`
  ));
  return (rows as unknown[]).length > 0;
}

async function colunaExiste(db: AnyDb, tabela: string, coluna: string): Promise<boolean> {
  const [rows] = await db.execute(sql.raw(
    `SELECT 1 FROM information_schema.COLUMNS ` +
    `WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${tabela}' AND COLUMN_NAME = '${coluna}'`
  ));
  return (rows as unknown[]).length > 0;
}

async function contar(db: AnyDb, tabela: string): Promise<number> {
  const [rows] = await db.execute(sql.raw(`SELECT COUNT(*) AS n FROM \`${tabela}\``));
  return Number((rows as Array<{ n: unknown }>)[0]?.n ?? 0);
}

async function contarNulos(db: AnyDb, tabela: string): Promise<number> {
  const [rows] = await db.execute(sql.raw(
    `SELECT COUNT(*) AS n FROM \`${tabela}\` WHERE tenantId IS NULL`
  ));
  return Number((rows as Array<{ n: unknown }>)[0]?.n ?? 0);
}

async function registrarLog(
  db: AnyDb,
  entry: Omit<InsertMigrationAuditLog, 'migrationName' | 'executedBy'>
): Promise<void> {
  await db.insert(migrationAuditLog).values({
    ...entry,
    migrationName: MIGRATION_NAME,
    executedBy:    ADMIN_NAME,
  });
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {

  // ─── Etapa 0: Pré-validações ──────────────────────────────────────────────

  step('Etapa 0 — Pré-validações');

  // Aborta se não for staging (lê DB_NAME do .env)
  assertStagingEnvironment();

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    fail('DATABASE_URL não definido no .env');
    process.exit(1);
  }

  const db = drizzle(dbUrl);
  ok(`Conectado ao banco (${process.env.DB_NAME})`);

  // Verifica tabelas de auditoria (Sub-fase 3.7.1a)
  for (const t of ['auditLog', 'loginAttempts', 'migrationAuditLog'] as const) {
    if (!(await tabelaExiste(db, t))) {
      fail(`Tabela ausente: ${t} — execute a Sub-fase 3.7.1a primeiro`);
      process.exit(1);
    }
    ok(t);
  }

  // Verifica tabelas multi-tenant (Sub-fase 3.7.1b)
  for (const t of ['tenants', 'platformAdmins', 'gestors', 'condominiums', 'notificationContacts'] as const) {
    if (!(await tabelaExiste(db, t))) {
      fail(`Tabela ausente: ${t} — execute a Sub-fase 3.7.1b primeiro`);
      process.exit(1);
    }
    ok(t);
  }

  // Verifica coluna tenantId nas 38 tabelas (Sub-fase 3.7.1c)
  console.log('\n  Verificando tenantId nas 38 tabelas operacionais...');
  const semTenantId: string[] = [];
  for (const t of TABELAS_OPERACIONAIS) {
    if (!(await colunaExiste(db, t, 'tenantId'))) semTenantId.push(t);
  }
  if (semTenantId.length > 0) {
    fail(`${semTenantId.length} tabela(s) sem coluna tenantId: ${semTenantId.join(', ')}`);
    fail('Execute a Sub-fase 3.7.1c primeiro.');
    process.exit(1);
  }
  ok(`Todas as ${TABELAS_OPERACIONAIS.length} tabelas têm coluna tenantId`);

  // Contagens iniciais para referência
  console.log('\n  Contagens atuais:');
  for (const [t, min] of Object.entries(CONTAGENS_MINIMAS)) {
    const total = await contar(db, t);
    console.log(`  ${total >= min ? '✓' : '⚠'} ${t}: ${total} (mínimo esperado: ${min})`);
  }

  // ─── Etapa 1: Mudanças estruturais ────────────────────────────────────────
  // NOTA: ALTER TABLE é DDL — causa commit implícito no MySQL,
  // por isso fica FORA da transação de dados das etapas 2-4.

  step('Etapa 1 — Mudanças estruturais');

  // condominiums.type — tipo do local (condomínio, empresa, etc.)
  if (await colunaExiste(db, 'condominiums', 'type')) {
    ok('condominiums.type já existe — pulando');
  } else {
    const q = `ALTER TABLE \`condominiums\` ADD COLUMN \`type\` varchar(40) NOT NULL DEFAULT 'condominio' AFTER \`name\``;
    if (isApply) {
      await db.execute(sql.raw(q));
      ok('condominiums.type adicionada (default: condominio)');
    } else {
      dry(`SQL: ${q}`);
    }
  }

  // clients.gestorId — vínculo opcional ao gestor (para migração futura via UI)
  // FK para gestors não é adicionada agora porque gestors está vazia.
  // Será adicionada em sub-fase futura quando gestors tiver registros.
  if (await colunaExiste(db, 'clients', 'gestorId')) {
    ok('clients.gestorId já existe — pulando');
  } else {
    const q = `ALTER TABLE \`clients\` ADD COLUMN \`gestorId\` int NULL AFTER \`id\``;
    if (isApply) {
      await db.execute(sql.raw(q));
      ok('clients.gestorId adicionada (nullable, sem FK por ora)');
    } else {
      dry(`SQL: ${q}`);
    }
  }

  // ─── Etapas 2-4: em transação (modo --apply) ou simulação (dry-run) ───────

  if (isApply) {

    // Confirmação explícita antes de qualquer alteração de dados
    console.log('\n' + '!'.repeat(58));
    console.log('  ATENÇÃO: você está prestes a aplicar a migração.');
    console.log(`  Banco:     ${process.env.DB_NAME}`);
    console.log('  Operações:');
    console.log('    - Criar 2 tenants (JNC e Soluteg Direto)');
    console.log(`    - Atualizar tenantId em ${TABELAS_OPERACIONAIS.length} tabelas`);
    console.log('    - Criar 1 platformAdmin (Thiago Lopes)');
    console.log('!'.repeat(58) + '\n');

    const conf = await promptText('Digite "CONFIRMAR" para prosseguir (qualquer outra coisa aborta):\n> ');
    if (conf !== 'CONFIRMAR') {
      console.log('\nAbortado pelo usuário.');
      process.exit(0);
    }

    // Coleta a senha ANTES de abrir a transação (I/O não pode ocorrer dentro da tx)
    console.log('');
    let passwordHash = '';
    for (;;) {
      const s1 = await promptSilent('Senha do platformAdmin (mín. 12 caracteres): ');
      if (s1.length < 12) {
        fail('Senha muito curta. Mínimo 12 caracteres.');
        continue;
      }
      const s2 = await promptSilent('Confirme a senha: ');
      if (s1 !== s2) {
        fail('Senhas não coincidem. Tente novamente.');
        continue;
      }
      console.log('  Gerando hash bcrypt (cost 12)...');
      passwordHash = await bcrypt.hash(s1, 12);
      ok('Senha definida com sucesso.');
      break;
    }

    // Tudo abaixo roda em transação — ROLLBACK automático em erro
    await db.transaction(async (tx: AnyDb) => {

      // ── Etapa 2: Criar tenants ───────────────────────────────────────────

      step('Etapa 2 — Criar tenants');

      // Tenant JNC (id esperado = 1)
      let jncId: number;
      const [jncExiste] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, 'jnc')).limit(1);
      if (jncExiste) {
        jncId = jncExiste.id;
        warn(`Tenant JNC já existe (id=${jncId}) — pulando`);
        await registrarLog(tx, {
          step: 'criar_tenant_jnc', sourceType: null, sourceId: null,
          targetType: 'tenant', targetId: String(jncId),
          status: 'skipped', details: '{"motivo":"já existe","slug":"jnc"}', errorMessage: null,
        });
      } else {
        await tx.insert(tenants).values(TENANT_JNC);
        const [criado] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, 'jnc')).limit(1);
        jncId = criado!.id;
        ok(`Tenant JNC criado (id=${jncId})`);
        await registrarLog(tx, {
          step: 'criar_tenant_jnc', sourceType: null, sourceId: null,
          targetType: 'tenant', targetId: String(jncId),
          status: 'success', details: `{"slug":"jnc","nome":"${TENANT_JNC.name}","city":"${TENANT_JNC.city}"}`,
          errorMessage: null,
        });
      }

      // Tenant Soluteg Direto (id esperado = 2)
      let solutegId: number;
      const [solutegExiste] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, 'soluteg-direto')).limit(1);
      if (solutegExiste) {
        solutegId = solutegExiste.id;
        warn(`Tenant Soluteg Direto já existe (id=${solutegId}) — pulando`);
        await registrarLog(tx, {
          step: 'criar_tenant_soluteg_direto', sourceType: null, sourceId: null,
          targetType: 'tenant', targetId: String(solutegId),
          status: 'skipped', details: '{"motivo":"já existe","slug":"soluteg-direto"}', errorMessage: null,
        });
      } else {
        await tx.insert(tenants).values(TENANT_SOLUTEG);
        const [criado] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, 'soluteg-direto')).limit(1);
        solutegId = criado!.id;
        ok(`Tenant Soluteg Direto criado (id=${solutegId})`);
        await registrarLog(tx, {
          step: 'criar_tenant_soluteg_direto', sourceType: null, sourceId: null,
          targetType: 'tenant', targetId: String(solutegId),
          status: 'success', details: '{"slug":"soluteg-direto","isPlatformTenant":1}',
          errorMessage: null,
        });
      }

      // ── Etapa 3: Popular tenantId=1 nas 38 tabelas ───────────────────────

      step('Etapa 3 — Popular tenantId nas 38 tabelas');

      for (const tabela of TABELAS_OPERACIONAIS) {
        const [res] = await tx.execute(sql.raw(
          `UPDATE \`${tabela}\` SET tenantId = ${jncId} WHERE tenantId IS NULL`
        ));
        const n = Number((res as { affectedRows?: number }).affectedRows ?? 0);
        if (n > 0) {
          ok(`${tabela}: ${n} linha(s) atualizada(s)`);
          await registrarLog(tx, {
            step: `update_tenantId_${tabela}`, sourceType: tabela, sourceId: null,
            targetType: 'tenant', targetId: String(jncId),
            status: 'success', details: `{"linhasAfetadas":${n}}`, errorMessage: null,
          });
        } else {
          noop(`${tabela}: 0 linhas (vazio ou já preenchido)`);
        }
      }

      // ── Etapa 4: Criar conta platformAdmin ──────────────────────────────

      step('Etapa 4 — Criar platformAdmin');

      const [adminExiste] = await tx.select({ id: platformAdmins.id })
        .from(platformAdmins)
        .where(eq(platformAdmins.email, ADMIN_EMAIL))
        .limit(1);

      if (adminExiste) {
        warn(`platformAdmin ${maskEmail(ADMIN_EMAIL)} já existe (id=${adminExiste.id}) — pulando`);
        await registrarLog(tx, {
          step: 'criar_platform_admin', sourceType: null, sourceId: null,
          targetType: 'platformAdmin', targetId: String(adminExiste.id),
          status: 'skipped',
          details: `{"motivo":"já existe","email":"${maskEmail(ADMIN_EMAIL)}"}`,
          errorMessage: null,
        });
      } else {
        const adminData: InsertPlatformAdmin = {
          name:              ADMIN_NAME,
          email:             ADMIN_EMAIL,
          passwordHash,
          active:            1,
          lastLoginAt:       null,
          mustResetPassword: 0,
        };
        await tx.insert(platformAdmins).values(adminData);

        const [criado] = await tx.select({ id: platformAdmins.id })
          .from(platformAdmins)
          .where(eq(platformAdmins.email, ADMIN_EMAIL))
          .limit(1);

        ok(`platformAdmin criado (id=${criado!.id}, ${maskEmail(ADMIN_EMAIL)})`);
        await registrarLog(tx, {
          step: 'criar_platform_admin', sourceType: null, sourceId: null,
          targetType: 'platformAdmin', targetId: String(criado!.id),
          status: 'success',
          details: `{"nome":"${ADMIN_NAME}","email":"${maskEmail(ADMIN_EMAIL)}","mustResetPassword":0}`,
          errorMessage: null,
        });
      }

    }); // fim da transação — COMMIT automático se chegou até aqui

  } else {

    // ─── DRY-RUN: simula etapas 2-4 sem escrever nada ────────────────────────

    step('Etapa 2 — Criar tenants [DRY-RUN]');

    const [jncExiste] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, 'jnc')).limit(1);
    if (jncExiste) {
      warn(`Tenant 'jnc' já existe (id=${jncExiste.id}) — seria pulado em --apply`);
    } else {
      dry(`INSERT tenants: { slug: 'jnc', name: '${TENANT_JNC.name}', city: '${TENANT_JNC.city}', isPlatformTenant: 0 }`);
    }

    const [solutegExiste] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, 'soluteg-direto')).limit(1);
    if (solutegExiste) {
      warn(`Tenant 'soluteg-direto' já existe (id=${solutegExiste.id}) — seria pulado em --apply`);
    } else {
      dry(`INSERT tenants: { slug: 'soluteg-direto', name: '${TENANT_SOLUTEG.name}', isPlatformTenant: 1 }`);
    }

    step('Etapa 3 — Popular tenantId nas 38 tabelas [DRY-RUN]');

    let totalLinhas = 0;
    for (const tabela of TABELAS_OPERACIONAIS) {
      const n = await contarNulos(db, tabela);
      if (n > 0) {
        dry(`UPDATE \`${tabela}\` SET tenantId = 1 WHERE tenantId IS NULL  → ${n} linha(s)`);
        totalLinhas += n;
      } else {
        noop(`${tabela}: 0 linhas nulas`);
      }
    }
    console.log(`\n  → Total que SERIA atualizado: ${totalLinhas} linha(s) em ${TABELAS_OPERACIONAIS.length} tabelas`);

    step('Etapa 4 — Criar platformAdmin [DRY-RUN]');

    const [adminExiste] = await db.select({ id: platformAdmins.id })
      .from(platformAdmins)
      .where(eq(platformAdmins.email, ADMIN_EMAIL))
      .limit(1);

    if (adminExiste) {
      warn(`platformAdmin ${maskEmail(ADMIN_EMAIL)} já existe (id=${adminExiste.id}) — seria pulado em --apply`);
    } else {
      dry(`INSERT platformAdmins: { name: '${ADMIN_NAME}', email: '${maskEmail(ADMIN_EMAIL)}', mustResetPassword: 0 }`);
      dry('Senha seria solicitada interativamente (mín. 12 chars, bcrypt cost 12)');
    }

  } // fim do bloco apply/dry-run

  // ─── Etapa 5: Validações finais ───────────────────────────────────────────

  step('Etapa 5 — Validações finais');

  let passou = true;

  if (isApply) {
    // Verifica ausência de NULLs residuais
    console.log('\n  Verificando NULLs residuais:');
    for (const t of TABELAS_OPERACIONAIS) {
      const n = await contarNulos(db, t);
      if (n > 0) { fail(`${t}: ${n} linhas com tenantId NULL`); passou = false; }
    }
    if (passou) ok('Nenhuma linha com tenantId NULL');

    // Verifica se todos os tenantIds apontam para um tenant existente
    console.log('\n  Verificando integridade referencial (tenantId aponta para tenant válido):');
    for (const t of ['clients', 'workOrders', 'budgets', 'products'] as const) {
      const [rows] = await (db as AnyDb).execute(sql.raw(
        `SELECT COUNT(*) AS n FROM \`${t}\` WHERE tenantId NOT IN (SELECT id FROM tenants)`
      ));
      const n = Number((rows as Array<{ n: unknown }>)[0]?.n ?? 0);
      if (n > 0) { fail(`${t}: ${n} linhas com tenantId inválido`); passou = false; }
      else ok(`${t}: tenantId válido`);
    }
  }

  // Contagens finais (em ambos os modos)
  console.log('\n  Contagens finais:');
  for (const [t, min] of Object.entries(CONTAGENS_MINIMAS)) {
    const total = await contar(db, t);
    const ok_sym = total >= min ? '✓' : '✗';
    console.log(`  ${ok_sym} ${t}: ${total} (mínimo: ${min})`);
    if (total < min && isApply) passou = false;
  }

  // Lista de tenants
  console.log('\n  Tenants no banco:');
  const ts = await db.select({ id: tenants.id, slug: tenants.slug, name: tenants.name }).from(tenants);
  if (ts.length === 0) {
    if (isApply) { fail('Nenhum tenant encontrado!'); passou = false; }
    else dry('Nenhum tenant criado ainda (esperado somente após --apply)');
  } else {
    ts.forEach((t: { id: number; slug: string; name: string }) =>
      console.log(`  ✓ id=${t.id}, slug=${t.slug}, name=${t.name}`)
    );
  }

  // Lista de platformAdmins
  console.log('\n  PlatformAdmins no banco:');
  const pas = await db.select({
    id:     platformAdmins.id,
    name:   platformAdmins.name,
    email:  platformAdmins.email,
    active: platformAdmins.active,
  }).from(platformAdmins);
  if (pas.length === 0) {
    if (isApply) { fail('Nenhum platformAdmin encontrado!'); passou = false; }
    else dry('Nenhum platformAdmin criado ainda (esperado somente após --apply)');
  } else {
    pas.forEach((a: { id: number; name: string; email: string; active: number }) =>
      console.log(`  ✓ id=${a.id}, name=${a.name}, email=${maskEmail(a.email)}, active=${a.active}`)
    );
  }

  if (isApply && !passou) {
    fail('VALIDAÇÃO FALHOU — verifique os erros acima');
    process.exit(1);
  }

  // ─── Etapa 6: Relatório final ──────────────────────────────────────────────

  const elapsed = ((Date.now() - START) / 1000).toFixed(1);

  step('Etapa 6 — Relatório final');
  console.log(`  Modo:         ${MODE}`);
  console.log(`  Banco:        ${process.env.DB_NAME}`);
  console.log(`  Tempo:        ${elapsed}s`);
  console.log(`  Tabelas alvo: ${TABELAS_OPERACIONAIS.length}`);

  if (isApply) {
    console.log('\n  ✓ Migração aplicada com sucesso.');
    console.log('  Próximos passos:');
    console.log('    1. Validar via MySQL: information_schema.TABLES + SELECT * FROM tenants');
    console.log('    2. Fazer backup do banco staging');
    console.log('    3. Atualizar ROADMAP.md e CLAUDE.md (protocolo fim de sub-fase)');
    console.log('    4. Avançar para Sub-fase 3.7.1e se necessário, depois 3.7.1f (NOT NULL + JWT)');
  } else {
    console.log('\n  DRY-RUN concluído. Nenhuma alteração foi feita no banco.');
    console.log('  Para aplicar a migração, execute:');
    console.log('    pnpm tsx scripts/migrate-to-multi-tenant.ts --apply');
  }

  process.exit(0);
}

main().catch(err => {
  console.error('\n✗ Erro fatal:', err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
