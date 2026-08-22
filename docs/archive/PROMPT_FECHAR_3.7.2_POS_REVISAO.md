# PROMPT — Fechar sub-fase 3.7.2 (pós-revisão da arquiteta)

> Cole no Claude Code do VS Code. Branch `multi-tenant`. Confirme com
> `git branch --show-current` ANTES de tocar em qualquer coisa.
> Filosofia do projeto: passos pequenos, diagnóstico antes de solução,
> segurança em primeiro lugar. **NÃO commitar/deployar sem revisão do Thiago.**
> Baseline `tsc --noEmit` = **32 erros pré-existentes**. Meta: zero NOVOS.

---

## 0. Situação

Os 7 blocos do `PROMPT_ENCERRAR_3.7.2.md` já foram implementados nesta branch
(ainda **não commitados**). A arquiteta revisou o `git diff` completo (13 arquivos
+ o script de backfill) contra a spec, e não só contra o resumo de execução.

**Veredito:** o diff está sólido. Há **1 correção obrigatória** (ordem do backfill),
**2 notas menores** (não bloqueiam) e **1 dívida nova a registrar** (fora de escopo).
Este prompt aplica a correção, encosta as notas e executa o rito de fechamento.

### O que foi VALIDADO na revisão (não precisa refazer — só entender)

- `tsc --noEmit` = **32 erros** = baseline exato → **zero novos**. Os únicos erros
  em arquivos tocados são pré-existentes e não relacionados:
  `pdfLaudo.ts:241/340` (`fontSize` em `TextOptions`, longe da linha 97 alterada)
  e `pdvBarcodeService.ts` (`bwip-js` ausente, arquivo intocado).
  ⚠️ O resumo de execução disse "31 erros" — **o número real é 32**. A meta
  ("zero novos") continua batida; só o número reportado estava errado.
- **Bloco 1 (IDOR `clientProfile.uploadPhoto`)**: guarda Método B correta,
  `TRPCError` já importado, `getClientById` existe. OK.
- **Bloco 2 (SEC-01 `/api/admin-metrics`)**: rota Express removida; novo
  `adminMetrics.getDashboard` (adminLocalProcedure) filtra por `adminId` E
  `tenantId` (ambos do JWT); front migrado para `useQuery`. OK.
- **Bloco 3 (faxina `users`/`reports`)**: routers removidos, import/registro
  fora de `routers.ts`, 8 funções órfãs removidas de `db.ts`. `getReportStats`
  (que ainda usa `reports`) mantido. OK.
- **Bloco 4 (isolar `laudos`)**: minucioso. Sub-recursos guardados via laudo pai,
  FKs de input (`clienteId`/`tecnicoId`) validadas contra o tenant,
  `sendWhatsapp`/`generatePdf` reordenados p/ guardar ANTES do trabalho pesado,
  catálogos comentados "GLOBAL POR DESIGN". **Todos** os call sites das funções
  que mudaram de assinatura no `laudosDb` foram atualizados (varredura no repo
  inteiro, não só no router). Nenhum insert direto em tabela de laudo fora do
  `laudosDb`. A guarda `carregarLaudoDoTenant` garante `laudo.tenantId: number`
  antes do PDF → `getConfiguracoesTecnico(laudo.tenantId)` nunca recebe NULL
  nesse caminho. OK.
- **Bloco 5 (portão PDV)**: `grep` confirma **0** `adminLocalProcedure` e **35**
  `pdvProcedure` no `pdv.router.ts`. Constante `PDV_TENANT_ID=1` + `pdvProcedure`
  fail-closed em `trpc.ts`. (O resumo disse "34 endpoints" — o real é **35**;
  miscontagem inofensiva.) OK.
- **Bloco 6 (push/waterTankMonitoring/SSE)**: `protectedClient/TechnicianProcedure`
  já são fail-closed em `tenantId` e o injetam no ctx → o carimbo `ctx.tenantId`
  nos inserts de push **não grava NULL**. SSE `/api/water-tank-sse` agora exige
  `requireClientAuth` e deriva `clientId` do `client_token` (não da query) —
  vazamento real fechado. Helpers de auth existem e seguem o padrão das outras
  rotas Express. OK.

---

## 1. CORREÇÃO OBRIGATÓRIA — ordem dos backfills

Arquivo: `scripts/backfill-tenant-null.ts`, array `BACKFILLS_DETERMINISTICOS`.

### O bug
O array roda **os filhos ANTES dos pais**: `laudoFotos`, `laudoMedicoes`,
`laudoTecnicos`, `laudoCitacoes` vêm **antes** de `laudos (via cliente)` e
`laudos (via OS)`.

Os backfills-filho têm `WHERE l.tenantId IS NOT NULL` (join no laudo pai). Então,
num laudo legado com `tenantId = NULL`:

1. Passo dos filhos: o join encontra o laudo, mas `l.tenantId IS NOT NULL`
   **falha** (o pai ainda é NULL) → a foto/medição **não** é atualizada.
