# Pendências para Deploy em Produção — Multi-tenant

**Gerado em:** 2026-05-13  
**Contexto:** Durante a Fase 3.7.1a (multi-tenant), o diagnóstico do staging revelou
14 diferenças entre o banco de produção e o `schema.ts` atual. Todas foram validadas
como seguras no staging, mas **produção tem volumes maiores e deve ser validada
separadamente antes do deploy**.

> ⚠️ **NÃO executar os ALTER TABLE abaixo sem rodar as queries de pré-validação.**  
> Em produção há dados reais de clientes. Um ALTER que falha pode bloquear a tabela.

---

## Checklist de pré-deploy (rodar em produção antes do ALTER)

### PRÉ-VALIDAÇÃO 1 — Unique constraints

Verifica se os dados de produção têm duplicatas que impediriam a criação das constraints.
Se qualquer query retornar > 0, a constraint NÃO pode ser aplicada antes de corrigir os dados.

```sql
-- Duplicatas em budgets.budgetNumber?
SELECT budgetNumber, COUNT(*) AS total
FROM budgets
GROUP BY budgetNumber
HAVING COUNT(*) > 1;
-- Esperado: 0 linhas

-- Duplicatas em budgets.approvalToken?
SELECT approvalToken, COUNT(*) AS total
FROM budgets
WHERE approvalToken IS NOT NULL
GROUP BY approvalToken
HAVING COUNT(*) > 1;
-- Esperado: 0 linhas

-- Duplicatas em technicians.username?
SELECT username, COUNT(*) AS total
FROM technicians
GROUP BY username
HAVING COUNT(*) > 1;
-- Esperado: 0 linhas

-- Duplicatas em waterTankSensors.deviceId?
SELECT deviceId, COUNT(*) AS total
FROM waterTankSensors
GROUP BY deviceId
HAVING COUNT(*) > 1;
-- Esperado: 0 linhas
```

### PRÉ-VALIDAÇÃO 2 — Colunas que receberão NOT NULL

Verifica NULLs que impediriam o MODIFY COLUMN. Se qualquer valor for > 0,
é necessário um UPDATE para preencher os NULLs antes do ALTER.

```sql
SELECT
  (SELECT COUNT(*) FROM cashTransactions WHERE `type` IS NULL)    AS ct_type_nulos,
  (SELECT COUNT(*) FROM cashTransactions WHERE amount IS NULL)     AS ct_amount_nulos,
  (SELECT COUNT(*) FROM saleItems WHERE productName IS NULL)       AS si_nome_nulos,
  (SELECT COUNT(*) FROM saleItems WHERE unitPrice IS NULL)         AS si_preco_nulos,
  (SELECT COUNT(*) FROM saleItems WHERE subtotal IS NULL)          AS si_subtotal_nulos,
  (SELECT COUNT(*) FROM sales WHERE total IS NULL)                 AS sales_total_nulos;
-- Esperado: todos 0
```

### PRÉ-VALIDAÇÃO 3 — Tamanho das assinaturas digitais

Verifica se alguma assinatura ultrapassa o limite do tipo `text` (65.535 bytes).
No staging o maior valor é 38 KB. Em produção pode ter valores maiores.

```sql
SELECT
  COUNT(*)                                                               AS total_assinaturas,
  MAX(LENGTH(technicianSignature))                                       AS maior_bytes,
  SUM(CASE WHEN LENGTH(technicianSignature) > 65535 THEN 1 ELSE 0 END)  AS acima_do_limite
FROM workOrders
WHERE technicianSignature IS NOT NULL;
-- Se acima_do_limite > 0: NÃO aplicar mudança #6. Manter longtext no schema.
```

---

## As 14 mudanças a aplicar em produção

Após as pré-validações passarem, executar o script abaixo em produção
(banco `d5ea2e96_solutegdb`).

> **Recomendação:** executar fora do horário de pico (madrugada).
> Os ALTERs são rápidos (< 1 segundo cada), mas bloqueiam a tabela momentaneamente.

