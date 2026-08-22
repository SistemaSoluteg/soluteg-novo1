# Runbook — Cutover de Produção (Fase 3.7 Multi-tenant)

> **Status:** ✅ **Fases 1–6 CONCLUÍDAS (22/08)** — merge oficializado (`54757d3`), backup feito, diagnóstico + 14 ajustes de schema legado aplicados, e **schema multi-tenant central completo em produção** (6a auditoria + 6b centrais + 6c `tenantId` nullable; validação final: 3 tabelas de auditoria + 41 colunas `tenantId`). **Próximo passo: Fase 7 (migração de dados).** ⚠️ **`deploy-app` continua PROIBIDO até a Fase 9** (ver aviso abaixo).
>
> ## 🚨 NÃO RODAR `deploy-app` ATÉ TERMINAR A FASE 9
> **A partir de agora, `master` tem o código do isolamento multi-tenant** (resolve `ctx.tenantId` em todo request, routers filtram por `tenantId`). **O banco de produção ainda não tem nenhuma coluna/tabela desse schema** (isso só acontece nas Fases 5-7 abaixo). **Se `deploy-app` rodar antes da Fase 7 (migração de dados) estar completa, a produção inteira provavelmente cai** — toda criação de contexto tRPC (login, qualquer chamada autenticada) tende a falhar tentando ler uma coluna `tenantId` que não existe. Isso quebra o reflexo automático de "commit → push → deploy" — **de propósito, até o cutover estar pronto pra ser executado por completo.**
> **Criado:** 22/08/2026, pela Claude "arquiteta" (foco segurança), a pedido do Thiago.
> **Objetivo:** ser o roteiro único e sequenciado do cutover de produção — hoje esse trabalho está espalhado em `PENDENCIAS_DEPLOY_PRODUCAO.md`, `PLANO_3.7.1f.md` e o histórico do `ROADMAP.md`. Este documento não substitui os outros três (eles continuam com o detalhe de cada SQL) — ele é a **ordem de execução + os pontos de validação entre um passo e outro**.
> **Escopo:** só a **produção**. Staging (`tst.soluteg.com.br`) já está com 3.7.1a–e, 3.7.2 e 3.7.1f validadas.

---

## Papéis (quem faz o quê)

| Símbolo | Quem | Faz o quê |
|---|---|---|
| 🗂️ | **Claude arquiteta** | Planeja, escreve SQL/checklists, revisa resultado, atualiza documentação. Não toca em código nem em VPS/banco. |
| 💻 | **Claude Code (VS Code)** | Executa mudança de código a partir de um prompt da arquiteta. Roda só localmente/no repo — não tem acesso a VPS nem banco de produção. |
| 🔧 | **Thiago** | Único com acesso a VPS (SSH) e banco (DBeaver). Roda todo SQL/comando de produção e traz o resultado de volta pra validarmos juntos. |

**Regra de ouro deste runbook:** nenhuma fase começa sem a anterior estar validada. Se uma validação falhar, paramos e decidimos juntos — não seguimos "torcendo para dar certo".

---

## 1. Achados críticos — decisões tomadas em 22/08/2026

Revisei os 4 scripts de migração (`scripts/migrate-to-multi-tenant.ts`, `scripts/backfill-tenant-null.ts`, `scripts/lock-tenant-not-null-fk.ts`, `scripts/diagnostico-3.7.1f-fase0.ts`) e as migrations envolvidas. Achei 4 problemas que, se ignorados, ou impedem o cutover de rodar, ou **reproduzem em produção bugs que já apareceram e foram corrigidos em staging**. As decisões abaixo já foram tomadas com o Thiago — falta só a execução (Fase 1, 💻 Claude Code).

### 1.1 — Os 4 scripts recusam produção de propósito
Todos chamam `assertStagingEnvironment()` (`server/lib/environment.ts:25`), que **lança erro imediatamente** se `DB_NAME` for o de produção (`d5ea2e96_solutegdb`). Isso é uma trava de segurança deliberada — mas significa que nenhum dos 4 scripts roda contra produção do jeito que está hoje. Já existe `assertProductionEnvironment()` pronta no mesmo arquivo, feita exatamente pra esse caso ("scripts de deploy formal que só devem tocar em produção").

**✅ Decisão (22/08):** cópia dedicada para cada script — `*-producao.ts` ao lado do original, chamando `assertProductionEnvironment()` no lugar de `assertStagingEnvironment()`. Mais explícito que uma flag (o nome do arquivo já avisa "isso aqui mexe em produção") e evita o risco de esquecer a flag numa execução manual às 2h da manhã. O trade-off (duas cópias podem divergir com o tempo) é aceitável porque esses scripts são de uso único (cutover) — depois de rodados em produção, não voltam a ser tocados.

### 1.2 — `scripts/lock-tenant-not-null-fk.ts` está desatualizado (reproduziria o LOCK-02)
A lista `TABELAS` do script (commit `23aec7c`, 19/08) **ainda inclui `waterTankSensors`**. Só que no dia seguinte (20/08), o achado `LOCK-02` mostrou que travar essa tabela com `NOT NULL` quebra **100% da ingestão MQTT** (`upsertSensorDevice()` faz `INSERT...ON DUPLICATE KEY UPDATE` sem carimbar `tenantId`) — foi revertida manualmente em staging, mas o script no repo nunca foi atualizado pra refletir isso. **Se rodarmos este script como está contra produção, reproduzimos o mesmo apagão de sensores que já tivemos em staging.** Precisa remover `waterTankSensors` da lista (mesma categoria do `notificationLogs`/NOTIF-01) antes de cogitar usá-lo em produção.

### 1.3 — A migration `0032` mistura tabelas novas com tabelas que produção já deve ter
`drizzle/0032_illegal_shinobi_shaw.sql` (a migration da sub-fase 3.7.1a) cria **8 tabelas**, não só as 3 de auditoria:
```
auditLog, laudoCitacoes, laudoTipos, loginAttempts,
migrationAuditLog, normaTrechos, notificationLogs, pushSubscriptions
```
As 3 primeiras (bold) são realmente novas para produção. Mas `laudoCitacoes`, `laudoTipos`, `normaTrechos`, `notificationLogs` e `pushSubscriptions` são de features que **já parecem estar em produção** (laudos com citações normativas, push notifications — Fase 3.6 "infra pronta"), só que chegaram lá por outro caminho de migration, não por este arquivo squashado que o merge da branch `multi-tenant` gerou. **Rodar o arquivo `0032` inteiro em produção provavelmente falha** (`CREATE TABLE` em tabela que já existe) e, pior, se alguém "resolver" isso rodando statement por statement sem checar, corre o risco de recriar uma tabela que já tem dados. A Fase 4 deste runbook (diagnóstico) trata isso explicitamente: checar tabela por tabela antes de aplicar qualquer `CREATE TABLE`.

