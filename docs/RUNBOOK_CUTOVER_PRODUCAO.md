# Runbook — Cutover de Produção (Fase 3.7 Multi-tenant)

> **Status:** 🔴 RASCUNHO — não executar ainda. Há achados críticos (seção 1) que precisam de decisão antes deste runbook virar um roteiro executável.
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

## 1. Achados críticos — resolver ANTES de qualquer execução

Revisei os 4 scripts de migração (`scripts/migrate-to-multi-tenant.ts`, `scripts/backfill-tenant-null.ts`, `scripts/lock-tenant-not-null-fk.ts`, `scripts/diagnostico-3.7.1f-fase0.ts`) e as migrations envolvidas. Achei 4 problemas que, se ignorados, ou impedem o cutover de rodar, ou **reproduzem em produção bugs que já apareceram e foram corrigidos em staging**. Nenhum foi corrigido ainda — preciso da sua decisão sobre a abordagem antes de escrever os prompts pro Claude Code.

### 1.1 — Os 4 scripts recusam produção de propósito
Todos chamam `assertStagingEnvironment()` (`server/lib/environment.ts:25`), que **lança erro imediatamente** se `DB_NAME` for o de produção (`d5ea2e96_solutegdb`). Isso é uma trava de segurança deliberada — mas significa que nenhum dos 4 scripts roda contra produção do jeito que está hoje. Já existe `assertProductionEnvironment()` pronta no mesmo arquivo, feita exatamente pra esse caso ("scripts de deploy formal que só devem tocar em produção").
**Preciso decidir com você:** cada script vira uma cópia `-producao.ts` (mais claro, mas duplica lógica — risco de divergir com o tempo), ou os 4 ganham uma flag `--producao` que troca qual assert chamar (fonte única, mas o script fica um pouco mais genérico)? Ver seção 6 (Fase 1) — vou propor uma recomendação, mas quero seu aval antes de mandar pro Claude Code.

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
Esse documento (seção 3.7.1b, "Passo 1") aponta para `drizzle/migrations/0042_collation_fix_audit_tables.sql` — mas esse arquivo foi **renomeado para `0043_collation_fix_audit_tables.sql`** durante a sincronização master→multi-tenant de 03/08/2026 (colidia com `0042_client_equipment.sql`, que veio da master). O arquivo `0042` correto hoje é sobre `client_equipment`, não collation. Vou corrigir essa referência no próprio `PENDENCIAS_DEPLOY_PRODUCAO.md` quando formos executar essa fase.

**Nenhum desses 4 pontos bloqueia a gente de aprovar o *formato* do runbook agora — mas todos bloqueiam a Fase 1 (preparação de código). Trato isso na seção 6.**

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

**Pré-condição:** você aprovar a abordagem para os pontos 1.1 e 1.2 acima.

- [ ] 1.1 Corrigir `scripts/lock-tenant-not-null-fk.ts`: remover `waterTankSensors` da lista `TABELAS`, comentar por quê (LOCK-02), referenciar `docs/PENDENCIAS_TECNICAS.md`.
- [ ] 1.2 Adaptar os 4 scripts de migração para suportar produção (formato a definir com você — cópia dedicada vs. flag `--producao`).
- [ ] 1.3 Merge `multi-tenant → master` numa branch de teste primeiro (mesmo método já usado em 03/08 — `docs/RELATORIO_MERGE_MASTER_MULTITENANT.md`), revisar conflitos com você, comparar baseline do `tsc` antes/depois.
- [ ] 1.4 `pnpm run build` local — precisa passar (exit 0) antes de seguir.
- [ ] 1.5 Corrigir a referência de arquivo no `PENDENCIAS_DEPLOY_PRODUCAO.md` (achado 1.4).

**Validação:** build de produção passa, `tsc` não introduz erro novo (baseline atual: 32), diff revisado e aprovado por você.
**Reversão:** é só código, ainda não tocou em VPS/banco — descartar a branch de teste se algo não fechar.

---

## 4. Fase 2 — Janela de execução 🗂️🔧

- [ ] Escolher horário de baixo uso (madrugada, conforme já é praxe no projeto).
- [ ] Decidir se avisa os ~29 clientes ativos de uma manutenção rápida (a Fase 11 — rotação de JWT — desloga todo mundo).
- [ ] Confirmar que você terá tempo pra rodar o runbook inteiro numa sentada — não é recomendável parar no meio com o banco em estado intermediário por muito tempo.