```sql
-- =============================================================
-- BLOCO 1 — Constraints UNIQUE (4)
-- Pré-requisito: PRÉ-VALIDAÇÃO 1 passou (zero duplicatas)
-- =============================================================

ALTER TABLE `budgets`
  ADD UNIQUE INDEX `budgets_budgetNumber_unique` (`budgetNumber`);

ALTER TABLE `budgets`
  ADD UNIQUE INDEX `budgets_approvalToken_unique` (`approvalToken`);

ALTER TABLE `technicians`
  ADD UNIQUE INDEX `technicians_username_unique` (`username`);

ALTER TABLE `waterTankSensors`
  ADD UNIQUE INDEX `waterTankSensors_deviceId_unique` (`deviceId`);


-- =============================================================
-- BLOCO 2 — Mudanças de tipo (2)
-- Pré-requisito: PRÉ-VALIDAÇÃO 3 passou (acima_do_limite = 0)
-- =============================================================

ALTER TABLE `budgets`
  MODIFY COLUMN `sharedWithPortal` INT NOT NULL DEFAULT 0;

ALTER TABLE `workOrders`
  MODIFY COLUMN `technicianSignature` TEXT;


-- =============================================================
-- BLOCO 3 — NOT NULL (6)
-- Pré-requisito: PRÉ-VALIDAÇÃO 2 passou (todos 0)
-- =============================================================

ALTER TABLE `cashTransactions`
  MODIFY COLUMN `type` ENUM('entrada', 'saida') NOT NULL;

ALTER TABLE `cashTransactions`
  MODIFY COLUMN `amount` DECIMAL(10, 2) NOT NULL;

ALTER TABLE `saleItems`
  MODIFY COLUMN `productName` VARCHAR(255) NOT NULL;

ALTER TABLE `saleItems`
  MODIFY COLUMN `unitPrice` DECIMAL(10, 2) NOT NULL;

ALTER TABLE `saleItems`
  MODIFY COLUMN `subtotal` DECIMAL(10, 2) NOT NULL;

ALTER TABLE `sales`
  MODIFY COLUMN `total` DECIMAL(10, 2) NOT NULL;


-- =============================================================
-- BLOCO 4 — Remover DEFAULT (2)
-- Sem pré-requisito de dados — apenas afeta inserts futuros
-- =============================================================

ALTER TABLE `waterTankAlertLog`
  MODIFY COLUMN `direction` ENUM('down', 'up') NOT NULL;

ALTER TABLE `waterTankAlertLog`
  MODIFY COLUMN `tankType` ENUM('superior', 'inferior') NOT NULL;
```

---

## Validação pós-aplicação em produção

```sql
-- Indexes criados?
SELECT INDEX_NAME, TABLE_NAME
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = 'd5ea2e96_solutegdb'
  AND INDEX_NAME IN (
    'budgets_budgetNumber_unique',
    'budgets_approvalToken_unique',
    'technicians_username_unique',
    'waterTankSensors_deviceId_unique'
  )
ORDER BY TABLE_NAME;
-- Esperado: 4 linhas

-- Tipos e NOT NULL corretos?
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'd5ea2e96_solutegdb'
  AND (
    (TABLE_NAME = 'budgets'           AND COLUMN_NAME = 'sharedWithPortal') OR
    (TABLE_NAME = 'workOrders'        AND COLUMN_NAME = 'technicianSignature') OR
    (TABLE_NAME = 'cashTransactions'  AND COLUMN_NAME IN ('type', 'amount')) OR
    (TABLE_NAME = 'saleItems'         AND COLUMN_NAME IN ('productName', 'unitPrice', 'subtotal')) OR
    (TABLE_NAME = 'sales'             AND COLUMN_NAME = 'total') OR
    (TABLE_NAME = 'waterTankAlertLog' AND COLUMN_NAME IN ('direction', 'tankType'))
  )
ORDER BY TABLE_NAME, COLUMN_NAME;
-- Esperado: IS_NULLABLE = 'NO' em todos os 10 itens dos blocos 2-4
```

---

## 3.7.1b — Tabelas multi-tenant + FKs e índices

### Pré-validação obrigatória em produção

