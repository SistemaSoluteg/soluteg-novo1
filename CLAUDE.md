# CLAUDE.md — Contexto Operacional do Projeto Soluteg

> Este arquivo é lido automaticamente por IAs de codificação (Antigravity, Claude Code) ao abrir o projeto.
> Contém o **contexto operacional vivo** — o que está sendo feito agora, regras invioláveis, comandos comuns.
> Para visão arquitetural completa, ver [`ARCHITECTURE_HANDOFF.md`](./ARCHITECTURE_HANDOFF.md).

**Última atualização:** 16/08/2026 (3.7.2/isolamento concluída — 9 routers; próximo passo é 3.7.1f)

---

## 1. O projeto em 60 segundos

**Soluteg** é um sistema de gestão para empresas de serviços técnicos (elétrica, hidráulica, bombeamento). Hoje em produção para a **JNC Elétrica** (Baixada Santista, SP). Está sendo transformado em SaaS multi-tenant.

**Stack:** React 19 + Vite + TypeScript (frontend) | Node.js + Express + tRPC + Drizzle ORM (backend) | MySQL 8 | WhatsApp Web.js + MQTT (sensores ESP32) + Cloudinary | PM2 + Nginx em VPS Hostgator.

**Time:** 1 desenvolvedor (Thiago), 3h/dia. Filosofia: simplicidade testada, sem over-engineering.

**Modelo de negócio futuro:** dois cenários:
- **Cenário A (B2B):** empresa de serviços contrata Soluteg para gerenciar seus condomínios (caso JNC)
- **Cenário B (B2C):** síndico contrata direto, indica técnico avulso que recebe alertas sem logar

---

## 2. Estado atual (16/08/2026)

### Em andamento
**Fase 3.7 — Refactor multi-tenant.** Branch `multi-tenant`. **Sub-fase 3.7.2 (Isolamento de queries) CONCLUÍDA — 9 routers isolados (`technicians`, `clients`, `workOrders`, `budgets`, `checklists`, `technicianPortal`, `documents`, `waterTankAdmin`, `laudos`).** Todo router que toca dado operacional está isolado por tenant. Fechados no caminho: gap `clientProfile.uploadPhoto`, `SEC-01` (`/api/admin-metrics` → `adminMetrics.router` autenticado), SSE `/api/water-tank-sse` (auth + clientId do JWT), gate `pdvProcedure` (PDV só tenant 1), carimbo de `tenantId` no `pushSubscriptions`, e faxina dos routers legados `reports`/`users` (removidos). **Próximo passo: 3.7.1f** (NOT NULL + FKs + índices + backfill final + rotação do `JWT_SECRET`).

Dois métodos de isolamento em uso, conforme o router usa helper isolado ou `server/db.ts` compartilhado:
- **Método A** (`technicians`): filtro direto na query via `forTenantId`/`withTenantId`.
- **Método B** (`clients`): guarda no router (`if (registro.tenantId !== ctx.tenantId) throw NOT_FOUND`) após buscar via `db.ts`, porque as funções de `db.ts` são usadas por vários arquivos e não podem mudar de assinatura.

Cada router isolado é validado com **ghost-probe**: criar um registro sob outro tenant e confirmar que fica invisível para o admin do JNC.