### 1.4 — Referência de arquivo desatualizada no `PENDENCIAS_DEPLOY_PRODUCAO.md`
Esse documento (seção 3.7.1b, "Passo 1") apontava para `drizzle/migrations/0042_collation_fix_audit_tables.sql` — mas esse arquivo foi **renomeado para `0043_collation_fix_audit_tables.sql`** durante a sincronização master→multi-tenant de 03/08/2026 (colidia com `0042_client_equipment.sql`, que veio da master). **✅ Corrigido** direto no `PENDENCIAS_DEPLOY_PRODUCAO.md` em 22/08.

### 1.5 — LOCK-01 (`admins`/`auditLog`/`invites`/`inspectionReports`): travar mesmo com writer morto — ✅ decisão confirmada (22/08)
Verifiquei via `grep` em todo o `server/` (branch `multi-tenant`) se `createAdmin`, `createInvite`/`acceptInvite`, `createInspectionReport` ou qualquer escrita em `auditLog` têm algum chamador fora do próprio `server/db.ts` — **zero resultados**. Os 4 escritores estão mesmo mortos hoje.

**Decisão:** travar as 4 com `NOT NULL` + FK no cutover, igual staging. Razão: uma coluna `tenantId` nullable é um convite silencioso a bug — quando alguém construir a UI de criar admin (3.7.4), o fluxo de convite (3.7.6) ou o registro de auditoria (3.7.7) e esquecer de carimbar `tenantId`, o `NOT NULL` faz o `INSERT` falhar **na hora**, não meses depois como um vazamento cross-tenant descoberto por acidente. Custo de travar agora: zero (nada escreve nessas tabelas hoje; as linhas existentes de `admins`/`invites`/`inspectionReports` já são cobertas pelo backfill padrão da Fase 7, igual as outras 38 tabelas).

**Único risco residual:** um caminho de escrita que esse `grep` não pegou (script solto, endpoint REST esquecido). Mitigação: repetir a mesma verificação (Fase 4, item 4.5 abaixo) contra o código **final mergeado** (`multi-tenant → master`) que efetivamente vai pra produção, não só contra o snapshot de hoje.

**Nenhum desses 5 pontos bloqueia a gente de aprovar o *formato* do runbook agora — mas todos bloqueiam a Fase 1 (preparação de código). Trato isso na seção 3.

---

## 2. Visão geral das fases

```
Fase 1  💻  Preparar código (corrigir scripts, adaptar p/ produção, merge multi-tenant→master)
Fase 2  🗂️🔧 Escolher janela + avisar
Fase 3  🔧  Backup completo do banco de produção
Fase 4  🔧  Diagnóstico do estado atual de produção (read-only, sem alterar nada)
Fase 5  🔧  Aplicar os 14 ajustes de schema legado (dívida pré-multi-tenant)
Fase 6  🔧  Schema multi-tenant central (3.7.1a + 3.7.1b + 3.7.1c)
Fase 7  🔧  Migração de dados (criar tenants + platformAdmin + carimbar tenantId=1)
Fase 8  🔧  Deploy do código (ativa o isolamento por tenant em produção)
Fase 9  🔧  Backfill de órfãos pós-deploy
Fase 10 🔧  Travamento NOT NULL + FK (3.7.1f)
Fase 11 🔧  Rotação do JWT_SECRET
Fase 12 🗂️🔧 Validação final (smoke tests)
Fase 13 🗂️  Atualizar documentação
```

Cada fase abaixo: **o que faz**, **quem faz**, **pré-condição**, **validação antes de seguir**, **como reverter**.

---

## 3. Fase 1 — Preparar o código 💻

**Pré-condição:** nenhuma — todas as decisões da seção 1 já foram tomadas (22/08).

- [x] ~~1.0 Decisões de abordagem (achados 1.1–1.5)~~ ✅ confirmadas com o Thiago em 22/08
- [x] ~~1.1 Criar `scripts/lock-tenant-not-null-fk-producao.ts`~~ ✅ **feito (22/08, commit `c575987`)** — `waterTankSensors` removida da lista `TABELAS`, comentário com referência ao LOCK-02. Original intocado (`git diff` confirmado pelo Claude Code).
- [x] ~~1.2 Criar os outros 3 scripts `-producao.ts`~~ ✅ **feito (22/08, commit `c575987`)** — `migrate-to-multi-tenant-producao.ts`, `backfill-tenant-null-producao.ts`, `diagnostico-3.7.1f-fase0-producao.ts`. Originais e `server/lib/environment.ts` intocados.
- [x] ~~1.3 Reverificar o LOCK-01 (achado 1.5)~~ ✅ **feito (22/08)** — zero chamadores de `createAdmin`/`createInvite`/`acceptInvite`/`createInspectionReport`/`auditLog` fora de `server/db.ts` em todo o repo (não só `server/`). Confirma o achado original. **Repetir mais uma vez no item 4.5, contra o código já mergeado** — o código pode mudar entre agora e o merge de 1.4.
- [x] ~~1.4 Validar o merge `master → multi-tenant` num branch de teste~~ ✅ **feito (22/08)** — branch `test/sync-master-cutover` (a partir de `origin/multi-tenant` em `01c39a7`), `git merge origin/master` (9 commits, todos upload/diagnóstico Cloudinary) **sem nenhum conflito** (auto-merge em `server/index.ts` e `src/pages/AdminBudgetDetail.tsx`, nada em `server/routers/*`/`drizzle/schema.ts`/`server/db.ts`). `pnpm install` limpo (lockfile não mudou). Branch de teste preservada, nada pushado pros branches reais.
- [x] ~~1.4b — Oficializar o merge de verdade~~ ✅ **feito (22/08)** — `multi-tenant` sincronizado com `master` (`24ee6d1..54757d3`, zero conflito, igual à validação); `multi-tenant → master` foi **fast-forward puro** (`49099ed..54757d3`, exatamente como previsto, sem commit de merge). Ambos os branches, local e remoto, apontam pro mesmo commit `54757d3`. `test/sync-master-cutover` preservado intocado.
- [x] ~~1.5 `pnpm run build` local~~ ✅ **feito** (validado junto do item 1.4, exit 0).

