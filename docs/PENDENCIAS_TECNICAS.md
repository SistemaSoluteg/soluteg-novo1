# Pendências e Sugestões — Soluteg / JNC Elétrica

> Arquivo vivo — atualizado pela IA a cada sessão.
> Itens resolvidos vão para a seção ✅ com data. Novos itens entram imediatamente ao serem identificados.

---

## 🔴 Crítico — Resolver antes de qualquer nova feature

> Nenhum item crítico em aberto. Todos os CRITs (01 a 07) foram resolvidos em 2026-05-01.

---

## 🟡 Média Prioridade

> **Agendamento (quando cada item entra):** ver `ROADMAP.md` → seção "Dívidas abertas → janela de execução".

| ID | Onde | O que fazer |
|---|---|---|
| ~~SEC-01~~ ✅ FECHADO (15/08, commit `44bd66b`) | `server/index.ts` | A rota `GET /api/admin-metrics` sem auth foi **removida** e substituída por `adminMetrics.router.getDashboard` (tRPC `adminLocalProcedure`, escopado por `ctx.adminId` + `ctx.tenantId`, sem input de identidade). |
| ~~SEC-02~~ ✅ FECHADO (21/08, `baf10a5`) | `server/index.ts` | **Corrigido:** a rota resolve `adminId`/`adminTenantId` do cookie `admin_token` e guarda `clientRecord.tenantId === adminTenantId` antes de gravar. *(Contexto do que era:)* aceitava `adminId` direto do `req.body` sem validar posse (`resolvedAdminId = adminId \|\| clientRecord.adminId`). Achado na isolação do `waterTankAdmin` (14/08). O `tenantId` já é carimbado a partir do cliente real (correto), mas o `adminId`-do-body deveria vir do contexto/cliente, não do body. Baixo impacto (campo denormalizado), mas fica registrado. |
| ~~SEC-03~~ ✅ FECHADO (21/08, `baf10a5`) | `server/index.ts` | **Corrigido junto do SEC-02** (mesma rota). *(Contexto do que era:)* aceitava `clientId`/`adminId` direto do `req.body` sem validar o tenant do admin logado — mesma família do `SEC-02` (best-effort na ingestão do waterTankAdmin). Achado na revisão da arquiteta ao fechar a 3.7.2 (pós-revisão, 15/08). Deixado **fora de escopo** naquela leva de propósito; registrado como dívida. Baixo impacto (o `tenantId` real é carimbado a partir do cliente), mas o `adminId`/`clientId`-do-body deveriam vir do contexto, não do body. |
| NOTIF-01 | `server/lib/notifications.ts:223` | `notify()` insere em `notificationLogs` **sem carimbar `tenantId`** → cada log nasce NULL. Achado no backfill da 3.7.2 (16/08). **Bloqueia NOT NULL de `notificationLogs` na 3.7.1f** (por isso essa tabela fica de fora do travamento). Corrigir o carimbo (best-effort, do usuário-alvo — `notify` é chamado de vários lugares, alguns sem ctx) junto da **3.7.9**, que reescreve o fluxo de notificações. |
| ~~LAUDO-01~~ ✅ FECHADO (21/08, `67d1349`) | `server/laudosDb.ts` (`deleteLaudo`) | **Corrigido:** o cascade agora deleta `laudoCitacoes`. Validado em staging (laudo com 2 citações deletado → 0 órfãs). *(Contexto:)* o cascade limpava `laudoFotos`/`laudoMedicoes`/`laudoTecnicos` mas **esquece `laudoCitacoes`** → citações órfãs ao deletar um laudo. Achado na validação do `laudos` (16/08). Fix pontual (adicionar o delete de `laudoCitacoes` no cascade). Baixo impacto. |
| LOCK-01 | `admins`, `auditLog`, `invites`, `inspectionReports` | **Armadilha da 3.7.1f:** essas tabelas foram travadas com `tenantId NOT NULL` (16/08), mas seus writers atuais **não carimbam `tenantId`** — hoje inofensivo porque estão **mortos/inativos** (`createAdmin`/`acceptInvite`/`createInspectionReport` sem caller; `auditLog` só é escrito na 3.7.7). **Ao reativar qualquer um, o writer TEM que carimbar `tenantId`**, senão o INSERT falha contra o NOT NULL. Pontos concretos: **3.7.4** (criar admin de tenant via platformAdmin) e **3.7.7** (ativar `auditLog`). |
| LOCK-02 | `server/waterTankSensorDb.ts:12` (`upsertSensorDevice`) | Na 3.7.1f a `waterTankSensors` foi travada com `tenantId NOT NULL` + FK, mas `upsertSensorDevice()` faz `INSERT ... ON DUPLICATE KEY UPDATE` **sem `tenantId`** (auto-descoberta de sensor MQTT — GLOBAL POR DESIGN: sensor novo não tem tenant até ser atribuído). O MySQL exige que a cláusula `VALUES` do `INSERT` satisfaça o `NOT NULL` **mesmo quando cai no ramo `ON DUPLICATE KEY UPDATE`** → travar a tabela quebrou **100% da ingestão MQTT** (sensores já atribuídos incluídos). Achado em 20/08 ao religar o MQTT no staging com o broker real. Revertida pra nullable (`DROP FK` + `MODIFY tenantId INT NULL`) e validada com sensor real. **`waterTankSensors` deve ficar de fora do NOT NULL no cutover de produção** (mesma categoria do `notificationLogs`/NOTIF-01). Dívida real: carimbar `tenantId` quando o sensor já está atribuído, mantendo NULL só para o pendente. **Achado 22/08:** o script `scripts/lock-tenant-not-null-fk.ts` (commit `23aec7c`, anterior a este achado) **ainda inclui `waterTankSensors`** na lista de tabelas a travar — reproduziria o mesmo apagão se usado como está. Corrigir antes de qualquer novo uso (rastreado no `docs/RUNBOOK_CUTOVER_PRODUCAO.md` §1.2). |
| VALID-01 | `GET /api/water-tank-sse` | **Validação pendente (não é bug):** o isolamento do SSE (auth 401/200) foi confirmado, mas a **propagação de nível em tempo real** não pôde ser exercitada no staging (`MQTT_DISABLED=true`). Falta um teste manual no navegador contra `tst.soluteg.com.br`, logado como cliente, numa caixa com **sensor real** mandando leitura — confirmar que o número atualiza ao vivo. Único ponto da 3.7.2 que ficou validado "por partes". |