### Concluído recentemente
- ✅ Sub-fase 3.7.1a — Tabelas de auditoria (`auditLog`, `loginAttempts`, `migrationAuditLog`) + helper `server/lib/environment.ts`
- ✅ Sub-fase 3.7.1b — 5 tabelas centrais (`tenants`, `platformAdmins`, `gestors`, `condominiums`, `notificationContacts`) com `utf8mb4_bin`, 4 FKs, 18 índices
- ✅ Bugfix de aprovação de orçamento em produção (commit `51a18a7`) — `getBudgetByToken` sem `adminId`/`priority` no SELECT
- ✅ Consolidação completa da documentação do projeto
- ✅ Sub-fase 3.7.1c — 38 tabelas operacionais receberam `tenantId INT NULL`. Total: 41 tabelas com `tenantId` no banco. Dados existentes intactos (29 clients, 76 workOrders, 270 products).
- ✅ Sub-fase 3.7.1d — Script `scripts/migrate-to-multi-tenant.ts` finalizado e validado em dry-run. Bug de leitura do mysql2 corrigido (`db.execute()` retorna `[linhas, metadata]`, não `[linhas]`).
- ✅ Sub-fase 3.7.1e — Migração aplicada em staging (`--apply`): tenant JNC (id=1) e Soluteg Direto (id=2) criados, platformAdmin Thiago (id=1) criado, `tenantId=1` em 109.230 linhas de 38 tabelas. ALTERs `condominiums.type` e `clients.gestorId` aplicados. Zero NULLs, integridade referencial validada.
- ✅ Reordenação de sub-fases: **3.7.2 (isolamento) ANTES de 3.7.1f (NOT NULL)**.
- ✅ Sub-fase 3.7.2 (Fundação): Helper `forTenant` fail-closed, `tenantId` no `TrpcContext`, `admins.tenantId` adicionada e populada em staging.
- ✅ Sub-fase 3.7.2 (Piloto): Router `technicians` 100% isolado por tenant.
- ✅ Sub-fase 3.7.2 (Escala, router 2/N): Router `clients` isolado por tenant (commit `91e0403`), incluindo correção de um IDOR pré-existente em `equipment.remove` (sem checagem de posse alguma antes desta mudança). `getClientByUsername` permanece global — é usada pelo login do cliente, que não passa pelo router. Detalhes em [`ARCHITECTURE_HANDOFF.md`](./ARCHITECTURE_HANDOFF.md) seção 8.8.
- ✅ Fixes de infra descobertos no caminho da 3.7.2: pipeline de deploy do staging corrigido (pm2 apontava pro diretório de produção; `ecosystem.config.cjs` resolveu — `deploy-tst` agora funciona de verdade); tabela `client_equipment` estava ausente no banco de staging (`_tst`), criada — corrigiu bug de equipamento e normalizou upload de documento.
- ✅ Sub-fase 3.7.2 (Escala, router 9/N): `laudos` isolado e **validado em staging** (commit `3dd4d4e`, Método B) — o router mais complexo (40+ endpoints). Helpers `carregarLaudoDoTenant` (guarda de posse em todo endpoint por id), `assertClienteDoTenant`/`assertTecnicoDoTenant` (FK-do-input); `listLaudos` com fail-closed de tenant; sub-recursos guardados via laudo pai + carimbam `tenantId`; sem escritor de sistema/Express (callers externos read-only: IA/PDF). Ghost-probe + FK forjada + regressão completa (criar → foto/medição/citação → atribuir técnico → PDF) + portal do técnico OK. Junto nesta leva (validados): SEC-01 fechado (`adminMetrics.router`), gate `pdvProcedure`, SSE `/api/water-tank-sse` com `requireClientAuth` (401 sem cookie), `pushSubscriptions` carimba `tenantId`, e remoção dos legados `reports`/`users`. **Backfill:** `scripts/backfill-tenant-null.ts` estendido para todas as tabelas operacionais (16 regras via FK-pai), dry-run+apply no staging zerou tudo derivável.
- ✅ Sub-fase 3.7.2 (Escala, router 8/N): `waterTankAdmin` isolado e **validado em staging** (commit `8c4e069`). Fechou o pior IDOR da sub-fase (`adminId` vinha do input). Duas metades: **admin** (fail-closed) e **ingestão MQTT/Express** (best-effort, SEM fail-closed — nunca dropa leitura/alarme, risco da Fase 1). `listPending` global (pool de devices). Achados: drift de `alertPhone2` no staging e `adminId`-do-body na rota Express (`SEC-02`). Seção 8.15 do [`ARCHITECTURE_HANDOFF.md`](./ARCHITECTURE_HANDOFF.md).
- ✅ Sub-fase 3.7.2 (Escala, routers 6-7/N): `technicianPortal` (commit `4a35ab1`) e `documents` (commit `6997ef6`) isolados e **validados em staging**. `technicianPortal` já era seguro por posse do técnico; a leva fechou o acúmulo de `tenantId=NULL` nas 5 sub-tabelas de OS (fail-closed nas `createX` do `workOrdersAuxDb` + 9 call sites). `documents`: `clientDocuments` isolado em 3 routers + rota Express; vazamento total no `listAll` corrigido (filtro `adminId` nunca aplicado); routers de doc duplicados sem caller no front (faxina). Detalhes nas seções 8.13/8.14 do [`ARCHITECTURE_HANDOFF.md`](./ARCHITECTURE_HANDOFF.md).
- ✅ Sub-fase 3.7.2 (Escala, router 5/N): Router `checklists` isolado e **validado em staging** (14/08, commit `88e4a85`). `templates.*` globais por design (`checklistTemplates` sem `tenantId` — catálogo compartilhado); `inspectionTasks`/`checklistInstances` com guarda de posse; `createInspectionTask`/`createChecklistInstance` com `tenantId` obrigatório + fail-closed, cobrindo os 3 caminhos de escrita (router admin, `technicianPortal.addChecklist`, `monthlyOsJob`). Ghost-probe OK, regressão do fluxo admin OK, 0 órfãos no staging. Junto, faxina de código morto (9 arquivos removidos). Detalhes na seção 8.12 do [`ARCHITECTURE_HANDOFF.md`](./ARCHITECTURE_HANDOFF.md).
- ✅ Sub-fase 3.7.2 (Escala, router 4/N): Router `budgets` isolado e **validado em staging** (14/08, commit `5483c1b`). Guardas de posse em todos os endpoints admin; `delete`/`shareToPortal` (IDOR sem checagem) e `getMetrics` (vazava métricas cross-tenant) fechados; `create` valida posse do `clientId`; anexos com guarda multi-etapa. Procedures do link público de aprovação (`/orcamento/:token`) **globais por design** (token opaco é a credencial). Sub-tabelas carimbam `tenantId`. Junto: fix de FK-do-input no `workOrders` (commit `ddc420e`) — `create`/`update`/`assignTechnician` validam posse de `clientId`/`technicianId`. Ghost-probe + link público + FK forjada validados. Detalhes na seção 8.11 do [`ARCHITECTURE_HANDOFF.md`](./ARCHITECTURE_HANDOFF.md).
- ✅ Sub-fase 3.7.2 (Escala, router 3/N): Router `workOrders` isolado e **validado em staging** (14/08). Além do router tRPC (Método B + guardas multi-etapa nos sub-routers), foram cobertos: 2 rotas Express legadas (`GET`/`POST /api/work-orders`), 3 caminhos extras de criação de OS (`workOrdersRecurrence`, `budgets.approve`/`generateOs`), e uma **guarda fail-closed** em `workOrdersDb.createWorkOrder` que expôs mais 3 call sites de sistema (`monthlyOsJob` 2x, `waterTankAlertService`) — todos corrigidos. Ghost-probe cross-tenant OK; backfill de 1 OS órfã (`tenantId=NULL`) feita no staging. Sub-router `metrics` adiado (dívida técnica); `GET /api/admin-metrics` sem auth registrado como `SEC-01`. Detalhes na seção 8.10 do [`ARCHITECTURE_HANDOFF.md`](./ARCHITECTURE_HANDOFF.md).