**Validação (1.1-1.3):** ✅ passou — `pnpm run check` (`tsc`) em 32 erros, igual ao baseline, nenhum nos 4 arquivos novos; `pnpm run build` exit 0. (Nota: precisou de `pnpm install` antes — faltava `vite-plugin-pwa` no `node_modules`, causa raiz de um erro que travava o `check` inteiro; não relacionado aos scripts novos, resolvido.)
**Validação (1.4):** ✅ passou — build limpo, `tsc` idêntico byte a byte ao baseline (32 erros, mesmo conjunto exato de arquivo+linha+mensagem), LOCK-01 reverificado pós-merge (zero chamadores). Nada bloqueando o merge real.
**Reversão:** é só código, ainda não tocou em VPS/banco — descartar a branch de teste se algo não fechar.

---

## 4. Fase 2 — Janela de execução 🗂️🔧 ✅ CONCLUÍDA (22/08)

- [x] ~~Decidir se avisa os clientes~~ ✅ Sim — **aviso já enviado pelo Thiago (22/08)**.
- [x] ~~Escolher horário/momento de execução~~ ✅ Thiago confirmou pra seguir agora.
- [x] ~~Ter tempo pra rodar numa sentada~~ ✅ Presumido pelo "podemos dar continuidade" — se em algum momento precisar pausar no meio, avisar explicitamente (o banco pode ficar em estado intermediário entre fases).

---

## 5. Fase 3 — Backup 🔧 ✅ CONCLUÍDA (22/08)

```bash
mysqldump -h 69.6.213.57 -u d5ea2e96_soluteg -p \
  --routines --triggers --single-transaction --no-tablespaces \
  d5ea2e96_solutegdb > /var/backups/soluteg-producao/backup-pre-cutover-$(date +%Y%m%d-%H%M%S).sql
chmod 600 /var/backups/soluteg-producao/backup-pre-cutover-*.sql
```
**Arquivo:** `/var/backups/soluteg-producao/backup-pre-cutover-20260822-144218.sql` — **22M**, permissão `600`, `-- Dump completed on 2026-08-22 14:42:45` confirmado (não truncado), 45 `CREATE TABLE`.
**Validação:** ✅ passou — arquivo íntegro, chmod aplicado, lixo de 0 bytes das tentativas com senha errada removido.
**Reversão:** este backup é o ponto de restauração de tudo o que vem depois — se algo der muito errado em qualquer fase futura, é `mysql < backup-pre-cutover-20260822-144218.sql`.

---

## 6. Fase 4 — Diagnóstico do estado atual de produção 🔧 (read-only) ✅ CONCLUÍDA (22/08)

**Resultado:**
- **4.1:** `laudoCitacoes`/`laudoTipos`/`normaTrechos`/`notificationLogs`/`pushSubscriptions` já existem (confirma a hipótese); `auditLog`/`loginAttempts`/`migrationAuditLog` **não existem** — só essas 3 entram na Fase 6.
- **4.2:** 0 linhas — nenhuma tabela central multi-tenant existe ainda.
- **4.3:** 0 linhas — nenhuma tabela tem `tenantId` ainda.
- **4.4:** `client_equipment` existe, colunas `clientId/createdAt/description/id/type` — sem `tenantId`, confirmado.
- **Pré-validações do legado (1-3):** zero duplicata em `budgetNumber`/`approvalToken`/`username`/`deviceId`; zero NULL nas 6 colunas que viram NOT NULL; 65 assinaturas, maior com 38.299 bytes (limite é 65.535) — **nada bloqueando a Fase 5**.
- **4.5 (reverificação LOCK-01):** já coberta pela checagem pós-merge da Fase 1.4 (feita contra o mesmo código que está em produção agora — `master`/`multi-tenant` não mudaram desde então, só docs) — zero chamadores, sem necessidade de repetir.

Objetivo original: **nunca assumir** que uma tabela/coluna não existe — confirmar. Isso substitui a Fase 0 do `PLANO_3.7.1f.md` (que foi escrita pensando em staging, onde o histórico já era conhecido) por uma versão que desconfia de tudo, já que produção não passou pelas sub-fases incrementais.

```sql
-- 4.1 — Quais das 8 tabelas do 0032 já existem?
SELECT TABLE_NAME FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'd5ea2e96_solutegdb'
AND TABLE_NAME IN ('auditLog','laudoCitacoes','laudoTipos','loginAttempts',
                    'migrationAuditLog','normaTrechos','notificationLogs','pushSubscriptions');
-- Esperado (hipótese a confirmar): laudoCitacoes/laudoTipos/normaTrechos/notificationLogs/pushSubscriptions
-- JÁ existem (vieram por outro caminho); auditLog/loginAttempts/migrationAuditLog NÃO existem ainda.

-- 4.2 — Tabelas centrais multi-tenant (3.7.1b) já existem?
SELECT TABLE_NAME FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'd5ea2e96_solutegdb'
AND TABLE_NAME IN ('tenants','platformAdmins','gestors','condominiums','notificationContacts');
-- Esperado: 0 linhas

-- 4.3 — Alguma tabela já tem coluna tenantId?
SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'd5ea2e96_solutegdb' AND COLUMN_NAME = 'tenantId';
-- Esperado: 0 linhas

-- 4.4 — client_equipment existe e tem tenantId? (não deveria ter)
SELECT COLUMN_NAME FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'd5ea2e96_solutegdb' AND TABLE_NAME = 'client_equipment';
```

**4.5 — Reverificação do LOCK-01 (achado 1.5):** contra o código do merge final (`multi-tenant → master`, resultado da Fase 1.4), confirmar de novo que `createAdmin`, `createInvite`/`acceptInvite`, `createInspectionReport` e qualquer escrita em `auditLog` não têm chamador fora de `server/db.ts`. Se algum aparecer (por exemplo, algo que a `master` trouxe e o merge não tinha antes), **parar e decidir com a arquiteta** se essa tabela também vai pro NOT NULL ou fica de fora — não travar às cegas.

Rodar também as 3 pré-validações do legado (duplicatas em `budgetNumber`/`approvalToken`/`username`/`deviceId`, NULLs em `cashTransactions`/`saleItems`/`sales`, tamanho de `technicianSignature`) — SQL completo em [`PENDENCIAS_DEPLOY_PRODUCAO.md`](../PENDENCIAS_DEPLOY_PRODUCAO.md) seção "Checklist de pré-deploy".

**Validação:** os resultados de 4.1–4.4 definem exatamente o que falta aplicar nas Fases 5–6 (e se as 3 pré-validações do legado acusarem algo > 0, paramos e corrigimos os dados antes de seguir).
**Reversão:** não aplicável — é só leitura.

---

