# Pendências e Sugestões — Soluteg / JNC Elétrica

> Arquivo vivo — atualizado pela IA a cada sessão.
> Itens resolvidos vão para a seção ✅ com data. Novos itens entram imediatamente ao serem identificados.

---

## 🔴 Crítico — Resolver antes de qualquer nova feature

> Nenhum item crítico em aberto. Todos os CRITs (01 a 07) foram resolvidos em 2026-05-01.

---

## 🟡 Média Prioridade

> Todos os itens de prioridade média identificados na auditoria inicial foram resolvidos.

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