### Próxima
**Sub-fase 3.7.1f — travamento final** (3.7.2 concluída e validada, desbloqueada): backfill final de `tenantId IS NULL` residual (`scripts/backfill-tenant-null.ts` já cobre todas as tabelas operacionais deriváveis) → `tenantId` NOT NULL + FKs `tenantId → tenants.id` + índices → rotação do `JWT_SECRET` (desloga todos). **Cuidados registrados:**
- **Excluir `notificationLogs` do NOT NULL** — o write-path (`server/lib/notifications.ts:223`) insere sem carimbar `tenantId`, então acumula NULL; é tabela de log (baixa sensibilidade). Corrigir o carimbo fica pra 3.7.9 (que reescreve o fluxo de notificações); até lá `notificationLogs.tenantId` continua nullable.
- **Antes de travar, limpar lixo de teste** que o backfill não resolve: budget órfão `id=22` ("Hshs", clientId inexistente) + filhos; `configuracoesTecnico` e laudo residual (decisão manual — hoje só tenant 1).
- Bug pontual anotado (não bloqueia): `laudosDb.deleteLaudo` não limpa `laudoCitacoes` (citação órfã no cascade).

Rito de sempre: prompt para a IA do terminal (Claude Code no VS Code) → revisão do diff com o Thiago → commit + push → `deploy-tst` → validação com ghost-probe. (O deploy puxa via `git pull`, então precisa commitar+pushar antes; a validação em staging acontece depois do commit, na branch `multi-tenant`.)