---

## 5. Fase 3 — Backup 🔧

```bash
mysqldump -h 69.6.213.57 -u d5ea2e96_soluteg -p \
  --routines --triggers --single-transaction --no-tablespaces \
  d5ea2e96_solutegdb > /var/backups/soluteg-producao/backup-pre-cutover-$(date +%Y%m%d-%H%M%S).sql
chmod 600 /var/backups/soluteg-producao/backup-pre-cutover-*.sql
```
**Validação:** arquivo existe, tamanho condizente (comparar com backups anteriores), `chmod 600` aplicado.
**Reversão:** este backup é o ponto de restauração de tudo o que vem depois — se algo der muito errado em qualquer fase futura, é `mysql < backup-pre-cutover-*.sql`.

---

## 6. Fase 4 — Diagnóstico do estado atual de produção 🔧 (read-only)

Objetivo: **nunca assumir** que uma tabela/coluna não existe — confirmar. Isso substitui a Fase 0 do `PLANO_3.7.1f.md` (que foi escrita pensando em staging, onde o histórico já era conhecido) por uma versão que desconfia de tudo, já que produção não passou pelas sub-fases incrementais.

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

Rodar também as 3 pré-validações do legado (duplicatas em `budgetNumber`/`approvalToken`/`username`/`deviceId`, NULLs em `cashTransactions`/`saleItems`/`sales`, tamanho de `technicianSignature`) — SQL completo em [`PENDENCIAS_DEPLOY_PRODUCAO.md`](../PENDENCIAS_DEPLOY_PRODUCAO.md) seção "Checklist de pré-deploy".

**Validação:** os resultados de 4.1–4.4 definem exatamente o que falta aplicar nas Fases 5–6 (e se as 3 pré-validações do legado acusarem algo > 0, paramos e corrigimos os dados antes de seguir).
**Reversão:** não aplicável — é só leitura.

---

## 7. Fase 5 — Os 14 ajustes de schema legado 🔧

Só os itens que a Fase 4 confirmou como pendentes. SQL completo (4 blocos) em [`PENDENCIAS_DEPLOY_PRODUCAO.md`](../PENDENCIAS_DEPLOY_PRODUCAO.md) seção "As 14 mudanças a aplicar em produção". Resumo:
- Bloco 1 (4 UNIQUE): `budgets.budgetNumber`, `budgets.approvalToken`, `technicians.username`, `waterTankSensors.deviceId`
- Bloco 2 (2 tipos): `budgets.sharedWithPortal` → INT NOT NULL DEFAULT 0; `workOrders.technicianSignature` → TEXT
- Bloco 3 (6 NOT NULL): `cashTransactions.type/amount`, `saleItems.productName/unitPrice/subtotal`, `sales.total`
- Bloco 4 (2 sem DEFAULT): `waterTankAlertLog.direction/tankType`

**Validação:** query de validação pós-aplicação no mesmo documento (índices criados, tipos/NOT NULL corretos).
**Reversão:** restaurar do backup da Fase 3 (são ALTERs simples, reversão manual também é viável se for só 1-2 tabelas).

---

## 8. Fase 6 — Schema multi-tenant central 🔧

**6a — Tabelas de auditoria (3.7.1a), só as que a Fase 4.1 confirmou ausentes:**
Aplicar manualmente (statement por statement, não o arquivo `0032` inteiro) os `CREATE TABLE` de `auditLog`, `loginAttempts`, `migrationAuditLog` — extrair do `drizzle/0032_illegal_shinobi_shaw.sql` só esses 3 blocos.

**6b — Tabelas centrais multi-tenant (3.7.1b):**
`drizzle/0033_giant_tomorrow_man.sql` (via `sed`, não `grep -v` — regra do `CLAUDE.md` §5.5) + os 4 `ALTER...FOREIGN KEY` + 13 `CREATE INDEX` manuais (o pipe não aplica FK/índice pós-`CREATE TABLE`) + o fix de collation (`drizzle/migrations/0043_collation_fix_audit_tables.sql` — **note o número corrigido**, achado 1.4). Passo a passo completo em [`PENDENCIAS_DEPLOY_PRODUCAO.md`](../PENDENCIAS_DEPLOY_PRODUCAO.md) seção "3.7.1b".