## 7. Fase 5 — Os 14 ajustes de schema legado 🔧 ✅ CONCLUÍDA (22/08)

- Bloco 1 (4 UNIQUE): `budgets.budgetNumber`, `budgets.approvalToken`, `technicians.username`, `waterTankSensors.deviceId` — ✅ os 4 índices criados (avisos de "duplicate index" no MySQL, inofensivos — só significa que já havia um índice não-único nas mesmas colunas antes; não bloqueia nem tem risco).
- Bloco 2 (2 tipos): `budgets.sharedWithPortal` → INT NOT NULL DEFAULT 0 ✅; `workOrders.technicianSignature` → TEXT, permanece nullable (correto, nem toda OS tem assinatura) ✅
- Bloco 3 (6 NOT NULL): `cashTransactions.type/amount`, `saleItems.productName/unitPrice/subtotal`, `sales.total` — ✅ todos `NOT NULL`
- Bloco 4 (2 sem DEFAULT): `waterTankAlertLog.direction/tankType` — ✅ todos `NOT NULL`

**Validação:** ✅ passou — os 4 índices confirmados via `information_schema.STATISTICS`, os 10 campos dos blocos 2-4 com `IS_NULLABLE` exatamente como esperado (9× `NO`, `technicianSignature` `YES` de propósito).
**Reversão:** restaurar do backup da Fase 3 (são ALTERs simples, reversão manual também é viável se for só 1-2 tabelas).

---

## 8. Fase 6 — Schema multi-tenant central 🔧 ✅ CONCLUÍDA (22/08)

> **Resultado (22/08):** as 3 sub-fases aplicadas e validadas em produção. Validação final: 3 tabelas de auditoria + **41 colunas `tenantId`** (38 operacionais + `gestors` + `condominiums` + `auditLog`), 5 tabelas centrais `utf8mb4_bin`, 4 FKs, 20 índices nas centrais. **Percalços registrados abaixo (lições pro futuro), todos resolvidos.**
>
> ### Incidentes durante a execução (todos corrigidos)
> 1. **DBeaver quebrou a `CREATE TABLE tenants` no `#`.** O default `primaryColor ... DEFAULT '#D4A84B'` tem um `#`, que é caractere de comentário no MySQL. O splitter de statements do DBeaver (rodando o script inteiro) tratou `#D4A84B',` como comentário e cortou a `CREATE TABLE` no meio → `tenants` não foi criada, e em cascata as 2 FKs que apontam pra ela (`condominiums→tenants`, `gestors→tenants`) e o índice `tenants_active_idx` também falharam. **Correção:** rodar a `CREATE TABLE tenants` **isolada** (Ctrl+Enter — execução de statement único não passa pelo splitter), depois as 2 FKs + o índice manualmente. **Lição:** qualquer statement com `#` (ou outro caractere que o cliente trate como comentário) dentro de string deve ser rodado isolado, nunca no meio de um script grande.
> 2. **DBeaver estava no modo "Record"** (mostra 1 linha por vez, transposta como "Row #1"), o que escondeu resultados de várias linhas e dificultou o diagnóstico. **Lição:** validar sempre no modo **Grid**, ou usar `GROUP_CONCAT`/`COUNT(*)` pra colapsar o resultado numa célula/valor único.
> 3. **A Fase 6a tinha ficado pra trás.** A execução pulou direto pro 6b/6c; as 3 tabelas de auditoria não existiam ainda (a 6a estava preparada no runbook, mas não fora rodada — não há commit "fecha Fase 6a"). Como as tabelas de auditoria são independentes das centrais e das colunas operacionais, rodar fora de ordem não quebrou nada; a 6a foi aplicada por último e fechou o total em 41. **Lição:** conferir a ordem 6a→6b→6c pelo estado real do banco (query de existência), não pelo que "deveria" ter rodado.

> **Achado 22/08 (durante a preparação desta fase):** o arquivo `drizzle/0032_illegal_shinobi_shaw.sql` (que criou as 8 tabelas do achado 1.3) **também tem `ALTER TABLE` em colunas de `laudos`/`laudoFotos`/`waterTankAlertLog`/`waterTankSensors`** que já existem em produção. **Confirmado via diagnóstico** (22/08): as 10 colunas (`laudos.tipo_id`; `laudoFotos.url_anotada/url_recorte/modo_layout/anotacoes_json`; `waterTankAlertLog.delivered/deliveryError/osId`; `waterTankSensors.alarm3BoiaEnabled/technicianId`) **já existem** em produção. **Por isso o SQL abaixo (6a) NÃO é o arquivo `0032` inteiro** — é só os 3 `CREATE TABLE` + os 11 índices relacionados às tabelas de auditoria, extraídos manualmente. **Não rodar o arquivo `0032` original diretamente.**

**6a — Tabelas de auditoria (3.7.1a) — SQL pronto pra copiar:**

```sql
-- 3 CREATE TABLE (extraídos de drizzle/0032_illegal_shinobi_shaw.sql, só o que falta)
CREATE TABLE `auditLog` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`actorType` varchar(30) NOT NULL,
	`actorId` int,
	`actorName` varchar(200),
	`action` varchar(100) NOT NULL,
	`resourceType` varchar(50),
	`resourceId` varchar(100),
	`tenantId` int,
	`ipAddress` varchar(45),
	`userAgent` text,
	`details` text,
	`success` tinyint NOT NULL DEFAULT 1,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `auditLog_id` PRIMARY KEY(`id`)
);

CREATE TABLE `loginAttempts` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`userType` varchar(30) NOT NULL,
	`identifier` varchar(200) NOT NULL,
	`ipAddress` varchar(45) NOT NULL,
	`userAgent` text,
	`success` tinyint NOT NULL,
	`failureReason` varchar(100),
	`attemptedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `loginAttempts_id` PRIMARY KEY(`id`)
);