**Lições da 3.7.2 (aplicar nos próximos routers):**
- Ao isolar um router, fazer `grep` por **todos** os pontos de escrita da tabela — incluindo chamadas sem prefixo de módulo (`createX(` além de `db.createX(`) e rotas Express fora do tRPC (`app.get/post` em `server/index.ts`) — não só o router. O `tsc` não pega nada disso; a validação real é a revisão do diff + ghost-probe.
- Validar **toda foreign key vinda do input** (`clientId`, `technicianId`, etc.) contra o tenant, não só a posse do registro principal — senão dá pra referenciar registro de outro tenant e vazar PII (achado no `budgets`/`workOrders`).
- Identificar os **lookups por token/username que ficam globais por design** (login do cliente, link público de aprovação) e comentá-los explicitamente para ninguém adicionar guarda que quebre o fluxo público.
- **Catálogos/tabelas de referência compartilhadas ficam globais** (ex.: `checklistTemplates`, sem `tenantId`) — não guardar, comentar como "GLOBAL POR DESIGN".

**Dívidas técnicas anotadas (sem pressa):**
- `getTechnicianById` tem `tenantId` opcional — vira obrigatório quando `technicianPortal` for isolado (`workOrders`, que já usa a variante com `tenantId`, e `checklists` já foram).
- ✅ **Faxina de código morto (concluída em 14/08)**: removidos `createWorkOrder` órfã do `db.ts`, sub-router `workOrders.timeTracking.*` + funções do aux, `inspectionTasks.complete`/`completeInspectionTask`/`areAllChecklistsComplete`, routers de documento duplicados (`adminDocuments` + `adminProfile.adminDocuments`) e 4 funções de doc órfãs. **`canComplete` é UI viva** (governa o botão "Concluir Tarefa" no `InspectionTaskItem`, mesmo sendo stub `return true`) — **não é morto, foi mantido**. Tabela `workOrderTimeTracking` mantida no banco (só o código saiu).
- ✅ **`SEC-01` fechado** (commit `44bd66b`): `GET /api/admin-metrics` sem auth virou `adminMetrics.router` (tRPC autenticado, escopado por `adminId`+`tenantId`). Resta o `metrics` do `workOrders` (dívida técnica adiada) e o `SEC-02` (`adminId`-do-body na rota Express `POST /api/water-tank-monitoring` — verificar se já foi corrigido).
- `3.7.1f` (NOT NULL + FKs + índices) só entra depois que **todos** os routers estiverem isolados — e precisa de um backfill final de `tenantId IS NULL` antes de travar (novos NULLs podem surgir enquanto nem todo caminho de escrita tiver a guarda).

### Roadmap restante (resumo)
3.7.2 (escalar isolamento) → 3.7.1f (NOT NULL + rotação JWT) → 3.7.3 a 3.7.8 → **3.7.9 (notificações por tenant: WhatsApp multi-instância c/ abstração + Email + Templates editáveis)**.