---

## 🔵 Sugestões de Melhoria

| ID | Onde | O que fazer |
|---|---|---|
| S06 | `server/index.ts` | Configuração CORS verificada: não existe origin '*' (seguro por padrão) |
| S07 | `laudos.router.ts` | Limite de 200.000 chars já presente no Zod (verificado) |

---

## 📌 Dívida Técnica (não urgente)

### Erros TypeScript pré-existentes (não travam o build do Vite, mas poluem o IDE)

> Estes erros estavam ocultos atrás de uma cascata causada pelo caminho errado em `src/lib/trpc.ts`.
> Foram revelados em 2026-05-02 ao corrigir o caminho. Não afetam o funcionamento em produção.

| Arquivo | Linha | Erro | Correção |
|---|---|---|---|
| Vários (`AdminClients`, `AdminMassMessage`, `AdminWaterTanks`, `AdminWaterTankDashboard`, `EditClient`) | múltiplas | `.isLoading` não existe — tRPC v11 renomeou para `.isPending` | Substituir `.isLoading` por `.isPending` em todas as mutations |
| `src/App.tsx` | 29 | `Cannot find module './pages/AdminViewWorkOrder'` | Verificar se o arquivo foi deletado ou renomeado |
| `src/pages/AdminLaudoForm.tsx` | 534, 708 | Tipo `Constatacao[]` incompatível | Alinhar tipo do estado com o tipo Zod do input |
| `src/pages/TecnicoLaudoForm.tsx` | 616 | Mesmo que acima | Mesma correção |
| `src/pages/AdminWorkOrders.tsx` | 64, 163 | Enum de tipo/prioridade desatualizado | Alinhar com os enums do `workOrders.router.ts` |
| `src/pages/BudgetApproval.tsx` | 62 | `res` implicitly has `any` type | Tipar o parâmetro do callback |
| `src/pages/WaterTankMonitoring.tsx` | 356 | `Date` vs `string` no array de alertas | Converter `sentAt` para string ou ajustar o tipo |
| `server/pdfGenerator.ts` | 424, 590, 591, 679, 984 | Iteração de Set + type errors | Corrigir com `Array.from()` e null checks |
| `server/pdfLaudo.ts` | 295 | `fontSize` não existe em `TextOptions` | Verificar API da lib PDF usada |
| `server/waterTankAlertService.ts` | 84, 105 | Function em bloco strict + null check | Mover função para fora do bloco; adicionar null check |
| `server/whatsapp.ts` | múltiplas | Parâmetros `any` implícitos | Adicionar tipos nos callbacks |

