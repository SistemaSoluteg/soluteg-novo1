# Roadmap Soluteg — Status e Próximos Passos

**Última atualização:** 16/08/2026
**Dedicação:** ~3h/dia
**Princípio:** uma fase por vez. Não pular. Não misturar.

---

## 📌 Onde estamos hoje

```
✅ Fase 1   — Alarmes funcionando
⏭️  Fase 2   — Pulada deliberadamente (hardware definido fora do código)
✅ Fase 3   — Portal técnico PWA offline
🟡 Fase 3.6 — Web Push (infra pronta, ativação adiada para após multi-tenant)
🟡 Fase 3.7 — Multi-tenant (EM ANDAMENTO — 3.7.2 CONCLUÍDA: 9 routers isolados incl. `laudos`; SEC-01 fechado, SSE/pdv/pushSubscriptions cobertos, users/reports removidos. Próximo: 3.7.1f)
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
| 3.7.2 | Isolamento de queries (helper `forTenant`) — **mais crítica** | ✅ Concluída (9 routers isolados incl. `laudos`; `clientProfile.uploadPhoto` + SEC-01 + SSE + `pdvProcedure` + `pushSubscriptions` cobertos; `reports`/`users` removidos. Falta só validar em staging os últimos commits) |
| 3.7.1f | `tenantId` NOT NULL + FKs + índices + rotacionar JWT_SECRET — **travamento final, só depois de 3.7.2** | 🟡 PRÓXIMA (isolamento concluído — desbloqueada; script de backfill iniciado) |
| 3.7.3 | Procedures tRPC tipadas por papel | ⏳ Pendente |
| 3.7.4 | UI portal platformAdmin | ⏳ Pendente |
| 3.7.5 | Branding dinâmico por tenant + campo `cnpj` na tabela `tenants` (pré-preencher campo documento nos modais de assinatura) | ⏳ Pendente |
| 3.7.6 | Fluxo de primeiro acesso do gestor migrado | ⏳ Pendente |
| 3.7.7 | Auditoria ativa (registrar ações sensíveis) | ⏳ Pendente |
| 3.7.8 | Testes E2E de isolamento | ⏳ Pendente |
| 3.7.9 | Notificações por tenant (WhatsApp multi-instância + Email + Templates editáveis) — **depois do isolamento 3.7.2** | ⏳ Pendente |

> **⚠️ Ordem de execução alterada (05/08/2026):** o isolamento de queries (**3.7.2**) passou a vir **ANTES** do NOT NULL (**3.7.1f**) — repare que a tabela acima já reflete essa ordem, mesmo com os identificadores fora de sequência numérica. Motivo: o código da aplicação ainda **não popula `tenantId` nos INSERTs** (a coluna só aparece em `server/pdvSchema.ts`, em nenhum router). Aplicar NOT NULL agora quebraria toda criação de registro em runtime. Primeiro o **3.7.2** faz o código passar a ler e escrever `tenantId` em todo lugar; só **depois** o **3.7.1f** trava com NOT NULL + FKs + índices + rotação do JWT_SECRET.

### Sub-fase 3.7.9 — Notificações por tenant (planejada em 16/08/2026)

Hoje o envio é **global e da JNC**: um único cliente `whatsapp-web.js` ([`server/whatsapp.ts`](./server/whatsapp.ts)) com o número da JNC **hardcoded** (`5513981301010` em `sendWhatsappAlert`/`sendWhatsappAlertWithPDF`) e uma única sessão `./sessions`; SMTP único por env ([`server/emailService.ts`](./server/emailService.ts)); e as mensagens automáticas são montadas **inline** em ~15 call sites (OS, orçamento, caixa d'água, laudos, portal). Esta sub-fase transforma isso em **config por tenant**: cada tenant usa o próprio WhatsApp e email, e edita as próprias mensagens automáticas.

**Decisões tomadas (16/08/2026):**
- **WhatsApp:** abstração `WhatsappProvider` + implementação `wwebjs` multi-instância agora, com brecha (seam) pra plugar a Cloud API oficial da Meta por tenant depois. Reversível, sem custo, escala para os poucos tenants do curto prazo. (Alternativas descartadas por ora: Cloud API já — onboarding Meta pesado + custo + templates aprovados conflitam com "tenant edita msg livre"; wwebjs sem abstração — travaria numa tecnologia só.)
- **Sequência:** entra **depois** que o isolamento de queries (3.7.2) estiver completo, para não competir com o foco atual.
- **Templates:** tabela de templates por tenant com defaults + placeholders (não hardcode inline).

**Partes:**

- **3.7.9a — Config de envio por tenant.** Tabela `tenantNotificationSettings` (1:1 com `tenants`): `whatsappEnabled`, `whatsappAdminNumber` (substitui o número hardcoded), `whatsappProvider` (`'wwebjs' | 'cloud-api'`), e credenciais SMTP (`host/port/user/pass/from` + destinatários de admin). **Segredos criptografados at-rest** e nunca retornados em leitura (mascarados). Email passa a ser por tenant com cache de transporter. *(As colunas `tenants.whatsappNumber`/`contactEmail` que já existem são só de identidade/exibição — não são a infra de envio.)*
- **3.7.9b — WhatsApp multi-instância com abstração.** Interface `WhatsappProvider` (`sendText`, `sendPdf`, `getStatus`, `reconnect`) → `WwebjsProvider` (um `Client` com `LocalAuth` em `./sessions/tenant-${id}`) → `WhatsappManager` (`Map<tenantId, provider>`, init preguiçoso só de tenants ativos com `whatsappEnabled`). As 4 funções de `whatsapp.ts` passam a receber `tenantId`; os ~15 call sites propagam (`ctx.tenantId` nos routers; `tenantId` do registro nos jobs/sensores). QR por tenant no painel. `CloudApiProvider` fica como stub (seam), não implementado agora.
- **3.7.9c — Templates editáveis.** Tabela `messageTemplates(tenantId, key, channel, subject, body, active)` UNIQUE `(tenantId, key, channel)` + renderizador central com placeholders whitelistados por template (`{{cliente}}`, `{{numeroOS}}`, `{{tecnico}}`, `{{valor}}`…). Seed com os textos atuais como default; **fallback** pro default Soluteg quando o tenant não editou. Editor no painel do tenant. (Primeira tarefa da parte: enumerar as `key`s exatas a partir dos call sites.)

**Trade-offs / riscos anotados:**
- Cada Chromium do wwebjs consome ~300–500MB de RAM → teto do VPS Hostgator. Hoje só 2 tenants; política de init = só tenant ativo com `whatsappEnabled`. Monitorar RAM ao crescer.
- A fragilidade do wwebjs (`detached Frame`, risco de ban — dívida técnica conhecida) é herdada, mas o isolamento por sessão **melhora** o cenário atual: uma sessão cair não derruba as outras.
- Segredos SMTP no banco exigem cripto at-rest (chave em env) + máscara na leitura — nunca trafegar a senha de volta pro front.
- **Migração da JNC (tenant 1):** o número hardcoded vira `whatsappAdminNumber` do tenant 1; a sessão `./sessions` atual migra pra `./sessions/tenant-1` (ou re-scan do QR). JNC precisa continuar funcionando idêntico.
- Depende do `ctx.tenantId` já propagado (pronto desde a fundação da 3.7.2) e conecta com a Fase 3.6 (Web Push): o hub `notify()` ([`server/lib/notifications.ts`](./server/lib/notifications.ts)) já roteia canais — a metade WhatsApp passará a exigir `tenantId`.
- Esta sub-fase é o passo concreto que habilita a migração futura wwebjs → Business API (ver "Pós-multi-tenant"): a abstração é a brecha planejada.

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
- **15/08/2026** — **3.7.2 (isolamento) CONCLUÍDA.** 9º router `laudos` isolado (commit `3dd4d4e`, Método B, 40+ endpoints) — guarda de posse por laudo, FK-do-input (`clienteId`/`tecnicoId`), sub-recursos via laudo pai carimbando tenant, `listLaudos` fail-closed. Na mesma leva: **SEC-01 fechado** (`GET /api/admin-metrics` sem auth → `adminMetrics.router` tRPC escopado por adminId+tenantId, commit `44bd66b`); gate **`pdvProcedure`** (PDV só tenant 1, commit `833834f`); SSE **`/api/water-tank-sse`** com `requireClientAuth` + clientId do JWT (gap que a auditoria do waterTankAdmin tinha perdido); **`pushSubscriptions`** carimba `tenantId` (commit `f5759ec`); **faxina dos legados `reports`/`users`** removidos sem quebrar `ctx.user`/`auth` (commit `3d0d653`); e o **script `scripts/backfill-tenant-null.ts`** iniciado (commit `5b3e962`, cobre laudos+pushSubscriptions determinístico). `tsc` 32, zero novos. **Pendente:** validação em staging de `laudos`/SSE/`adminMetrics`/`pdvProcedure` (commitados/deployados, mas sem ghost-probe/regressão registrados) e estender o script de backfill para as demais tabelas antes da 3.7.1f.
- **14/08/2026** — 3.7.2 router `waterTankAdmin` isolado e **validado em staging** (commit `8c4e069`). Fechou o IDOR mais grave da sub-fase: `adminId` vinha do input e era confiado (dava pra forjar adminId de outro tenant). Duas metades: **admin** (tRPC, fail-closed — adminId do ctx, filtros adminId→tenantId, assignSensor valida clientId/technicianId + carimba tenant) e **ingestão MQTT/Express** (best-effort, SEM fail-closed — carimba tenantId do sensor se houver, nunca dropa leitura/alarme; risco real da Fase 1). `listPending` global por design (pool de devices). Validado ponta a ponta (servidor local × banco staging, HTTP real): ghost-probe, FK forjada, ingestão e alarme simulados. Backfill das 4 tabelas (`waterTankMonitoring`: 7.926 nulls). Achados: drift de `alertPhone2` no staging (produção OK) e `adminId`-do-body na rota Express (`SEC-02`). **Varredura dos routers restantes concluída** — sobra só o gap `clientProfile.uploadPhoto` e verificar legados `reports`/`users`/`pushSubscriptions`.
- **14/08/2026** — Faxina de código morto acumulada da 3.7.2 (só remoção, `tsc` estável em 32, sem mudança de comportamento): removidos `createWorkOrder` órfã do `db.ts`, sub-router `workOrders.timeTracking.*` + funções do aux (feature sem UI, tabela vazia mantida no banco), `inspectionTasks.complete`/`completeInspectionTask`/`areAllChecklistsComplete` (sem caller), routers de documento duplicados (`adminDocuments` + `adminProfile.adminDocuments`) e 4 funções de doc órfãs. `canComplete` **mantido** — é UI viva (botão "Concluir Tarefa"), não código morto (correção de um engano de diagnóstico).
- **14/08/2026** — 3.7.2 routers `technicianPortal` (commit `4a35ab1`) e `documents` (commit `6997ef6`) isolados e **validados em staging**. `technicianPortal` já era seguro por posse do técnico (`getWorkOrderByIdForTechnician`); a leva fechou o acúmulo de `tenantId=NULL` nas 5 sub-tabelas de OS (`tasks`/`materials`/`attachments`/`comments`/`timeTracking`) — fail-closed nas 5 `createX` do `workOrdersAuxDb` + 9 call sites carimbando (achado que passou batido no `workOrders`). `documents`: `clientDocuments` isolado em 3 routers + rota Express, vários IDORs fechados (`getById`/`delete`/`update`/`updateFile`), e corrigido vazamento total no `listAll` (filtro `adminId` estava no tipo mas nunca era aplicado). Duplicação de routers de documento (`adminDocuments` ≡ `adminProfile.adminDocuments`, sem caller no front) e código morto (`timeTracking`, `inspectionTasks.complete`, `canComplete`, `createWorkOrder` órfã) anotados para faxina. Fixes paralelos: `osNumber` no retorno de `workOrders.create` (toast "OS undefined"; baseline do tsc 33→32) e componente `PasswordInput` (olho de mostrar/ocultar em 11 campos). Ghost-probes cross-tenant OK nos dois routers; baseline tsc 32, zero novos.
- **14/08/2026** — 3.7.2 router `checklists` isolado e **validado em staging** (commit `88e4a85`, Método B). `templates.*` **globais por design** (`checklistTemplates` não tem `tenantId` — catálogo compartilhado); `inspectionTasks`/`checklistInstances` com guarda de posse (via OS pai ou `tenantId` do próprio registro); `createInspectionTask`/`createChecklistInstance` com `tenantId` obrigatório + fail-closed. 3 caminhos de escrita cobertos: router admin, `technicianPortal.addChecklist` (técnico em campo) e `monthlyOsJob` (cron). Ghost-probe cross-tenant OK (`getById` de task do tenant 2 → NOT_FOUND, task do JNC OK); regressão do fluxo admin (criar OS → checklist → preencher → salvar) OK; 0 órfãos de checklist no staging. Faxina separada (junto): removidos 9 arquivos de código morto (commit da limpeza) — `shared/checklistTemplates.ts` e scripts one-off de seed/infra já aplicados. Código morto ainda anotado: endpoint `inspectionTasks.complete` + `completeInspectionTask` (não chamados pelo front) e o stub `canComplete`. Nova lição: tabelas de catálogo/referência compartilhadas (templates) ficam globais por design.
- **14/08/2026** — 3.7.2 router `budgets` isolado e **validado em staging** (commit `5483c1b`, Método B). `list`/`getMetrics` por `ctx.tenantId` (adminId fora do input); guardas de posse em `getById`/`update`/`saveItems`/`getItems`/`getHistory`/`exportPDF`/`sendWhatsappBudget`/`finalize`/`rejectByAdmin`; `delete` e `shareToPortal` (que não tinham checagem nenhuma — IDOR) fechados; `create` valida posse do `clientId`; anexos com guarda multi-etapa (`getBudgetAttachmentById`). Procedures por token (`/orcamento/:token`) **permanecem globais por design** (token opaco é a credencial) — comentado no código. Sub-tabelas carimbam `tenantId`. Junto, fix de FK-do-input no `workOrders` (commit `ddc420e`): `create`/`update`/`assignTechnician` passam a validar posse de `clientId`/`technicianId` — mesma classe de IDOR (vazamento de PII via FK forjada), identificada na revisão do budgets. Ghost-probe cross-tenant OK, link público intacto, e guarda de FK confirmada contra requisição forjada (DevTools → `NOT_FOUND`). Nova lição incorporada: validar **toda FK vinda do input** contra o tenant ao isolar um router.
- **14/08/2026** — 3.7.2 `workOrders` **validado em staging** e escopo do isolamento ampliado além do router. Achados e corrigidos na revisão do diff (o `tsc` sozinho não pegava nenhum): (1) `getWorkOrderById` não trazia `tenantId` no `select`, o que fazia toda guarda comparar `undefined` e derrubaria o módulo inteiro; (2) 5 funções `getXById` que os sub-routers chamavam mas não existiam em `workOrdersAuxDb.ts`; (3) mais **3 caminhos de criação de OS** que nasciam sem `tenantId` (`workOrdersRecurrence`, e `budgets.router` em `approve`/`generateOs`, via `budgetsDb` que não selecionava `tenantId`). Adicionada **guarda fail-closed** dentro de `workOrdersDb.createWorkOrder` (lança se `tenantId` ausente) — que por sua vez expôs mais 3 call sites de sistema (`monthlyOsJob` 2x e `waterTankAlertService`), corrigidos. Lição de processo: ao isolar um router, fazer `grep` por **todos** os pontos de escrita da tabela (incluindo chamadas sem prefixo de módulo e rotas Express fora do tRPC), não só o router. Validação em `tst.soluteg.com.br`: ghost-probe cross-tenant OK (OS do tenant 2 invisível ao JNC na `list` e no `getById`), regressão JNC (CRUD + equipamento→OS mensal) OK, e backfill de 1 OS órfã (`tenantId=NULL`) criada por teste manual na janela entre a migração e o deploy da guarda — `UPDATE ... WHERE tenantId IS NULL`, 0 nulls depois. `metrics` segue como dívida técnica adiada; `GET /api/admin-metrics` sem auth registrado como `SEC-01` em `docs/PENDENCIAS_TECNICAS.md`.

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

- Migrar WhatsApp Web.js → Business API oficial (quando viável financeiramente) — a **sub-fase 3.7.9** já deixa o seam pronto (`WhatsappProvider` + campo `whatsappProvider` por tenant): trocar wwebjs por Cloud API vira uma implementação nova do provider, sem tocar nos call sites
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