CREATE TABLE `migrationAuditLog` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`migrationName` varchar(200) NOT NULL,
	`step` varchar(100) NOT NULL,
	`sourceType` varchar(50),
	`sourceId` varchar(100),
	`targetType` varchar(50),
	`targetId` varchar(100),
	`status` varchar(20) NOT NULL,
	`details` text,
	`errorMessage` text,
	`executedBy` varchar(100),
	`executedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `migrationAuditLog_id` PRIMARY KEY(`id`)
);

-- 11 índices relacionados (também extraídos do 0032)
CREATE INDEX `audit_actor_idx` ON `auditLog` (`actorType`,`actorId`);
CREATE INDEX `audit_action_idx` ON `auditLog` (`action`);
CREATE INDEX `audit_resource_idx` ON `auditLog` (`resourceType`,`resourceId`);
CREATE INDEX `audit_tenant_idx` ON `auditLog` (`tenantId`);
CREATE INDEX `audit_created_idx` ON `auditLog` (`createdAt`);
CREATE INDEX `login_identifier_idx` ON `loginAttempts` (`identifier`);
CREATE INDEX `login_ip_idx` ON `loginAttempts` (`ipAddress`);
CREATE INDEX `login_attempted_idx` ON `loginAttempts` (`attemptedAt`);
CREATE INDEX `migaudit_migration_idx` ON `migrationAuditLog` (`migrationName`);
CREATE INDEX `migaudit_source_idx` ON `migrationAuditLog` (`sourceType`,`sourceId`);
CREATE INDEX `migaudit_target_idx` ON `migrationAuditLog` (`targetType`,`targetId`);

-- Fix de collation (drizzle/migrations/0043_collation_fix_audit_tables.sql — número corrigido, achado 1.4)
ALTER TABLE `auditLog` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
ALTER TABLE `loginAttempts` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
ALTER TABLE `migrationAuditLog` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
```

**Validação do 6a:**
```sql
SELECT TABLE_NAME, TABLE_COLLATION FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'd5ea2e96_solutegdb' AND TABLE_NAME IN ('auditLog','loginAttempts','migrationAuditLog');
-- Esperado: 3 linhas, TABLE_COLLATION = utf8mb4_bin em todas

SELECT TABLE_NAME, COUNT(*) AS num_indices FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = 'd5ea2e96_solutegdb' AND TABLE_NAME IN ('auditLog','loginAttempts','migrationAuditLog')
GROUP BY TABLE_NAME;
-- Esperado: auditLog ~6 (PK + 5 índices), loginAttempts ~4 (PK + 3), migrationAuditLog ~4 (PK + 3)
```

> **Como rodar (6b e 6c):** SQL cru, pra colar no **DBeaver** (multi-statement confiável). **Não** usar `sed | mysql` — o `CLAUDE.md §5.5` avisa que FK e índices pós-`CREATE TABLE` somem silenciosamente no pipe do CLI; colar direto no DBeaver elimina esse risco. As 5 `CREATE TABLE` do `0033` **já nascem `COLLATE=utf8mb4_bin`** na própria definição, então **a 6b NÃO precisa de `CONVERT TO CHARACTER SET`** — o `0043` (fix de collation) era só das 3 tabelas de auditoria e já foi aplicado na Fase 6a.

---

### 6b — Tabelas centrais multi-tenant (3.7.1b)

**Pré-validação (esperado: 0 linhas — nenhuma das 5 existe ainda; confirma o diagnóstico 4.2):**
```sql
SELECT TABLE_NAME FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'd5ea2e96_solutegdb'
AND TABLE_NAME IN ('tenants','platformAdmins','gestors','condominiums','notificationContacts');
```

**SQL (extraído de `drizzle/0033_giant_tomorrow_man.sql` — 5 CREATE TABLE + 4 FK + 10 CREATE INDEX, na ordem):**
```sql
-- ── 5 tabelas (já com COLLATE=utf8mb4_bin embutido) ──
CREATE TABLE `tenants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(200) NOT NULL,
	`slug` varchar(100) NOT NULL,
	`isPlatformTenant` tinyint NOT NULL DEFAULT 0,
	`logoUrl` varchar(500),
	`primaryColor` varchar(7) NOT NULL DEFAULT '#D4A84B',
	`whatsappNumber` varchar(30),
	`contactEmail` varchar(200),
	`cnpj` varchar(18),
	`address` text,
	`city` varchar(100),
	`state` varchar(2),
	`active` tinyint NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tenants_id` PRIMARY KEY(`id`),
	CONSTRAINT `tenants_slug_unique` UNIQUE(`slug`)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `platformAdmins` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(200) NOT NULL,
	`email` varchar(200) NOT NULL,
	`passwordHash` varchar(255) NOT NULL,
	`active` tinyint NOT NULL DEFAULT 1,
	`lastLoginAt` timestamp,
	`mustResetPassword` tinyint NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `platformAdmins_id` PRIMARY KEY(`id`),
	CONSTRAINT `platformAdmins_email_unique` UNIQUE(`email`)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `gestors` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`name` varchar(200) NOT NULL,
	`email` varchar(200),
	`whatsapp` varchar(30),
	`username` varchar(100) NOT NULL,
	`passwordHash` varchar(255) NOT NULL,
	`role` varchar(40) NOT NULL DEFAULT 'sindico',
	`active` tinyint NOT NULL DEFAULT 1,
	`mustResetPassword` tinyint NOT NULL DEFAULT 1,
	`lastLoginAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gestors_id` PRIMARY KEY(`id`),
	CONSTRAINT `gestors_tenantId_username_unique` UNIQUE(`tenantId`,`username`)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `condominiums` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`gestorId` int,
	`name` varchar(200) NOT NULL,
	`address` text,
	`city` varchar(100),
	`state` varchar(2),
	`zipCode` varchar(10),
	`units` int,
	`active` tinyint NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `condominiums_id` PRIMARY KEY(`id`)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `notificationContacts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`condominiumId` int NOT NULL,
	`name` varchar(200) NOT NULL,
	`whatsapp` varchar(30) NOT NULL,
	`email` varchar(200),
	`role` varchar(100),
	`active` tinyint NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `notificationContacts_id` PRIMARY KEY(`id`)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- ── 4 foreign keys (todas as 5 tabelas já existem neste ponto) ──
ALTER TABLE `condominiums` ADD CONSTRAINT `condominiums_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `condominiums` ADD CONSTRAINT `condominiums_gestorId_gestors_id_fk` FOREIGN KEY (`gestorId`) REFERENCES `gestors`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `gestors` ADD CONSTRAINT `gestors_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `notificationContacts` ADD CONSTRAINT `notificationContacts_condominiumId_condominiums_id_fk` FOREIGN KEY (`condominiumId`) REFERENCES `condominiums`(`id`) ON DELETE no action ON UPDATE no action;