- **App mobile:** Checklists e laudos do portal do técnico ainda não portados para o app mobile (`mobile/`)
- **Landing page Astro:** `jnc.soluteg.com.br` reservado mas o projeto Astro ainda não foi criado
- **Tabelas duplicadas:** `inspectionReports` e `reports` têm propósitos sobrepostos — consolidar futuramente
- **Migration pendente:** `migration-budget-attachments.sql` foi criada — confirmar se foi rodada em produção

---

## ✅ Resolvido

| Data | Item | O que foi feito |
|---|---|---|
| 2026-05-02 | [AG-UI-04] | Monitoramento de Caixas d'Água integrado na navegação SPA do Portal do Cliente |
| 2026-05-02 | [MED-02] | `documents.getById` protegido com `adminLocalProcedure`. `adminId` removido do input. |
| 2026-05-02 | [MED-05] | Ownership check em `citacoesTecnico.update` e `.remove` com verificação de `criadoPorTipo` (evita ID collision entre admins e técnicos) |
| 2026-05-02 | [MED-06] | Whitelist de MIME types (`image/*`, `pdf`) implementada no upload REST |
| 2026-05-02 | [MED-07] | Remoção do arquivo obsoleto `server/cloudinaryService.ts` |
| 2026-05-02 | S01 | Rate Limiting (10 req/15min) nos logins de cliente, técnico e admin (REST + tRPC adminAuth.login) |
| 2026-05-02 | S02 | Limite de 500 itens no `importBatch` (PDV) e 100 itens no `sales.create` |
| 2026-05-02 | S03 | Limite de 50 itens no `exportBatch` e 100 no `deleteBatch` (WorkOrders) |
| 2026-05-02 | S04 | Filtros de vendas no PDV migrados para SQL (`WHERE`) |
| 2026-05-01 | CRIT-06 | `resetPassword` corrigido — valida token, atualiza admin dinâmico |
| 2026-05-01 | CRIT-04 | Router `checklists` inteiro migrado para `adminLocalProcedure` |
| 2026-05-01 | CRIT-02 | `budgets.create` → `adminLocalProcedure`; approve/reject seguros |
| 2026-05-01 | CRIT-03 | Procedures de orçamentos protegidas ou com tokens opacos |
| 2026-05-01 | CRIT-05 | Remoção de `adminId` do input; usa `ctx.adminId` do token |
| 2026-05-01 | CRIT-07 | `clientProfile.uploadMyPhoto` criado para o portal do cliente |
| 2026-05-01 | MED-01 | Fallback de senha em texto puro removido |
| 2026-05-01 | MED-04 | Audit fields (`changedBy`) derivados do token JWT |
| 2026-05-01 | MED-03 | Mensagens de erro genéricas no reset de senha |
| 2026-05-01 | S05 | `crypto.randomBytes()` na geração de senhas |
| 2026-05-01 | CRIT-01 | 8 endpoints REST protegidos e IDs movidos para o token JWT |