> **3.7.9 (planejada 16/08/2026):** tira o número da JNC do hardcode e o SMTP do `.env` globais; cada tenant configura o próprio WhatsApp/email e edita as mensagens automáticas (tabela de templates c/ defaults). WhatsApp via abstração `WhatsappProvider` + `wwebjs` multi-instância (uma sessão/Chromium por tenant), com seam pra Cloud API depois. **Hoje é só JNC** — multi-tenant aqui é estrutura preparatória. Estimativa de RAM (quantos tenants o wwebjs comporta) e comandos de medição no VPS em [`ARCHITECTURE_HANDOFF.md`](./ARCHITECTURE_HANDOFF.md) seção 6.5.1.

Detalhamento completo em [`ROADMAP.md`](./ROADMAP.md).

---

## 3. Modelo multi-tenant (resumo)

```
tenants (JNC, Soluteg Direto, futuros parceiros)
   ↓ FK
gestors (síndicos, administradoras)
   ↓ FK
condominiums (lugares físicos)
   ↓ FK
notificationContacts (técnicos avulsos — Cenário B, não logam)

platformAdmins (donos da plataforma, SEM FK para tenant)
```

**Estratégia:**
- Shared database + `tenantId` em toda tabela operacional
- Soft delete via campo `active` (não usar CASCADE)
- `utf8mb4_bin` em todas as tabelas (consistência + comparação case-sensitive)
- IDs `int autoincrement` (consistência com schema legacy)
- UNIQUE composto `gestors (tenantId, username)` — username único POR tenant
- JNC vira o primeiro tenant. Conta separada `platformAdmin` para Thiago será criada na migração.

**Detalhes arquiteturais:** [`ARCHITECTURE_HANDOFF.md`](./ARCHITECTURE_HANDOFF.md) seções 5 e 6.

---

## 4. Infraestrutura

### Domínios e processos

| Domínio | Branch | PM2 | Porta | Banco |
|---------|--------|-----|-------|-------|
| `app.soluteg.com.br` (**PRODUÇÃO**) | `master` | `soluteg-sistema` | 3000 | `d5ea2e96_solutegdb` |
| `tst.soluteg.com.br` (**STAGING**) | `multi-tenant` | `soluteg-staging` | 3001 | `d5ea2e96_tst` |
| `jnc.soluteg.com.br` | (Astro estático) | — | — | — |

**Host MySQL:** `69.6.213.57:3306`
**Users MySQL:** `d5ea2e96_soluteg` (produção) | `d5ea2e96_id_rsa` (staging)

### Caminhos no VPS

- Produção: `/var/www/soluteg/backend`
- Staging: `/var/www/soluteg-staging`
- Backups: `/var/backups/soluteg-producao/` e `/var/backups/soluteg-staging/`

### Isolamento staging via `.env`

```env
PORT=3001
MQTT_DISABLED=true
WHATSAPP_DISABLED=true
DB_NAME=d5ea2e96_tst
```

Helper `server/lib/environment.ts` aborta scripts se rodarem no banco errado. **SEMPRE usar `assertStagingEnvironment()` em scripts de migração.**

---

## 5. Regras invioláveis

### 5.1 Branches

- `master` — produção. Só recebe merges de bugfix e sub-fases concluídas.
- `multi-tenant` — refactor em andamento. Antigravity trabalha aqui.
- `fix/*` — bugfixes urgentes. **SEMPRE** baseados em `master`, nunca em `multi-tenant`.

**Antes de qualquer mudança:** `git branch --show-current` e confirmar.

### 5.2 Ferramentas de IA

- **Antigravity** → multi-tenant (branch `multi-tenant`)
- **VS Code Claude Code** → bugfixes (branch `fix/*` de master)
- **NUNCA misturar contextos.** Cada ferramenta tem seu escopo.

### 5.3 Segurança em tRPC