**6c — `tenantId` nullable nas 38 tabelas operacionais (3.7.1c):**
```bash
sed 's|--> statement-breakpoint||g' drizzle/0034_wonderful_vulcan.sql | \
  mysql -h 69.6.213.57 -u d5ea2e96_soluteg -p d5ea2e96_solutegdb
```

**Validação (cada sub-passo):** contagem de tabelas/FKs/índices via `information_schema` (queries prontas no `PENDENCIAS_DEPLOY_PRODUCAO.md`), contagem de linhas de `clients`/`workOrders`/`products` batendo com antes.
**Reversão:** restaurar do backup; ou, se for só uma tabela isolada, `DROP TABLE`/`ALTER TABLE` reverso (mas nesse ponto ainda não há dado novo em risco — as tabelas centrais nascem vazias).

---

## 9. Fase 7 — Migração de dados 🔧

Depende da Fase 1.2 (script adaptado pra produção) estar pronta.

```bash
# via SSH no VPS, apontando pro .env de produção
pnpm tsx scripts/migrate-to-multi-tenant.ts --producao          # dry-run primeiro
pnpm tsx scripts/migrate-to-multi-tenant.ts --producao --apply  # aplica de verdade
```
Cria os tenants `jnc` (id=1) e `soluteg-direto` (id=2), carimba `tenantId=1` nas 38 tabelas operacionais (só onde `tenantId IS NULL`, idempotente), cria o `platformAdmin` (pede senha interativamente, mín. 12 caracteres).

**Validação:** o próprio script roda a Etapa 5 (validações finais: zero NULL residual, `tenantId` aponta pra tenant válido, contagens mínimas de `clients`/`workOrders`/`budgets`/`products`) e aborta com exit 1 se algo falhar.
**Reversão:** o script já roda dentro de uma transação para as etapas de dados (2–4); um erro no meio faz `ROLLBACK` automático. Se precisar desfazer depois de commitado, restaurar do backup.

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
pnpm tsx scripts/backfill-tenant-null.ts --producao           # dry-run
pnpm tsx scripts/backfill-tenant-null.ts --producao --apply   # aplica os 16 backfills determinísticos
```
Depois, limpeza manual do que o script reporta como "decisão manual" (`configuracoesTecnico`, laudo residual sem cliente/OS) — mesmo processo do staging, adaptado aos dados reais de produção. Cuidado especial: produção tem MUITO mais volume que staging em `waterTankMonitoring` — o backfill pode demorar mais.

**Validação:** recontagem de NULLs por tabela (o próprio script reporta antes/depois) — zero em todas as tabelas do conjunto a travar na Fase 10 (exceto `notificationLogs`, que fica de fora por design).
**Reversão:** os `UPDATE` são idempotentes e conservadores (só preenchem `NULL`, nunca sobrescrevem valor existente) — baixo risco; se necessário, restaurar do backup.

---

## 12. Fase 10 — Travamento NOT NULL + FK 🔧

Depende da Fase 1.1 (script corrigido, sem `waterTankSensors`).

```bash
pnpm tsx scripts/lock-tenant-not-null-fk.ts --producao
```
**Excluídos do NOT NULL** (confirmado pelas decisões já tomadas em staging): `notificationLogs` (NOTIF-01), `waterTankSensors` (LOCK-02), `client_equipment` (não tem a coluna). **Incluídos mesmo com writer morto** (LOCK-01, mesma decisão do staging): `admins`, `auditLog`, `invites`, `inspectionReports` — travar aqui é seguro porque ninguém escreve neles hoje; a pegadinha é só lembrar de carimbar `tenantId` quando esses writers forem reativados (3.7.4/3.7.6/3.7.7).

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

## Perguntas em aberto para decidirmos juntos antes de eu gerar os primeiros prompts

1. **Abordagem dos scripts de produção** (achado 1.1): cópia `-producao.ts` dedicada, ou flag `--producao` nos 4 scripts existentes?
2. **Comunicação aos clientes** sobre a janela de manutenção (Fase 2) — avisa ou não, e com quanto tempo de antecedência?
3. **Confirma a exclusão do NOT NULL** pra `admins`/`auditLog`/`invites`/`inspectionReports` (LOCK-01) — mesma decisão do staging, ou quer reavaliar algum deles à luz de produção?