```sql
-- 1. Confirmar que tabelas multi-tenant NÃO existem ainda
SELECT TABLE_NAME 
FROM information_schema.TABLES 
WHERE TABLE_SCHEMA = 'd5ea2e96_solutegdb' 
AND TABLE_NAME IN (
  'tenants', 'platformAdmins', 'gestors', 
  'condominiums', 'notificationContacts'
);
-- Esperado: 0 linhas (tabelas ainda não existem)

-- 2. Confirmar que tabelas de auditoria (3.7.1a) existem
SELECT TABLE_NAME, TABLE_COLLATION 
FROM information_schema.TABLES 
WHERE TABLE_SCHEMA = 'd5ea2e96_solutegdb' 
AND TABLE_NAME IN ('auditLog', 'loginAttempts', 'migrationAuditLog');
-- Esperado: 3 linhas (criadas pela 0032)
```

> ⚠️ **Backup completo do banco produção ANTES de aplicar qualquer migration.**

### Migrations a aplicar (NA ORDEM)

#### Passo 1 — Corrigir collation das tabelas de auditoria (0042)

Arquivo: `drizzle/migrations/0043_collation_fix_audit_tables.sql` (renomeado de `0042` para `0043` na sincronização master→multi-tenant de 03/08/2026, para não colidir com `0042_client_equipment.sql` vindo da master — ver `docs/RELATORIO_MERGE_MASTER_MULTITENANT.md` §6.1. Achado ao montar o `docs/RUNBOOK_CUTOVER_PRODUCAO.md`, 22/08/2026.)

```sql
ALTER TABLE `auditLog` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
ALTER TABLE `loginAttempts` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
ALTER TABLE `migrationAuditLog` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
```

> Pré-requisito: a migration 0032 (que cria essas 3 tabelas) já deve ter sido aplicada.

#### Passo 2 — Criar as 5 tabelas multi-tenant (0033)

Arquivo: `drizzle/0033_giant_tomorrow_man.sql`

> ⚠️ **IMPORTANTE:** O arquivo contém marcadores `"--> statement-breakpoint"` do Drizzle Kit 
> que devem ser filtrados antes de passar para o mysql CLI:
> 
> ```bash
> grep -v "statement-breakpoint" drizzle/0033_giant_tomorrow_man.sql | mysql -u USER -p DATABASE
> ```
> 
> **Atenção:** Quando aplicado via pipe, apenas os CREATE TABLE entram.
> As foreign keys e índices regulares NÃO são aplicados pelo pipe
> e precisam ser aplicados separadamente (passos 3 e 4).

#### Passo 3 — Aplicar manualmente os 4 ALTER TABLE de FOREIGN KEY

```sql
ALTER TABLE `condominiums` ADD CONSTRAINT `condominiums_tenantId_tenants_id_fk` 
  FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE `condominiums` ADD CONSTRAINT `condominiums_gestorId_gestors_id_fk` 
  FOREIGN KEY (`gestorId`) REFERENCES `gestors`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE `gestors` ADD CONSTRAINT `gestors_tenantId_tenants_id_fk` 
  FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE `notificationContacts` ADD CONSTRAINT `notificationContacts_condominiumId_condominiums_id_fk` 
  FOREIGN KEY (`condominiumId`) REFERENCES `condominiums`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
```

#### Passo 4 — Aplicar manualmente os 13 CREATE INDEX

```sql
-- condominiums (4 índices)
CREATE INDEX `condominiums_tenantId_idx` ON `condominiums` (`tenantId`);
CREATE INDEX `condominiums_gestorId_idx` ON `condominiums` (`gestorId`);
CREATE INDEX `condominiums_tenantId_name_idx` ON `condominiums` (`tenantId`,`name`);
CREATE INDEX `condominiums_active_idx` ON `condominiums` (`active`);

-- gestors (2 índices)
CREATE INDEX `gestors_tenantId_idx` ON `gestors` (`tenantId`);
CREATE INDEX `gestors_active_idx` ON `gestors` (`active`);

-- notificationContacts (2 índices)
CREATE INDEX `notificationContacts_condominiumId_idx` ON `notificationContacts` (`condominiumId`);
CREATE INDEX `notificationContacts_active_idx` ON `notificationContacts` (`active`);

-- platformAdmins (1 índice)
CREATE INDEX `platformAdmins_active_idx` ON `platformAdmins` (`active`);

-- tenants (1 índice — pode já ter entrado pelo pipe, verificar antes)
CREATE INDEX `tenants_active_idx` ON `tenants` (`active`);
```

> **Nota:** `tenants_active_idx` é o último statement do arquivo e pode ter sido 
> aplicado pelo pipe original. Verificar com:
> ```sql
> SHOW INDEX FROM tenants WHERE Key_name = 'tenants_active_idx';
> ```
> Se já existir, pular este CREATE INDEX.