-- ── 10 índices (os outros 3 pra fechar 13 já são UNIQUE/PK dentro das CREATE TABLE) ──
CREATE INDEX `condominiums_tenantId_idx` ON `condominiums` (`tenantId`);
CREATE INDEX `condominiums_gestorId_idx` ON `condominiums` (`gestorId`);
CREATE INDEX `condominiums_tenantId_name_idx` ON `condominiums` (`tenantId`,`name`);
CREATE INDEX `condominiums_active_idx` ON `condominiums` (`active`);
CREATE INDEX `gestors_tenantId_idx` ON `gestors` (`tenantId`);
CREATE INDEX `gestors_active_idx` ON `gestors` (`active`);
CREATE INDEX `notificationContacts_condominiumId_idx` ON `notificationContacts` (`condominiumId`);
CREATE INDEX `notificationContacts_active_idx` ON `notificationContacts` (`active`);
CREATE INDEX `platformAdmins_active_idx` ON `platformAdmins` (`active`);
CREATE INDEX `tenants_active_idx` ON `tenants` (`active`);
```
> **Só 10 `CREATE INDEX` acima** (não 13): os outros 3 índices "que faltam" pra fechar 13 são as constraints `UNIQUE`/`PRIMARY` já criadas dentro das `CREATE TABLE` (`tenants_slug_unique`, `platformAdmins_email_unique`, `gestors_tenantId_username_unique`) — não precisam de `CREATE INDEX` separado. A validação pós conta 18 entradas em `STATISTICS` (PKs + UNIQUEs + estes 10).

**Validação do 6b:**
```sql
-- (a) 5 tabelas criadas, todas utf8mb4_bin
SELECT TABLE_NAME, TABLE_COLLATION FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'd5ea2e96_solutegdb'
AND TABLE_NAME IN ('tenants','platformAdmins','gestors','condominiums','notificationContacts')
ORDER BY TABLE_NAME;
-- Esperado: 5 linhas, TABLE_COLLATION = utf8mb4_bin em todas

-- (b) 4 FKs registradas
SELECT TABLE_NAME, CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
WHERE TABLE_SCHEMA = 'd5ea2e96_solutegdb' AND CONSTRAINT_TYPE = 'FOREIGN KEY'
AND TABLE_NAME IN ('condominiums','gestors','notificationContacts') ORDER BY TABLE_NAME;
-- Esperado: 4 linhas

-- (c) 18 entradas de índice nas 5 tabelas (PKs + UNIQUEs + os 10 CREATE INDEX)
SELECT COUNT(*) AS num_indices FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = 'd5ea2e96_solutegdb'
AND TABLE_NAME IN ('tenants','platformAdmins','gestors','condominiums','notificationContacts');
-- Esperado: 18
```
**Reversão do 6b:** `DROP TABLE notificationContacts, condominiums, gestors, platformAdmins, tenants;` (nesta ordem — respeita as FKs; as tabelas nascem vazias, zero dado em risco).

---

### 6c — `tenantId` nullable nas 38 tabelas operacionais (3.7.1c)

**Pré-validação — fecha o gap do diagnóstico (a Fase 4 não confirmou que as 38 existem):**
```sql
-- (a) As 38 tabelas-alvo existem? Esperado: num_tabelas = 38
SELECT COUNT(*) AS num_tabelas FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'd5ea2e96_solutegdb' AND TABLE_NAME IN (
  'budgetAttachments','budgetHistory','budgetItems','budgets','checklistInstances',
  'clientDocuments','clients','configuracoesTecnico','inspectionReports','inspectionTasks',
  'invites','laudoCitacoes','laudoFotos','laudoMedicoes','laudoTecnicos','laudos',
  'notificationContacts','notificationLogs','pushSubscriptions','reports','technicians',
  'waterTankAlertLog','waterTankFaultLog','waterTankMonitoring','waterTankSensors',
  'workOrderAttachments','workOrderComments','workOrderHistory','workOrderMaterials',
  'workOrderTasks','workOrderTimeTracking','workOrders','cashTransactions','categories',
  'customers','products','saleItems','sales');
-- Se < 38: listar quais faltam (query abaixo) e PARAR — decidir com a arquiteta.

-- (b) Nenhuma das 38 já tem tenantId? Esperado: 0 linhas
--     (as centrais tenants/gestors/condominiums TÊM tenantId, mas não estão nesta lista;
--      notificationContacts foi criada na 6b SEM tenantId, então aqui ainda não tem)
SELECT TABLE_NAME FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'd5ea2e96_solutegdb' AND COLUMN_NAME = 'tenantId' AND TABLE_NAME IN (
  'budgetAttachments','budgetHistory','budgetItems','budgets','checklistInstances',
  'clientDocuments','clients','configuracoesTecnico','inspectionReports','inspectionTasks',
  'invites','laudoCitacoes','laudoFotos','laudoMedicoes','laudoTecnicos','laudos',
  'notificationContacts','notificationLogs','pushSubscriptions','reports','technicians',
  'waterTankAlertLog','waterTankFaultLog','waterTankMonitoring','waterTankSensors',
  'workOrderAttachments','workOrderComments','workOrderHistory','workOrderMaterials',
  'workOrderTasks','workOrderTimeTracking','workOrders','cashTransactions','categories',
  'customers','products','saleItems','sales');
```

**SQL (38 `ADD COLUMN tenantId int NULL` — de `drizzle/0034_wonderful_vulcan.sql`):**
```sql
ALTER TABLE `budgetAttachments`   ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `budgetHistory`       ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `budgetItems`         ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `budgets`             ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `checklistInstances`  ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `clientDocuments`     ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `clients`             ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `configuracoesTecnico` ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `inspectionReports`   ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `inspectionTasks`     ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `invites`             ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `laudoCitacoes`       ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `laudoFotos`          ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `laudoMedicoes`       ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `laudoTecnicos`       ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `laudos`              ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `notificationContacts` ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `notificationLogs`    ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `pushSubscriptions`   ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `reports`             ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `technicians`         ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `waterTankAlertLog`   ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `waterTankFaultLog`   ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `waterTankMonitoring` ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `waterTankSensors`    ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `workOrderAttachments` ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `workOrderComments`   ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `workOrderHistory`    ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `workOrderMaterials`  ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `workOrderTasks`      ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `workOrderTimeTracking` ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `workOrders`          ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `cashTransactions`    ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `categories`          ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `customers`           ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `products`            ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `saleItems`           ADD COLUMN `tenantId` int NULL AFTER `id`;
ALTER TABLE `sales`               ADD COLUMN `tenantId` int NULL AFTER `id`;
```

**Validação do 6c:**
```sql
-- (a) 41 tabelas com coluna tenantId no total
SELECT COUNT(*) AS tabelas_com_tenantid FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'd5ea2e96_solutegdb' AND COLUMN_NAME = 'tenantId';
-- Esperado: 41 = 38 operacionais (0034, esta fase) + gestors + condominiums (0033, 6b)
--   + auditLog (0032, 6a — já nasce com tenantId).
--   NÃO têm tenantId: tenants, platformAdmins, loginAttempts, migrationAuditLog.
--   → confira a lista explícita se o número divergir:
SELECT TABLE_NAME FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'd5ea2e96_solutegdb' AND COLUMN_NAME = 'tenantId' ORDER BY TABLE_NAME;

