# Plano — Sub-fase 3.7.1f (travamento final): NOT NULL + FKs + índices + rotação JWT

> A trava final do multi-tenant. **Mudança de schema — a mais arriscada.** Staging primeiro; produção só com backup. Aplicar migrations com `sed` (não `grep -v`) e **validar cada FK/índice via `information_schema`** (pipe pode dropar multi-statement silenciosamente — regra do CLAUDE.md §5.5). Rodar no banco `_tst`.

## Decisões de escopo (já tomadas com o Thiago)
- **PDV entra** no travamento (tudo é tenant 1) — as 6 tabelas de `pdvSchema.ts` (products, sales, saleItems, cashTransactions, customers, categories) recebem NOT NULL + FK.
- **`notificationLogs` FICA DE FORA** (NOTIF-01: write-path não carimba, acumula NULL). Deixar nullable até a 3.7.9.
- **Legado/infra** (`reports`, `inspectionReports`, `invites`, `auditLog`, `loginAttempts`, `migrationAuditLog`): decidir **após a Fase 0** (ver contagem de linhas/NULLs).
- **`client_equipment`** não tem coluna `tenantId` — fora por natureza.
- **Centrais** (`condominiums`, `gestors`, etc. da 3.7.1b) já têm `tenantId NOT NULL` + FK — não re-aplicar.

---

## FASE 0 — Diagnóstico (a fonte da verdade)

Rodar no `_tst` e **trazer o resultado pro Thiago antes de qualquer ALTER**:

```sql
SELECT DATABASE();  -- confirmar d5ea2e96_tst

-- 0.1 — Todas as tabelas que têm coluna tenantId, com tipo e nullability atual
SELECT TABLE_NAME, COLUMN_TYPE, IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'tenantId'
ORDER BY TABLE_NAME;

-- 0.2 — FK alvo existe e é InnoDB? (tenants.id int PK)
SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('tenants');

-- 0.3 — Quais já têm FK de tenantId (centrais da 3.7.1b — pular)
SELECT TABLE_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'tenantId'
  AND REFERENCED_TABLE_NAME = 'tenants';
```

Depois, **para cada tabela da 0.1**, contar linhas e NULLs (gerar o SQL a partir da lista da 0.1 — um `SELECT '<tab>' t, COUNT(*) linhas, SUM(tenantId IS NULL) nulos FROM <tab>` por tabela, UNION ALL). Isso dá: (a) o conjunto real a travar, (b) quem ainda tem NULL, (c) tabelas vazias (legado) que dá pra travar sem risco.

**Saída esperada da Fase 0:** a lista definitiva de tabelas a travar, e a decisão final sobre legado/infra (ex.: `reports` vazia/sem writer → travar é trivial ou deixar de fora; `auditLog` → travar se for por tenant).

---

## FASE 1 — Backfill + limpeza (zerar NULLs deriváveis)

```bash
# dry-run: reporta contagens
pnpm tsx scripts/backfill-tenant-null.ts
# aplica os 16 backfills determinísticos
pnpm tsx scripts/backfill-tenant-null.ts --apply
```
Limpeza manual do que o script não resolve:
```sql
-- Lixo de teste (budget órfão id=22 + filhos)
DELETE FROM budgetItems WHERE budgetId = 22;
DELETE FROM budgetHistory WHERE budgetId = 22;
DELETE FROM budgets WHERE id = 22;

-- Ambíguas que hoje só podem ser tenant 1 (JNC) — decisão manual, é seguro:
UPDATE configuracoesTecnico SET tenantId = 1 WHERE tenantId IS NULL;
-- laudo residual sem cliente/OS, se houver:
-- UPDATE laudos SET tenantId = 1 WHERE tenantId IS NULL;  (conferir antes)
```
**Critério de saída da Fase 1:** `SUM(tenantId IS NULL) = 0` em **todas** as tabelas do conjunto a travar (exceto `notificationLogs`, que fica de fora).

---

## FASE 2 — Travar (staging), tabela por tabela

Para **cada** tabela do conjunto (gerar a partir da Fase 0). Padrão:
```sql
-- 1. NOT NULL (só depois de 0 nulls)
ALTER TABLE <tab> MODIFY COLUMN tenantId INT NOT NULL;
-- 2. FK para tenants(id) (cria índice automático no MySQL/InnoDB)
ALTER TABLE <tab> ADD CONSTRAINT fk_<tab>_tenant FOREIGN KEY (tenantId) REFERENCES tenants(id);
```
> **Fazer um ALTER por statement, não em pipe multi-statement** — e **validar cada tabela** logo após:
```sql
-- Confirma NOT NULL
SELECT TABLE_NAME, IS_NULLABLE FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME='tenantId' AND TABLE_NAME='<tab>';
-- Confirma a FK
SELECT CONSTRAINT_NAME, REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='<tab>' AND COLUMN_NAME='tenantId';
```
Cuidados: a FK exige (a) 0 NULLs (Fase 1), (b) nenhum `tenantId` órfão — todos devem existir em `tenants.id` (só há 1 e 2, ok), (c) InnoDB. Se alguma FK falhar, o erro aponta o órfão — corrigir e repetir só aquela.

**Recomendo fazer em lotes** (ex.: sub-tabelas de OS juntas), validando cada lote, em vez de um script gigante — se algo falhar, o estrago é localizado.

---

## FASE 3 — Rotação do `JWT_SECRET` (por último)

- Gera novo `JWT_SECRET`, atualiza o `.env` do staging, `pm2 restart soluteg-staging --update-env`.
- **Efeito: desloga todos** (admins/clientes/técnicos) — sessões antigas ficam inválidas. Em produção, fazer em **horário de baixo uso** e avisar. Em staging, tanto faz.
- Validar: um login novo funciona; um cookie antigo é rejeitado.

---

## FASE 4 — Produção (só depois do staging 100%)

1. **Backup obrigatório** (regra CLAUDE §5.4): `mysqldump --single-transaction --no-tablespaces ... > backup-pre-3.7.1f-<data>.sql`.
2. Repetir Fase 1 (backfill — produção terá **muito** NULL nas tabelas de volume: `waterTankMonitoring`, sub-OS, `clientDocuments`, `notificationLogs`-fica-de-fora).
3. Repetir Fase 2 (ALTERs) — validando cada tabela.
4. Fase 3 (JWT) em horário de baixo uso.
5. Registrar em `PENDENCIAS_DEPLOY_PRODUCAO.md` o que foi aplicado.

---

## Ao final
Atualizar `ROADMAP`/`CLAUDE`/`ARCHITECTURE_HANDOFF`: 3.7.1f concluída em staging (e depois produção). Com a 3.7.1f, o **isolamento multi-tenant está estruturalmente travado** — `tenantId` deixa de poder ser NULL e passa a ter integridade referencial garantida pelo banco.

> **Este documento é plano/revisão.** A execução real (Fase 2+) só depois de revisar o resultado da Fase 0 com o Thiago — a lista de tabelas e as exclusões de legado se decidem com os números na mão.