### Validação pós-aplicação

```sql
-- 1. Confirma collation das 8 tabelas multi-tenant (todas utf8mb4_bin)
SELECT TABLE_NAME, TABLE_COLLATION 
FROM information_schema.TABLES 
WHERE TABLE_SCHEMA = 'd5ea2e96_solutegdb' 
AND TABLE_NAME IN (
  'auditLog', 'loginAttempts', 'migrationAuditLog',
  'tenants', 'platformAdmins', 'gestors', 
  'condominiums', 'notificationContacts'
)
ORDER BY TABLE_NAME;
-- Esperado: 8 linhas, todas com utf8mb4_bin

-- 2. Confirma que as 5 tabelas novas estão vazias
SELECT 
  (SELECT COUNT(*) FROM tenants) AS tenants,
  (SELECT COUNT(*) FROM platformAdmins) AS platformAdmins,
  (SELECT COUNT(*) FROM gestors) AS gestors,
  (SELECT COUNT(*) FROM condominiums) AS condominiums,
  (SELECT COUNT(*) FROM notificationContacts) AS notificationContacts;
-- Esperado: todos 0

-- 3. Confirma 4 FKs registradas
SELECT CONSTRAINT_NAME, TABLE_NAME, CONSTRAINT_TYPE
FROM information_schema.TABLE_CONSTRAINTS
WHERE TABLE_SCHEMA = 'd5ea2e96_solutegdb'
AND CONSTRAINT_TYPE = 'FOREIGN KEY'
AND TABLE_NAME IN ('condominiums', 'gestors', 'notificationContacts')
ORDER BY TABLE_NAME;
-- Esperado: 4 linhas

-- 4. Confirma índices nas 5 tabelas novas
SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = 'd5ea2e96_solutegdb'
AND TABLE_NAME IN ('tenants', 'platformAdmins', 'gestors', 'condominiums', 'notificationContacts')
ORDER BY TABLE_NAME, INDEX_NAME;
-- Esperado: 18 entradas (incluindo PKs e UNIQUEs)

-- 5. Confirma estrutura com FKs
SHOW CREATE TABLE condominiums\G

-- 6. Confirma dados existentes intactos
SELECT 
  (SELECT COUNT(*) FROM clients) AS clientes,
  (SELECT COUNT(*) FROM workOrders) AS ordens,
  (SELECT COUNT(*) FROM products) AS produtos;
-- Esperado: mesmos counts de antes da aplicação
```

---

---

## 3.7.1c — tenantId em tabelas existentes

### O que foi feito em staging

38 tabelas operacionais receberam `ADD COLUMN tenantId INT NULL` em staging via migration `drizzle/0034_wonderful_vulcan.sql`.

> ⚠️ **AVISO IMPORTANTE — método de aplicação:**
>
> O arquivo `0034_wonderful_vulcan.sql` foi gerado pelo Drizzle Kit com marcadores `--> statement-breakpoint` **inline** (na mesma linha do SQL, não em linha própria). Por isso, o método `grep -v "statement-breakpoint"` **NÃO funciona** neste arquivo — ele descartaria os statements inteiros junto com os marcadores.
>
> **Use `sed` em vez de `grep -v`:**
> ```bash
> sed 's|--> statement-breakpoint||g' drizzle/0034_wonderful_vulcan.sql | \
>   mysql -h 69.6.213.57 -u <user> -p <database>
> ```

### Pré-validação em produção

Confirmar que nenhuma das 38 tabelas já tem a coluna `tenantId`:

```sql
SELECT TABLE_NAME, COLUMN_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'd5ea2e96_solutegdb'
  AND COLUMN_NAME = 'tenantId'
  AND TABLE_NAME NOT IN ('gestors', 'condominiums', 'migrationAuditLog');
-- Esperado: 0 linhas (se > 0, a coluna já existe em algumas tabelas — pular essas no ALTER)
```

### Aplicação em produção