- `publicProcedure` é **PROIBIDO** para endpoints que tocam dados de usuário
- IDs SEMPRE vêm de `ctx.adminId` / `ctx.clientId` / `ctx.technicianId`, NUNCA do input
- Procedures corretas:
  - `adminLocalProcedure` — ações administrativas
  - `protectedClientProcedure` — portal cliente
  - `protectedTechnicianProcedure` — portal técnico
- Detalhes em [`docs/PROTOCOLO.md`](./docs/PROTOCOLO.md)

### 5.4 Banco de dados

- **NUNCA** `DROP TABLE` em: `clients`, `clientDocuments`, `admins`, `invites`, `workOrders`, `budgets`, `sales`, `saleItems`, `laudos`, `waterTankAlertLog`
- Migrations preferencialmente aditivas (`ADD COLUMN`, novas tabelas)
- Sempre backup antes de ALTER em produção
- Soft delete via `active=0`, não `DELETE`
- Detalhes em [`docs/DATA_PROTECTION.md`](./docs/DATA_PROTECTION.md)

### 5.5 Migrations Drizzle — cuidados especiais

- Arquivos gerados pelo Drizzle Kit contêm `--> statement-breakpoint` que **NÃO é SQL válido**
- ~~`grep -v "statement-breakpoint"`~~ **NÃO é confiável** — quando os marcadores estão inline (mesma linha do SQL), o `grep -v` descarta o statement inteiro junto com o marcador
- **Método correto:** `sed 's|--> statement-breakpoint||g' arquivo.sql | mysql ...` — remove apenas o texto do marcador, preserva o statement
- Quando aplicado via pipe, **multi-statements (FK + INDEX) podem ser ignorados silenciosamente** — sempre validar `information_schema.TABLE_CONSTRAINTS` e `information_schema.STATISTICS` após aplicar
- `__drizzle_migrations` está VAZIA — tudo foi sempre aplicado manualmente, NUNCA via `drizzle-kit migrate`
- Duas pastas com migrations (`drizzle/` e `drizzle/migrations/`) — numeração colide. Antes de criar migration nova, verificar próximo número global disponível

---

## 6. Comandos comuns

### Backup do banco (antes de qualquer ALTER em produção)

```bash
mysqldump -h 69.6.213.57 -u <user> -p \
  --routines --triggers --single-transaction --no-tablespaces \
  <database> > /var/backups/<dir>/backup-pre-<descricao>-$(date +%Y%m%d-%H%M%S).sql
chmod 600 /var/backups/<dir>/backup-pre-*.sql
```

### Deploy staging

```bash
cd /var/www/soluteg-staging
git pull origin multi-tenant
pnpm install
pnpm run build
pm2 restart soluteg-staging --update-env
```

### Deploy produção

```bash
cd /var/www/soluteg/backend
git pull origin master
pnpm install
pnpm run build
pm2 restart soluteg-sistema --update-env
```

### Aplicar migration multi-statement

```bash
# MÉTODO CORRETO — sed remove apenas o texto do marcador, preserva o statement
sed 's|--> statement-breakpoint||g' <arquivo>.sql | \
  mysql -h 69.6.213.57 -u <user> -p <database>

# NÃO usar grep -v: quando os marcadores estão inline (mesma linha do SQL),
# o grep -v descarta o statement inteiro junto com o marcador.

# IMPORTANTE: validar depois com information_schema, porque FKs e índices
# pós-CREATE TABLE podem não ser aplicados pelo pipe
```

### Validação pós-migration

```sql
-- Conferir collation das tabelas
SELECT TABLE_NAME, TABLE_COLLATION FROM information_schema.TABLES
WHERE TABLE_SCHEMA = '<database>' AND TABLE_NAME IN (...);

-- Conferir constraints (FKs, UNIQUEs)
SELECT TABLE_NAME, CONSTRAINT_NAME, CONSTRAINT_TYPE
FROM information_schema.TABLE_CONSTRAINTS
WHERE TABLE_SCHEMA = '<database>' AND TABLE_NAME IN (...);

-- Conferir índices
SELECT TABLE_NAME, INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = '<database>' AND TABLE_NAME IN (...)
GROUP BY TABLE_NAME, INDEX_NAME;
```