2. Passo `laudos (via cliente/OS)`: o laudo **agora** recebe o tenant.
3. A foto/medição **continua NULL** — o passo dela já rodou.

Resultado: num único `--apply`, os filhos de laudos que precisavam de backfill
ficam órfãos (`tenantId = NULL`). O script converge se rodar duas vezes, mas foi
desenhado para rodar **uma vez** pós-deploy, exatamente sobre a população residual
(NULLs surgidos na janela da 3.7.2, antes das guardas fail-closed).

### O fix
Reordenar o array para **pais antes de filhos**: mover as duas entradas
`laudos (via cliente)` e `laudos (via OS)` para o **topo** de
`BACKFILLS_DETERMINISTICOS`, ficando nesta ordem:

1. `laudos (via cliente)`  — `laudos.tenantId ← clients.tenantId (via clienteId)`
2. `laudos (via OS)`       — `laudos.tenantId ← workOrders.tenantId (via osId)`
3. `laudoFotos`            — ← `laudos.tenantId (via laudoId)`
4. `laudoMedicoes`         — ← `laudos.tenantId (via laudoId)`
5. `laudoTecnicos`         — ← `laudos.tenantId (via laudoId)`
6. `laudoCitacoes`         — ← `laudos.tenantId (via laudoId)`
7. `pushSubscriptions (cliente)`
8. `pushSubscriptions (técnico)`

