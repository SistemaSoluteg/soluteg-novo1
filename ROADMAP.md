# Roadmap Soluteg — Status e Próximos Passos

**Última atualização:** 13/08/2026
**Dedicação:** ~3h/dia
**Princípio:** uma fase por vez. Não pular. Não misturar.

---

## 📌 Onde estamos hoje

```
✅ Fase 1   — Alarmes funcionando
⏭️  Fase 2   — Pulada deliberadamente (hardware definido fora do código)
✅ Fase 3   — Portal técnico PWA offline
🟡 Fase 3.6 — Web Push (infra pronta, ativação adiada para após multi-tenant)
🟡 Fase 3.7 — Multi-tenant (EM ANDAMENTO — 3.7.2 em andamento: fundação + piloto `technicians` concluídos)
⏳ Fase 4   — Validação comercial
⏳ Fase 5   — Landing page comercial soluteg.com.br
```

---

## ✅ FASE 1 — Alarmes funcionando

**Status:** Concluída.

Sistema de alertas de caixa d'água operacional em campo:
- Detecção via sensores ESP32 + JSN-SR04T
- WhatsApp como canal primário, email como fallback
- Auto-criação de OS emergencial em níveis críticos
- Auto-atribuição de técnico
- Cooldown e retry queue implementados

Detalhes técnicos: [`docs/ALARMS.md`](./docs/ALARMS.md).

---

## ⏭️ FASE 2 — Hardware

**Status:** Pulada deliberadamente. Definição feita em paralelo, fora do código.

---

## ✅ FASE 3 — Portal técnico PWA offline

**Status:** Concluída e validada em campo.

Sub-fases 3.1 a 3.5 todas entregues:
- PWA instalável
- IndexedDB para cache offline
- Sync queue de mutations
- Captura offline de fotos e assinaturas
- Página de status de sincronização

---

## 🟡 FASE 3.6 — Web Push notifications

**Status:** Infraestrutura pronta, ativação adiada.

- VAPID keys geradas e configuradas
- Tabelas `pushSubscriptions` e `notificationLogs` criadas
- Estratégia decidida: Push primário + WhatsApp fallback

**Adiado porque:** vai entrar **depois** do multi-tenant, para evitar refactor duplo.

---

## 🟡 FASE 3.7 — Refactor multi-tenant

**Status:** EM ANDAMENTO. Sub-fase 3.7.1e concluída em staging.

Visão arquitetural completa em [`ARCHITECTURE_HANDOFF.md`](./ARCHITECTURE_HANDOFF.md) seção 5.

### Sub-fases

| Sub-fase | Descrição | Status |
|----------|-----------|--------|
| 3.7.1a | Tabelas de segurança (auditLog, loginAttempts, migrationAuditLog) + helper de ambiente | ✅ Concluída |
| 3.7.1b | Tabelas centrais (tenants, platformAdmins, gestors, condominiums, notificationContacts) | ✅ Concluída |
| 3.7.1c | Adicionar `tenantId` nas tabelas existentes (nullable) | ✅ Concluída |
| 3.7.1d | Script de migração de dados (dry-run) | ✅ Concluída |
| 3.7.1e | Executar migração real + criar conta platformAdmin | ✅ Concluída |
| 3.7.2 | Isolamento de queries (helper `forTenant`) — **mais crítica** | 🟡 EM ANDAMENTO (`technicians`, `clients` e `workOrders` isolados; próximo: a definir) |
| 3.7.1f | `tenantId` NOT NULL + FKs + índices + rotacionar JWT_SECRET — **travamento final, só depois de 3.7.2** | ⏳ Pendente (após o isolamento) |
| 3.7.3 | Procedures tRPC tipadas por papel | ⏳ Pendente |
| 3.7.4 | UI portal platformAdmin | ⏳ Pendente |
| 3.7.5 | Branding dinâmico por tenant + campo `cnpj` na tabela `tenants` (pré-preencher campo documento nos modais de assinatura) | ⏳ Pendente |
| 3.7.6 | Fluxo de primeiro acesso do gestor migrado | ⏳ Pendente |
| 3.7.7 | Auditoria ativa (registrar ações sensíveis) | ⏳ Pendente |
| 3.7.8 | Testes E2E de isolamento | ⏳ Pendente |

> **⚠️ Ordem de execução alterada (05/08/2026):** o isolamento de queries (**3.7.2**) passou a vir **ANTES** do NOT NULL (**3.7.1f**) — repare que a tabela acima já reflete essa ordem, mesmo com os identificadores fora de sequência numérica. Motivo: o código da aplicação ainda **não popula `tenantId` nos INSERTs** (a coluna só aparece em `server/pdvSchema.ts`, em nenhum router). Aplicar NOT NULL agora quebraria toda criação de registro em runtime. Primeiro o **3.7.2** faz o código passar a ler e escrever `tenantId` em todo lugar; só **depois** o **3.7.1f** trava com NOT NULL + FKs + índices + rotação do JWT_SECRET.

### Decisão de arquitetura — PDV fora do multi-tenant (05/08/2026)

