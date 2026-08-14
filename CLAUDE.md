# CLAUDE.md — Contexto Operacional do Projeto Soluteg

> Este arquivo é lido automaticamente por IAs de codificação (Antigravity, Claude Code) ao abrir o projeto.
> Contém o **contexto operacional vivo** — o que está sendo feito agora, regras invioláveis, comandos comuns.
> Para visão arquitetural completa, ver [`ARCHITECTURE_HANDOFF.md`](./ARCHITECTURE_HANDOFF.md).

**Última atualização:** 13/08/2026 (workOrders isolado, próximo router a definir)

---

## 1. O projeto em 60 segundos

**Soluteg** é um sistema de gestão para empresas de serviços técnicos (elétrica, hidráulica, bombeamento). Hoje em produção para a **JNC Elétrica** (Baixada Santista, SP). Está sendo transformado em SaaS multi-tenant.

**Stack:** React 19 + Vite + TypeScript (frontend) | Node.js + Express + tRPC + Drizzle ORM (backend) | MySQL 8 | WhatsApp Web.js + MQTT (sensores ESP32) + Cloudinary | PM2 + Nginx em VPS Hostgator.

**Time:** 1 desenvolvedor (Thiago), 3h/dia. Filosofia: simplicidade testada, sem over-engineering.

**Modelo de negócio futuro:** dois cenários:
- **Cenário A (B2B):** empresa de serviços contrata Soluteg para gerenciar seus condomínios (caso JNC)
- **Cenário B (B2C):** síndico contrata direto, indica técnico avulso que recebe alertas sem logar

---

## 2. Estado atual (12/08/2026)

### Em andamento
**Fase 3.7 — Refactor multi-tenant.** Branch `multi-tenant`. **Sub-fase 3.7.2 (Isolamento de queries) em andamento — 3 routers isolados (`technicians`, `clients`, `workOrders`).**

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
- ✅ Sub-fase 3.7.2 (Escala, router 3/N): Router `workOrders` e rotas Express legadas associadas foram 100% isolados por tenant. Corrigidas múltiplas vulnerabilidades de vazamento de dados e escrita cross-tenant. Sub-router `metrics` adiado e documentado como dívida técnica.

### Próxima
**Sub-fase 3.7.2 (Escala, router 4/N):** Isolar o próximo router (a ser definido com Thiago).

Rito de sempre: prompt para a IA do terminal (Antigravity) → revisão do diff com o Thiago → `deploy-tst` → validação com ghost-probe.

**Dívidas técnicas anotadas (sem pressa):**
- `getTechnicianById` tem `tenantId` opcional — vira obrigatório quando `technicianPortal` e `workOrders` forem isolados.
- Código morto a remover (identificado durante a auditoria dos routers).
- `3.7.1f` (NOT NULL + FKs + índices) só entra depois que **todos** os routers estiverem isolados.

### Roadmap restante (resumo)
3.7.2 (escalar isolamento) → 3.7.1f (NOT NULL + rotação JWT) → 3.7.3 a 3.7.8.

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