```bash
# Backup obrigatório antes
mysqldump -h 69.6.213.57 -u d5ea2e96_soluteg -p \
  --single-transaction --no-tablespaces \
  d5ea2e96_solutegdb > /var/backups/soluteg-producao/backup-pre-3.7.1c-$(date +%Y%m%d-%H%M%S).sql
chmod 600 /var/backups/soluteg-producao/backup-pre-3.7.1c-*.sql

# Aplicar migration com sed (não grep -v)
sed 's|--> statement-breakpoint||g' drizzle/0034_wonderful_vulcan.sql | \
  mysql -h 69.6.213.57 -u d5ea2e96_soluteg -p d5ea2e96_solutegdb
```

### Validação pós-aplicação

```sql
-- 1. Confirmar que a coluna tenantId existe nas 38 tabelas
SELECT TABLE_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'd5ea2e96_solutegdb'
  AND COLUMN_NAME = 'tenantId'
ORDER BY TABLE_NAME;
-- Esperado: 41 tabelas (38 da 3.7.1c + gestors + condominiums + migrationAuditLog)

-- 2. Confirmar tipo correto da coluna
SELECT TABLE_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'd5ea2e96_solutegdb'
  AND COLUMN_NAME = 'tenantId'
  AND TABLE_NAME IN ('clients', 'workOrders', 'budgets', 'technicians', 'products')
ORDER BY TABLE_NAME;
-- Esperado: COLUMN_TYPE = 'int', IS_NULLABLE = 'YES', COLUMN_DEFAULT = NULL

-- 3. Confirmar dados existentes intactos
SELECT
  (SELECT COUNT(*) FROM clients)    AS clientes,
  (SELECT COUNT(*) FROM workOrders) AS ordens,
  (SELECT COUNT(*) FROM products)   AS produtos;
-- Esperado: 29, 76, 270 (ou mais — produção pode ter crescido desde 18/05/2026)

-- 4. Confirmar que todos os tenantId são NULL (ainda não populados)
SELECT COUNT(*) AS com_tenant_preenchido FROM clients WHERE tenantId IS NOT NULL;
-- Esperado: 0 (será populado na sub-fase 3.7.1e)
```

---

## 3.7.2 — Isolamento de queries (código) + backfill de `tenantId` NULL

A sub-fase 3.7.2 é **código** (não ALTER de schema), mas gera duas pendências para produção:

1. **Deploy do código isolado.** Os routers isolados até aqui (`technicians`, `clients`, `workOrders`) e todas as correções associadas (rotas Express legadas, guardas fail-closed, carimbo de `tenantId` em todos os caminhos de criação de OS) só vão pra produção junto com o merge `multi-tenant → master`. Não replicar isoladamente.

2. **Backfill de `tenantId IS NULL` antes da 3.7.1f.** Descoberto no staging (14/08): a guarda fail-closed passou a exigir `tenantId` em toda criação de OS, mas **registros criados na janela entre a migração (`3.7.1e`) e o deploy da guarda podem ter `tenantId=NULL`** — no staging apareceu 1 OS órfã (vistoria mensal criada em teste). Em produção, rodar **imediatamente antes da 3.7.1f** (o passo que trava `NOT NULL`):

   ```sql
   -- Diagnóstico: quantos órfãos, por tabela (repetir para cada tabela operacional com tenantId)
   SELECT COUNT(*) FROM workOrders WHERE tenantId IS NULL;
   SELECT COUNT(*) FROM inspectionTasks WHERE tenantId IS NULL;
   SELECT COUNT(*) FROM checklistInstances WHERE tenantId IS NULL;
   -- ... clients, budgets, laudos, etc.

   -- Backfill (produção = 100% JNC = tenant 1):
   UPDATE workOrders SET tenantId = 1 WHERE tenantId IS NULL;
   UPDATE inspectionTasks    SET tenantId = 1 WHERE tenantId IS NULL;
   UPDATE checklistInstances SET tenantId = 1 WHERE tenantId IS NULL;
   -- Sub-tabelas de OS (nasciam SEM tenantId ate a leva do technicianPortal — provavel MUITO NULL em producao):
   UPDATE workOrderTasks        SET tenantId = 1 WHERE tenantId IS NULL;
   UPDATE workOrderMaterials    SET tenantId = 1 WHERE tenantId IS NULL;
   UPDATE workOrderAttachments  SET tenantId = 1 WHERE tenantId IS NULL;
   UPDATE workOrderComments     SET tenantId = 1 WHERE tenantId IS NULL;
   UPDATE workOrderTimeTracking SET tenantId = 1 WHERE tenantId IS NULL;
   -- Documentos:
   UPDATE clientDocuments SET tenantId = 1 WHERE tenantId IS NULL;
   -- Caixa d'agua (waterTankMonitoring tem MUITO volume — 1 linha por leitura):
   UPDATE waterTankSensors    SET tenantId = 1 WHERE tenantId IS NULL AND clientId IS NOT NULL; -- pendentes ficam null de proposito
   UPDATE waterTankMonitoring SET tenantId = 1 WHERE tenantId IS NULL;
   UPDATE waterTankAlertLog   SET tenantId = 1 WHERE tenantId IS NULL;
   UPDATE waterTankFaultLog   SET tenantId = 1 WHERE tenantId IS NULL;
   -- ... repetir para as demais tabelas operacionais que acusarem NULL
   ```
   A `3.7.1f` já prevê "garantir 0 nulls" antes do `ALTER ... NOT NULL` — este item é o lembrete concreto de que a origem dos NULLs é essa janela, não só dados legados. **Nota:** no staging (14/08) as tabelas de checklist (`inspectionTasks`, `checklistInstances`) deram **0 órfãos** — mas produção deve checar mesmo assim, pois a janela de exposição depende do momento do deploy.