-- (b) dados intactos — contagens batem com antes do cutover
SELECT
  (SELECT COUNT(*) FROM clients)    AS clientes,
  (SELECT COUNT(*) FROM workOrders) AS ordens,
  (SELECT COUNT(*) FROM products)   AS produtos;
-- Esperado: mesmos counts do diagnóstico (Fase 4)
```
**Reversão do 6c:** por tabela, `ALTER TABLE <t> DROP COLUMN tenantId;` — colunas nullable recém-criadas, sem dado ainda (a migração de dados só carimba na Fase 7).

---

## 9. Fase 7 — Migração de dados 🔧

**Pré-condição:** Fase 6 concluída (✅). Script `scripts/migrate-to-multi-tenant-producao.ts` já criado (Fase 1.2) e **revisado em 22/08** — diff contra o original de staging confirma que só mudam os comentários + a troca `assertStagingEnvironment()` → `assertProductionEnvironment()`; a lógica é idêntica à versão que rodou e validou em staging (carimbou 109.230 linhas). Aprovado pra uso.

### O que o script faz (5 etapas)
1. **Etapa 0 — pré-validações:** aborta se `DB_NAME` não for `d5ea2e96_solutegdb`; confere que as 3 tabelas de auditoria, as 5 centrais e a coluna `tenantId` nas 38 operacionais existem (tudo já garantido pela Fase 6). Imprime as contagens atuais de `clients`/`workOrders`/`budgets`/`products`.
2. **Etapa 1 — 2 ALTERs estruturais** (idempotentes, checam existência antes): `condominiums.type` (`varchar(40) NOT NULL DEFAULT 'condominio'`) e `clients.gestorId` (`int NULL`, sem FK por ora — `gestors` está vazia).
3. **Etapa 2 — cria 2 tenants:** `jnc` (id=1) e `soluteg-direto` (id=2, `isPlatformTenant=1`).
4. **Etapa 3 — carimba `tenantId=1`** nas 38 tabelas operacionais, só onde `tenantId IS NULL` (idempotente).
5. **Etapa 4 — cria o `platformAdmin`** `Thiago Lopes` / `thiagodll69@gmail.com` (senha pedida interativamente, mín. 12 caracteres, bcrypt cost 12).
As etapas 2–4 rodam **dentro de uma transação** (ROLLBACK automático em erro). Cada passo é gravado em `migrationAuditLog`.

### Onde rodar
Via **SSH no VPS**, a partir do diretório cujo `.env` aponta pra produção (`DB_NAME=d5ea2e96_solutegdb` + `DATABASE_URL` de produção):
```bash
cd /var/www/soluteg/backend
```

### Passo 1 — DRY-RUN (não escreve nada)
```bash
pnpm tsx scripts/migrate-to-multi-tenant-producao.ts
```
**Confira na saída:** ambiente confirmado como PRODUÇÃO; as contagens de `clients`/`workOrders`/`budgets`/`products` (devem ser ≥ 29/76/19/270 — se alguma vier **abaixo** do mínimo, **pare** e me avise, é sinal de dado faltando); e o total de linhas que *seria* carimbado (deve bater com a soma das linhas das 38 tabelas). Nenhum tenant/admin criado ainda — normal no dry-run.

### Passo 2 — APPLY (aplica de verdade)
```bash
pnpm tsx scripts/migrate-to-multi-tenant-producao.ts --apply
```
Vai pedir, **em sessão interativa (TTY)**:
1. digitar **`CONFIRMAR`** (qualquer outra coisa aborta);
2. a **senha do platformAdmin** duas vezes (mín. 12 caracteres) — é a senha de login do Thiago como dono da plataforma.

> ⚠️ **Detalhe do fluxo:** os 2 ALTERs da Etapa 1 rodam **antes** do prompt `CONFIRMAR` (DDL causa commit implícito no MySQL, então ficam fora da transação). Se você abortar no `CONFIRMAR`, `condominiums.type`/`clients.gestorId` podem já ter sido criadas — **sem problema:** são aditivas, idempotentes e a `condominiums` está vazia. Rodar de novo apenas as pula.

### Validação (dupla — a do script + a manual)
O script roda a **Etapa 5** sozinho (zero NULL residual nas 38 tabelas, `tenantId` apontando pra tenant válido em `clients`/`workOrders`/`budgets`/`products`, contagens mínimas) e sai com **exit 1** se algo falhar. Além disso, confirme no **DBeaver** (independente do script — lição do dia 22/08):
```sql
-- (a) 2 tenants criados
SELECT id, slug, name, isPlatformTenant FROM tenants ORDER BY id;
-- Esperado: id=1 jnc, id=2 soluteg-direto

-- (b) 1 platformAdmin criado
SELECT id, name, email, active FROM platformAdmins;
-- Esperado: 1 linha (Thiago Lopes)

-- (c) ZERO tenantId NULL — a varredura das 38 tabelas é feita pela Etapa 5 do
--     próprio script (SQL puro não conta NULLs em 38 tabelas dinamicamente).
--     No DBeaver, faça a checagem pontual nas 4 principais:
SELECT
  (SELECT COUNT(*) FROM `clients`    WHERE tenantId IS NULL) AS clients_null,
  (SELECT COUNT(*) FROM `workOrders` WHERE tenantId IS NULL) AS workorders_null,
  (SELECT COUNT(*) FROM `budgets`    WHERE tenantId IS NULL) AS budgets_null,
  (SELECT COUNT(*) FROM `products`   WHERE tenantId IS NULL) AS products_null;
-- Esperado: 0, 0, 0, 0

-- (d) tenantId sempre aponta pra tenant válido (sem órfão referencial)
SELECT
  (SELECT COUNT(*) FROM `clients`    WHERE tenantId NOT IN (SELECT id FROM tenants)) AS clients_orfaos,
  (SELECT COUNT(*) FROM `workOrders` WHERE tenantId NOT IN (SELECT id FROM tenants)) AS workorders_orfaos;
