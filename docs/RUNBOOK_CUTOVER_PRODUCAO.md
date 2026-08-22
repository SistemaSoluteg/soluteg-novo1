# Runbook — Cutover de Produção (Fase 3.7 Multi-tenant)

> **Status:** ✅ Fase 1 CONCLUÍDA (22/08) — `master` e `multi-tenant` sincronizados em `54757d3` (fast-forward limpo, sem conflito). **Fases 2-11 (produção) ainda não começaram.**
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

**4.5 — Reverificação do LOCK-01 (achado 1.5):** contra o código do merge final (`multi-tenant → master`, resultado da Fase 1.4), confirmar de novo que `createAdmin`, `createInvite`/`acceptInvite`, `createInspectionReport` e qualquer escrita em `auditLog` não têm chamador fora de `server/db.ts`. Se algum aparecer (por exemplo, algo que a `master` trouxe e o merge não tinha antes), **parar e decidir com a arquiteta** se essa tabela também vai pro NOT NULL ou fica de fora — não travar às cegas.

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

Depende da Fase 1.2 (`scripts/migrate-to-multi-tenant-producao.ts` criado) estar pronta.

```bash
# via SSH no VPS, apontando pro .env de produção
pnpm tsx scripts/migrate-to-multi-tenant-producao.ts          # dry-run primeiro
pnpm tsx scripts/migrate-to-multi-tenant-producao.ts --apply  # aplica de verdade
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