---

## 7. Convenções

### Commits (conventional commits)

```
feat(escopo): descrição curta

Detalhes opcionais em parágrafos.
```

Para sub-fases multi-tenant, use escopo `multi-tenant/X.Y.Za`:
```
feat(multi-tenant/3.7.1c): adiciona tenantId nullable em tabelas existentes
```

### Idioma

- Código: variáveis em inglês
- Comentários, docs e commits: **português**

### Documentos novos

- Devem ser legíveis por leigo
- Incluir propósito, decisões tomadas, trade-offs
- Atualizar a data e versão se já existia

---

## 8. Protocolo ao final de cada sub-fase

**Atualizar, em commit único:**

1. [`ROADMAP.md`](./ROADMAP.md) — marcar sub-fase como concluída
2. [`ARCHITECTURE_HANDOFF.md`](./ARCHITECTURE_HANDOFF.md) — seção 8 (O que foi feito) e seção 7 (Roadmap)
3. [`PENDENCIAS_DEPLOY_PRODUCAO.md`](./PENDENCIAS_DEPLOY_PRODUCAO.md) — se houver coisa nova para replicar em produção
4. Este arquivo (`CLAUDE.md`) — seção 2 "Estado atual"

---

## 9. Como interagir com Thiago

- **Diagnóstico antes de solução** — investigue, não chute
- **Explicações honestas de trade-offs** — não venda a solução, apresente os custos
- **Etapas pequenas** — 3h/dia não comporta refactors monstruosos
- **Causa raiz** — quando algo der errado, ele quer entender o porquê
- **Segurança é prioridade absoluta** — em dúvida, caminho conservador
- **Em português** brasileiro, sempre

### Atenção especial: o irmão arquiteto está chegando

A partir de 15/05/2026, Thiago vai envolver o irmão (arquiteto de software experiente) no projeto. Por isso a documentação foi consolidada e o `ARCHITECTURE_HANDOFF.md` foi criado. Antecipe perguntas que um arquiteto sênior faria: trade-offs, dívida técnica, decisões reversíveis vs não-reversíveis, observabilidade, testes.

---

## 10. Dívida técnica conhecida (não bloqueante para o multi-tenant)

- Migrations caóticas (duas pastas, numeração colide, `__drizzle_migrations` vazia)
- Sem testes automatizados
- WhatsApp Web.js frágil (`detached Frame`, risco de banimento)
- Backup manual, não automatizado
- Bundle frontend 2.4MB minificado
- JWT único, sem refresh, sem revogação ativa, sem 2FA
- Coupling JNC ↔ Soluteg (strings hardcoded em vários lugares)

Detalhes e plano em [`ARCHITECTURE_HANDOFF.md`](./ARCHITECTURE_HANDOFF.md) seção 10.

---

## 11. Onde encontrar mais

| Pergunta | Documento |
|----------|-----------|
| Visão técnica completa | [`ARCHITECTURE_HANDOFF.md`](./ARCHITECTURE_HANDOFF.md) |
| Status das fases | [`ROADMAP.md`](./ROADMAP.md) |
| Regras de desenvolvimento (tRPC, auth, identity) | [`docs/PROTOCOLO.md`](./docs/PROTOCOLO.md) |
| Como fazer deploy | [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) |
| Sistema de alarmes (regras de negócio) | [`docs/ALARMS.md`](./docs/ALARMS.md) |
| Regras de proteção de dados | [`docs/DATA_PROTECTION.md`](./docs/DATA_PROTECTION.md) |
| Histórico de auditorias / dívida técnica detalhada | [`docs/PENDENCIAS_TECNICAS.md`](./docs/PENDENCIAS_TECNICAS.md) |
| O que precisa replicar em produção | [`PENDENCIAS_DEPLOY_PRODUCAO.md`](./PENDENCIAS_DEPLOY_PRODUCAO.md) |
| Histórico congelado (não atualizar) | `docs/archive/` |