-- Esperado: 0, 0
```
> A varredura completa das 38 tabelas fica por conta da **Etapa 5 do script** (aborta com exit 1 se achar qualquer NULL residual). O DBeaver acima é a conferência independente das principais.

**Reversão:** as etapas de dados (2–4) estão em transação — erro no meio faz `ROLLBACK` sozinho. Os 2 ALTERs da Etapa 1 são aditivos/idempotentes (baixo risco). Se precisar desfazer **depois** de commitado, restaurar do backup da Fase 3 (`backup-pre-cutover-20260822-144218.sql`).

> **Ainda NÃO rodar `deploy-app` depois desta fase** — o código só entra na Fase 8, e só depois do backfill (Fase 9) o sistema fica consistente.

---

## 10. Fase 8 — Deploy do código 🔧

```bash
deploy-app   # ou manualmente: cd /var/www/soluteg/backend && git pull origin master && pnpm install && pnpm run build && pm2 restart soluteg-sistema --update-env
```

A partir daqui, todo `INSERT` novo passa a carimbar `tenantId` (guardas fail-closed da 3.7.2) e todo router isolado passa a filtrar por `ctx.tenantId`.

**Validação:** `pm2 status soluteg-sistema` online, `pm2 logs` sem erro de boot, um login de admin funciona, uma tela básica (dashboard) carrega.
**Reversão:** `git checkout <commit-anterior>` + rebuild + restart (o código antigo não sabe nada de `tenantId`, mas o schema novo é compatível — colunas `tenantId` extras não quebram queries antigas que não as usam).

---

## 11. Fase 9 — Backfill de órfãos pós-deploy 🔧

Cobre registros criados na janela entre a Fase 7 (migração de dados) e a Fase 8 (deploy do código com as guardas).

```bash
pnpm tsx scripts/backfill-tenant-null-producao.ts           # dry-run
pnpm tsx scripts/backfill-tenant-null-producao.ts --apply   # aplica os 16 backfills determinísticos
```
Depois, limpeza manual do que o script reporta como "decisão manual" (`configuracoesTecnico`, laudo residual sem cliente/OS) — mesmo processo do staging, adaptado aos dados reais de produção. Cuidado especial: produção tem MUITO mais volume que staging em `waterTankMonitoring` — o backfill pode demorar mais.

**Validação:** recontagem de NULLs por tabela (o próprio script reporta antes/depois) — zero em todas as tabelas do conjunto a travar na Fase 10 (exceto `notificationLogs`, que fica de fora por design).
**Reversão:** os `UPDATE` são idempotentes e conservadores (só preenchem `NULL`, nunca sobrescrevem valor existente) — baixo risco; se necessário, restaurar do backup.

---

## 12. Fase 10 — Travamento NOT NULL + FK 🔧

Depende da Fase 1.1 (`scripts/lock-tenant-not-null-fk-producao.ts` criado, sem `waterTankSensors`) e da reverificação 4.5 (LOCK-01) sem achado novo.

```bash
pnpm tsx scripts/lock-tenant-not-null-fk-producao.ts
```
**Excluídos do NOT NULL:** `notificationLogs` (NOTIF-01), `waterTankSensors` (LOCK-02 — motivo pelo qual existe a cópia `-producao.ts`, ver achado 1.2), `client_equipment` (não tem a coluna). **Incluídos mesmo com writer morto** (LOCK-01 — decisão confirmada, achado 1.5): `admins`, `auditLog`, `invites`, `inspectionReports`.

**Validação:** o script para no primeiro erro (não deixa a tabela em estado parcial) e valida `IS_NULLABLE`+FK via `information_schema` a cada tabela — conferir o resumo final (`sucesso.length` deve bater com o total de tabelas da lista).
**Reversão:** por tabela, `ALTER TABLE <t> DROP FOREIGN KEY fk_<t>_tenant` + `MODIFY COLUMN tenantId INT NULL` (foi exatamente assim que o LOCK-02 foi revertido em staging).

---

## 13. Fase 11 — Rotação do `JWT_SECRET` 🔧

**Por último, de propósito** — desloga todo mundo (admins/clientes/técnicos).

```bash
# gerar novo secret (ex.: openssl rand -hex 32), atualizar no .env de produção
pm2 restart soluteg-sistema --update-env
```
Fazer no horário de baixo uso já reservado na Fase 2. Avisar se decidiu comunicar aos clientes.

**Validação:** login novo funciona; um cookie/sessão antiga é rejeitada (testar antes de rotacionar: guardar um cookie válido, rotacionar, confirmar que ele para de funcionar).
**Reversão:** não há — é proposital que sessões antigas morram. Se algo mais der errado, é o `.env` que volta (não o secret em si).

---

## 14. Fase 12 — Validação final 🗂️🔧

- [ ] Login admin, cliente e técnico funcionando
- [ ] Criar uma OS de teste, ver no dashboard, editar, anexar foto
- [ ] Aprovar um orçamento via link público (`/orcamento/:token`) — fluxo que não deve ter sido afetado
- [ ] `VALID-01`: sensor real mandando leitura MQTT, nível atualizando ao vivo no portal do cliente
- [ ] Isolamento: criar um registro de teste sob o tenant `soluteg-direto` (id=2) e confirmar que o admin da JNC não o vê em lugar nenhum — nosso primeiro "ghost-probe" real em produção
- [ ] `pm2 logs` sem erro recorrente por pelo menos alguns minutos de uso real

---

## 15. Fase 13 — Atualizar documentação 🗂️

- [ ] `PENDENCIAS_DEPLOY_PRODUCAO.md` — cada linha da tabela de status vira ✅ Aplicado (produção)
- [ ] `CLAUDE.md` §2 — "Estado atual" passa a dizer que o cutover foi concluído; próximo passo vira 3.7.3
- [ ] `ROADMAP.md` — sub-fase 3.7 atualizada, marco de "produção com zero multi-tenant" removido
- [ ] `ARCHITECTURE_HANDOFF.md` §8/§9 — se necessário
- [ ] Este runbook — marcar como ✅ Executado com a data real, deixado no repo como histórico (não apagar)

---

## Decisões tomadas (22/08/2026)

| # | Pergunta | Decisão | Detalhe |
|---|---|---|---|
| 1 | Abordagem dos scripts de produção (achado 1.1) | Cópia dedicada `*-producao.ts` | Seção 1.1 |
| 2 | Comunicação aos clientes (Fase 2) | Sim, avisar | Texto/antecedência a definir — seção 4 |
| 3 | Exclusão do NOT NULL para `admins`/`auditLog`/`invites`/`inspectionReports` (LOCK-01) | Travar as 4, mesma decisão do staging | Verificado zero escritor vivo hoje; reverificar contra o merge final (item 4.5) — seção 1.5 |

**Próximo passo:** gerar o prompt para o Claude Code (VS Code) executar a Fase 1 (seção 3) — itens 1.1 a 1.3 (scripts de produção) primeiro, depois 1.4/1.5 (merge + build) como uma etapa separada de revisão.