O **PDV (ponto de venda)** **não** será multi-tenant: fica **exclusivo da loja da JNC**. Os demais tenants terão apenas cadastro de produtos, **sem PDV**.

**Consequência:** as **6 tabelas do PDV** — `products`, `sales`, `saleItems`, `cashTransactions`, `customers`, `categories` — ficam **FORA do escopo de isolamento de queries** (3.7.2).

### Histórico recente

- **13/05/2026** — Sub-fase 3.7.1a concluída em staging. 14 divergências de schema legacy descobertas e sincronizadas. Helper `environment.ts` criado.
- **14/05/2026** — Bugfix paralelo: aprovação de orçamento via link público falhava ao gerar OS. Causa: `getBudgetByToken` sem `adminId`/`priority` no SELECT. Mergeado em master, deployado em produção (commit `51a18a7`).
- **15/05/2026** — Sub-fase 3.7.1b concluída em staging. 5 tabelas multi-tenant criadas com `utf8mb4_bin`, 4 FKs e 18 índices. Senha do banco staging rotacionada.
- **18/05/2026** — Sub-fase 3.7.1c concluída em staging. 38 tabelas operacionais receberam coluna `tenantId INT NULL`. Dados existentes intactos (29 clients, 76 workOrders, 270 products). Bug descoberto: `grep -v "statement-breakpoint"` não funciona quando os marcadores estão inline; solução documentada em `PENDENCIAS_DEPLOY_PRODUCAO.md` (`sed` em vez de `grep -v`).
- **05/08/2026** — Sub-fases 3.7.1d e 3.7.1e concluídas em staging. Script `scripts/migrate-to-multi-tenant.ts` finalizado e aplicado com `--apply`: 2 tenants criados (`jnc` id=1 e `soluteg-direto` id=2), platformAdmin Thiago Lopes criado (id=1). A Etapa 3 (popular `tenantId`) atualizou 0 linhas porque os dados já haviam sido migrados em execução `--apply` anterior (script idempotente via `WHERE tenantId IS NULL`). Estado final validado: 29 clients, 75 workOrders, 270 products — todos com `tenantId=1`, zero NULLs residuais, integridade referencial OK. ALTERs `condominiums.type` e `clients.gestorId` aplicados. Backups pré/pós em `/var/backups/soluteg-staging/`.
- **05/08/2026** — Reordenação de sub-fases: **3.7.2 (isolamento de queries) passa a vir antes de 3.7.1f (NOT NULL)**. Motivo: verificado via `grep` que o código ainda **não popula `tenantId` nos INSERTs** (a coluna aparece só em `server/pdvSchema.ts`, em nenhum router) — aplicar NOT NULL agora quebraria a criação de registros em runtime. Decidido também que o **PDV fica fora do multi-tenant** (exclusivo da JNC): as 6 tabelas de PDV (`products`, `sales`, `saleItems`, `cashTransactions`, `customers`, `categories`) saem do escopo de isolamento de queries.
- **08/08/2026** — 3.7.2 fundação concluída em staging e validada (commit `d26a26b`). Implementados: `server/_core/tenant.ts` (`forTenant`/`withTenant` fail-closed), `tenantId` no `TrpcContext` resolvido por query no `createContext`, fail-closed injetado nos 3 procedures ativos (`adminLocalProcedure`, `protectedClientProcedure`, `protectedTechnicianProcedure`). Coluna `admins.tenantId INT NULL` adicionada e backfill=1 aplicado em staging. 3 logins validados em `tst.soluteg.com.br` sem erros. Bug de infra corrigido: processo pm2 `soluteg-staging` apontava para diretório de produção; criado `ecosystem.config.cjs` no diretório correto.
- **10/08/2026** — 3.7.2 piloto `technicians` concluído. Adicionados `forTenantId`/`withTenantId` (variantes que recebem `tenantId: number` direto, para uso em módulos de dados). Router `technicians` isolado: `list` filtra por tenant, `create` carimba `tenantId`, `getById`/`update`/`updatePassword`/`delete` escopados por tenant. `deleteTechnician` corrigido para filtrar por tenant também no UPDATE de workOrders (write cross-tenant eliminado). `adminId` removido do input schema de `list` e `create` — IDs sempre vêm do contexto.
- **11/08/2026** — Revisão completa da documentação e estado do projeto. Próximo passo confirmado: escalar o isolamento de queries da sub-fase 3.7.2 para os demais routers.
- **11/08/2026** — 3.7.2 router `clients` isolado (commit `91e0403`). `list`/`broadcastMessage` passam a filtrar por `getClientsByTenant(ctx.tenantId)`; `create` carimba `tenantId` via `withTenant`; `getById`/`getByUsername`/`update`/`updatePassword`/`delete` ganharam guarda `client.tenantId !== ctx.tenantId → NOT_FOUND` (nenhum tinha checagem antes); `equipment.list`/`equipment.add` trocaram guarda de `adminId` para `tenantId`; `equipment.remove` ganhou guarda multi-etapa nova (equipamento → clientId → cliente → tenantId), corrigindo um IDOR pré-existente onde qualquer admin logado podia remover equipamento de qualquer cliente/tenant só sabendo o ID. `getClientByUsername` continua global (login do cliente não passa pelo router). Confirmado via `scripts/migrate-to-multi-tenant.ts` que `client_equipment` não está entre as 38 tabelas com `tenantId` — não tem a coluna, por isso o guard em duas etapas. `pnpm run check`: mesmos 33 erros pré-existentes de antes da mudança, zero novos.
- **12/08/2026** — Consolidação da nomenclatura e da metodologia de validação usadas nos dois routers isolados até aqui: **Método A** (`technicians`) = filtro direto na query via `forTenantId`/`withTenantId`, usado quando o router acessa dados por um helper isolado; **Método B** (`clients`) = guarda no router após buscar via `server/db.ts`, usado quando o dado é lido por uma função compartilhada por vários arquivos (não dá pra mudar a assinatura sem quebrar quem mais chama). Todo router isolado passa por **ghost-probe**: cria um registro sob outro tenant e confirma que fica invisível para o admin do JNC. Registrado também: a tabela `client_equipment` estava ausente no banco de staging (`_tst`) — schema desalinhado, não era um problema do multi-tenant em si, mas travava o boot e quebrava equipamento/upload de documento; criada e validada. Dívidas anotadas para depois: `getTechnicianById` tem `tenantId` opcional (vira obrigatório ao isolar `technicianPortal` e `workOrders`); código morto identificado durante a auditoria dos routers a remover; `3.7.1f` só entra após todos os routers isolados. Próximo router: `workOrders` (75 registros, Método B, mesmo rito de `clients`).
- **13/08/2026** — 3.7.2 router `workOrders` isolado. `workOrders.router.ts` e seus sub-routers (`tasks`, `materials`, etc.) foram isolados usando o **Método B** (guarda no router), com guardas multi-etapa para sub-recursos sem `tenantId` próprio. Duas rotas Express legadas em `server/index.ts` (`GET /api/work-orders/:id` e `POST /api/work-orders`) foram corrigidas, fechando uma brecha de vazamento de dados e uma regressão funcional (OSs criadas pelo portal do cliente ficavam órfãs). O sub-router `metrics` foi explicitamente deixado de fora do escopo e documentado como dívida técnica.