---

## Status

| Mudança | Staging | Produção |
|---------|---------|----------|
| budgets_budgetNumber_unique | ✅ Aplicado | ⏳ Pendente |
| budgets_approvalToken_unique | ✅ Aplicado | ⏳ Pendente |
| technicians_username_unique | ✅ Aplicado | ⏳ Pendente |
| waterTankSensors_deviceId_unique | ✅ Aplicado | ⏳ Pendente |
| budgets.sharedWithPortal int | ✅ Aplicado | ⏳ Pendente |
| workOrders.technicianSignature text | ✅ Aplicado | ⏳ Pendente |
| cashTransactions.type NOT NULL | ✅ Aplicado | ⏳ Pendente |
| cashTransactions.amount NOT NULL | ✅ Aplicado | ⏳ Pendente |
| saleItems.productName NOT NULL | ✅ Aplicado | ⏳ Pendente |
| saleItems.unitPrice NOT NULL | ✅ Aplicado | ⏳ Pendente |
| saleItems.subtotal NOT NULL | ✅ Aplicado | ⏳ Pendente |
| sales.total NOT NULL | ✅ Aplicado | ⏳ Pendente |
| waterTankAlertLog.direction sem DEFAULT | ✅ Aplicado | ⏳ Pendente |
| waterTankAlertLog.tankType sem DEFAULT | ✅ Aplicado | ⏳ Pendente |
| **3.7.1b** collation fix auditoria (0042) | ✅ Aplicado | ⏳ Pendente |
| **3.7.1b** tabela tenants | ✅ Aplicado | ⏳ Pendente |
| **3.7.1b** tabela platformAdmins | ✅ Aplicado | ⏳ Pendente |
| **3.7.1b** tabela gestors | ✅ Aplicado | ⏳ Pendente |
| **3.7.1b** tabela condominiums | ✅ Aplicado | ⏳ Pendente |
| **3.7.1b** tabela notificationContacts | ✅ Aplicado | ⏳ Pendente |
| **3.7.1b** 4 FKs multi-tenant | ✅ Aplicado | ⏳ Pendente |
| **3.7.1b** 13 índices multi-tenant | ✅ Aplicado | ⏳ Pendente |
| **3.7.1c** tenantId em clients | ✅ Aplicado | ⏳ Pendente |
| **3.7.1c** tenantId em workOrders | ✅ Aplicado | ⏳ Pendente |
| **3.7.1c** tenantId em budgets | ✅ Aplicado | ⏳ Pendente |
| **3.7.1c** tenantId em technicians | ✅ Aplicado | ⏳ Pendente |
| **3.7.1c** tenantId em products/sales | ✅ Aplicado | ⏳ Pendente |
| **3.7.1c** tenantId em laudos | ✅ Aplicado | ⏳ Pendente |
| **3.7.1c** tenantId em waterTankSensors | ✅ Aplicado | ⏳ Pendente |
| **3.7.1c** tenantId em demais 31 tabelas | ✅ Aplicado | ⏳ Pendente |