Adicionar um comentário curto no topo do array explicando **por que** a ordem
importa ("pais antes de filhos: os backfills-filho dependem de `laudos.tenantId`
já preenchido"). Não mudar o SQL de cada entrada — só a ordem.

Validação: `pnpm tsx scripts/backfill-tenant-null.ts` (dry-run) deve continuar
listando as 8 regras, agora com as duas de `laudos` no topo. Não rodar `--apply`
local — isso é passo de staging (ver seção 4).

---

## 2. NOTAS MENORES (aplicar só se for rápido e seguro; não bloqueiam)

### 2a. Cast `(trpc as any)` no `AdminDashboard.tsx`
`(trpc as any).adminMetrics.getDashboard.useQuery(...)` funciona em runtime
(o router está registrado em `routers.ts`), mas o `as any` derruba a checagem de
tipo. **Diagnosticar a causa raiz antes de mexer:** confirmar se o `trpc` do
front deriva o tipo de `AppRouter` (às vezes o helper `createTRPCReact<AppRouter>`
está tipado e o cast é desnecessário). Se remover o `as any` **não** introduzir
erro novo no `tsc`, remova. Se introduzir, **mantenha o cast** e deixe um
comentário `// TODO(tipo): AppRouter não infere adminMetrics aqui — investigar`.
Não gastar mais que 10 min nisso.

### 2b. Números no resumo de execução (só documental)
"31 erros" → o real é **32**. "34 endpoints PDV" → o real é **35**. Corrigir
esses números quando escrever a mensagem de commit / atualizar os docs, para o
histórico ficar fiel.

---

## 3. DÍVIDA NOVA A REGISTRAR (fora de escopo — NÃO corrigir agora)

`POST /api/water-tank-monitoring` (metade admin) aceita `clientId`/`adminId` do
**body** sem checar o tenant do admin — análogo ao `SEC-02` (best-effort na
ingestão do waterTankAdmin). **Não mexer nesta leva.** Apenas **registrar como
dívida** no `ARCHITECTURE_HANDOFF.md` (seção de dívida técnica), com o rótulo
`SEC-03` (ou o próximo disponível), na mesma família do SEC-02.

Também segue como dívida rastreada (já registrada): sub-router `metrics` do
`workOrders` e `SEC-02` (aberto por design).

---

## 4. RITO DE FECHAMENTO

### 4.1 Antes de commitar
- `tsc --noEmit` → confirmar **32** (zero novos).
- `git diff` completo para o Thiago revisar (ele já revisou a leva anterior; aqui
  ele revisa só o reorder do backfill + a nota 2a, se aplicada).

### 4.2 Commits — um por bloco (mensagens sugeridas)
Ordem e escopo (conventional commits, corpo em português):

1. `fix(multi-tenant/3.7.2): guarda de posse em clientProfile.uploadPhoto (IDOR)`
2. `feat(multi-tenant/3.7.2): fecha SEC-01 — admin-metrics via tRPC autenticado`
3. `chore(cleanup): remove routers mortos users/reports + 8 funcoes orfas de db.ts`
4. `feat(multi-tenant/3.7.2): isola router laudos (9o router, Metodo B)`
5. `feat(multi-tenant/3.7.2): portao pdvProcedure — PDV exclusivo do tenant 1`
6. `fix(multi-tenant/3.7.2): SSE water-tank exige auth + clientId do JWT; carimba tenantId no push`
7. `chore(multi-tenant/3.7.2): script de backfill tenantId IS NULL (pais antes de filhos)`

(Se preferir, agrupar 1/2/3/6 num commit de "hardening" e deixar 4/5/7 separados —
a decisão é do Thiago. O importante é a leva do backfill carregar o reorder.)

Lembrete de memória do projeto: **commit = push** — dar `git push origin multi-tenant`
depois dos commits (o `deploy-tst` puxa via `git pull`, então precisa estar no remote).

### 4.3 Deploy + validação em staging (nesta ordem)
```bash
cd /var/www/soluteg-staging
git pull origin multi-tenant
pnpm install
pnpm run build
pm2 restart soluteg-staging --update-env
```

**Rodar o backfill LOGO após o deploy, ANTES de validar os fluxos de laudo** — a
guarda de laudo é fail-closed, então laudos legados com `tenantId=NULL` dão 404
pro admin JNC até o backfill rodar:
```bash
# 1) dry-run: conferir as contagens de NULL por tabela
pnpm tsx scripts/backfill-tenant-null.ts
# 2) aplicar (assertStagingEnvironment protege contra rodar no banco errado)
pnpm tsx scripts/backfill-tenant-null.ts --apply
# 3) reconferir: DEPOIS deve zerar os filhos de laudo (validação do reorder)
```
Os casos **ambíguos** (`configuracoesTecnico`, `laudos residual sem cliente nem
OS`) NÃO são backfillados pelo script — ele só reporta. O Thiago decide o tenant
deles manualmente (provável tenant 1/JNC, mas não hardcodar).

### 4.4 Ghost-probes (validação de isolamento)
- **Laudos**: criar laudo sob tenant 2 no staging → invisível pro admin JNC
  (tenant 1) em `list`/`getById`/`update`/`delete` e nos sub-recursos
  (foto/medição/citação/técnico). Regressão: fluxo de laudo do próprio tenant OK,
  geração de PDF OK.
- **SSE**: `EventSource('/api/water-tank-sse')` sem cookie ou com cookie de outro
  cliente → 401 / não recebe stream de outro clientId.
- **PDV**: logar como admin do tenant 2 → qualquer `trpc.pdv.*` → FORBIDDEN;
  logar como admin JNC (tenant 1) → PDV normal (listar produtos, abrir venda,
  um relatório).
- **admin-metrics**: `curl https://tst.soluteg.com.br/api/admin-metrics?adminId=1`
  → **404** (rota removida). Dashboard logado carrega números corretos; números
  não vazam de outro tenant.
- **uploadPhoto**: como admin JNC, `uploadPhoto({ clientId: <cliente do tenant 2> })`
  → NOT_FOUND. Regressão: editar foto de cliente do próprio tenant OK.

### 4.5 Commit final de documentação (só APÓS validação em staging)
Atualizar em **um commit único**:
- `ROADMAP.md` — **3.7.2 concluída** (9 routers isolados + portão PDV + SEC-01
  fechado); próxima fase é **3.7.1f**.
- `ARCHITECTURE_HANDOFF.md` — seção 8: laudos isolado + hardening (IDOR
  clientProfile, SSE, SEC-01) + portão PDV. Seção de dívida: **PDV é
  tenant-1-only por decisão de produto, protegido por `pdvProcedure` (sem
  `tenantId` no schema, por design)**; **SEC-01 fechado**; **SEC-02 aberto por
  design**; **SEC-03 novo** (`POST /api/water-tank-monitoring` — adminId/clientId
  do body sem checar tenant); sub-router `metrics` do workOrders segue rastreado.
- `CLAUDE.md` seção 2 (Estado atual → **3.7.2 concluída**, próxima **3.7.1f**).
- `PENDENCIAS_DEPLOY_PRODUCAO.md` — replicar em produção: remoção da rota
  `/api/admin-metrics`, novo endpoint `trpc.adminMetrics.getDashboard`, e rodar
  o `backfill-tenant-null.ts` (com o mesmo cuidado de ordem) contra o banco de
  produção **depois** do deploy dos guards.

### 4.6 Próxima fase
Depois da 3.7.2 fechada: **3.7.1f** (NOT NULL + FKs + índices + rotação JWT),
precedida de um backfill final de `tenantId IS NULL` (novos NULLs podem ter
surgido em qualquer caminho ainda sem guarda — revalidar antes de travar).

---

## Checklist rápido para quem executar
- [ ] `git branch --show-current` == `multi-tenant`
- [ ] Reorder do `BACKFILLS_DETERMINISTICOS` (pais antes de filhos) + comentário
- [ ] (opcional) Investigar/remover `(trpc as any)` no AdminDashboard
- [ ] `tsc --noEmit` == 32 (zero novos)
- [ ] Trazer `git diff` para o Thiago
- [ ] Commits por bloco + `git push origin multi-tenant`
- [ ] `deploy-tst` → backfill `--apply` → ghost-probes
- [ ] Commit final de docs (ROADMAP / ARCHITECTURE_HANDOFF / CLAUDE / PENDENCIAS)