### Pendência crítica

Todas as mudanças aplicadas em staging precisam replicar em produção antes do merge `multi-tenant → master`. Checklist completo em [`PENDENCIAS_DEPLOY_PRODUCAO.md`](./PENDENCIAS_DEPLOY_PRODUCAO.md).

---

## ⏳ FASE 4 — Validação comercial

**Status:** Pendente. Pré-requisito: multi-tenant completo.

**Critério de saída:** 3-5 condomínios pagantes ativos no Soluteg (sob tenant "Soluteg Direto" ou parceiros).

### Sub-tarefas previstas

- Plano comercial (mensalidade, modelo de cobrança)
- Termo de uso + política de privacidade publicados
- DPO formal (Thiago como DPO inicial)
- Onboarding dos 5 primeiros condomínios
- Refinamento baseado em feedback real

---

## ⏳ FASE 5 — Landing comercial soluteg.com.br

**Status:** Pendente. Pré-requisito: Fase 4 com tração inicial.

Astro static site, dark theme, palette dourado (#D4A84B) + navy.

Adiado deliberadamente: não faz sentido investir tempo numa landing comercial antes de ter clientes para validar a proposta.

---

## 🔮 Pós-multi-tenant (sem fase atribuída)

- Migrar WhatsApp Web.js → Business API oficial (quando viável financeiramente)
- Backup automatizado (cron diário + S3)
- Observabilidade (Sentry, Better Uptime)
- Suite de testes (Vitest, primeiro foco em isolamento de tenant)
- Code splitting do bundle frontend (hoje 2.4MB minificado)
- Consolidação das migrations (resolver caos do `drizzle/` vs `drizzle/migrations/`)

---

## 💡 Ideias futuras (não comprometidas)

Estas ideias estão documentadas mas **não estão no roadmap ativo**. Vão à mesa quando os critérios definidos em cada documento forem atendidos.

| Ideia | Documento | Critério para reativar |
|-------|-----------|------------------------|
| Módulo Financeiro completo (ERP integrado: boletos, NFs, plano de contas, dashboard, PDV) | [`docs/futuro/MODULO_FINANCEIRO.md`](./docs/futuro/MODULO_FINANCEIRO.md) | Após Fase 4 com 3+ clientes pagantes ativos |

---

## ❌ Decisões explícitas de NÃO fazer (por enquanto)

- App nativo mobile (React Native, Expo) — PWA atende o caso técnico
- Integração com Claude/AI dentro do produto — feature de hype, sem ROI claro
- Calendário visual para técnicos — lista é suficiente
- Refinamento estético do portal admin — funcional > bonito nesta fase
- Modal de PDV específico — fluxo atual funciona
