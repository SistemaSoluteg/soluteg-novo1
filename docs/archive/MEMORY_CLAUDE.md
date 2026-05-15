# Memória do Claude — Soluteg / JNC Elétrica

> **Arquivo gerado automaticamente** em 2026-05-01.  
> Este arquivo é uma cópia legível das memórias persistentes do Claude Code para este projeto.  
> O arquivo original fica em `C:\Users\thiag\.claude\projects\...\memory\`.  
> **Não edite este arquivo manualmente** — ele pode ser sobrescrito em qualquer sessão.

---

## Índice

1. [Visão Geral do Projeto](#visão-geral-do-projeto)
2. [Feedback — Padrões de Desenvolvimento](#feedback--padrões-de-desenvolvimento)
3. [Feedback — Segurança](#feedback--segurança)
4. [Protocolo e Pendências](#protocolo-e-pendências)
5. [Histórico de Sessões](#histórico-de-sessões)

---

## Visão Geral do Projeto

### App
Sistema de gestão para empresa de serviços elétricos **JNC Elétrica**, com dois portais: admin e cliente.
- URL produção React app: **https://app.soluteg.com.br** (portais autenticados)
- URL landing page: **https://jnc.soluteg.com.br** (Astro — projeto separado, em migração)

### Domínios e deploy (2026-04-27)
- React app migrado de `jnc.soluteg.com.br` → `app.soluteg.com.br`
- `jnc.soluteg.com.br` será servido por um projeto **Astro** separado (landing page pública)
- Rota `"/"` no React redireciona para `/client/login` (via `RedirectToClientLogin` em `App.tsx`)
- `VITE_LANDING_URL=https://jnc.soluteg.com.br` no `.env` — usado em todos os links "Voltar ao site"
- Deploy no VPS: comando `deploy-jnc` executado em `/var/www/soluteg/backend`
- Repo GitHub: `JncBombas/soluteg-novo1` (atenção: typo frequente → `solueg-novo1` sem o "t")

### Stack
- **Frontend:** React 19 + TypeScript, Vite, TailwindCSS 4, Radix UI, React Query, Wouter (router), Framer Motion, Recharts, React Hook Form + Zod, Sonner
- **Backend:** Node.js + Express + tRPC (type-safe RPC), TypeScript
- **Banco:** MySQL 8 (host: 69.6.213.57) via **Drizzle ORM** — schema em `/drizzle/schema.ts`, 20+ migrations. **PDV consolidado no MySQL principal** desde 2026-04-18 (era TiDB Cloud separado)
- **Auth:** bcrypt para admin, JWT + cookies, suporte OAuth (Manus framework)

### Estrutura de pastas
```
src/pages/        # 24 rotas (admin/*, client/*, relatorios/*)
src/components/   # UI + work order components
src/contexts/     # ThemeContext (dark mode), etc.
src/hooks/        # Custom hooks
server/           # Express + tRPC routers, db.ts, services
server/routers/   # Sub-routers tRPC individuais (1 arquivo por domínio)
drizzle/          # Schema e migrations SQL
shared/           # Tipos/utils compartilhados
```

### Rotas principais
**Admin (prefixo `/gestor/`, não `/admin/`):** `/gestor/dashboard`, `/gestor/clientes`, `/gestor/work-orders`, `/gestor/work-orders/kanban`, `/gestor/orcamentos`, `/gestor/orcamentos/novo`, `/gestor/orcamentos/:id`, `/gestor/relatorios`, `/gestor/documentos`, `/gestor/profile`, `/gestor/login`  
**Cliente:** `/client/portal`, `/client/login`, `/client/profile`, `/client/water-tank`  
**Público:** `/orcamento/:token` (aprovação de orçamento sem login)  
**Relatórios:** `/relatorios/cadastro-cliente`, `/relatorios/visita-inspecao`

### Features principais
- **Work Orders:** CRUD, Kanban, dashboard de métricas, tarefas, materiais, anexos, comentários, recorrência, time tracking. Tipo enum: `rotina`, `emergencial`, `instalacao`, `manutencao`, `corretiva`, `preventiva`. Status enum: `aberta`, `aguardando_aprovacao`, `aprovada`, `rejeitada`, `em_andamento`, `pausada`, `concluida`, `aguardando_pagamento`, `cancelada`.
- **Orçamentos:** sistema separado das OS. Fluxo: `pendente → finalizado → aprovado/reprovado`. Token de aprovação público, assinatura digital, PDF próprio, geração automática de OS ao aprovar. Valores em centavos.
- **Clientes:** CRUD, portal de acesso, controle de documentos, tipos `sem_portal` / com portal
- **Mensagens em Massa:** envio WhatsApp em massa com filtro por tipo. Suporta merge tags: `{{nome}}`, `{{usuario}}`, `{{telefone}}`, `{{email}}`, `{{endereco}}`, `{{sindico}}`, `{{cnpj}}`.
- **Relatórios de inspeção:** bombas (recalque, dreno, piscina, incêndio), checklists, PDF, status (draft/completed/reviewed)
- **Documentos:** upload/download, acesso por cliente, labels customizados
- **Fotos de perfil:** admin e cliente, upload via Cloudinary

### Integrações
| Serviço | Uso |
|---|---|
| Cloudinary | Storage de imagens e PDFs |
| WhatsApp (web.js) | Notificações em tempo real |
| OpenAI | Geração/análise de relatórios |
| PDFKit | Geração de PDFs |
| Sharp | Processamento de imagens |
| AWS S3 | Storage alternativo |
| Google Maps | Geolocalização |

### Portal do Técnico
- Rota: `/technician/portal` (lista OS) e `/technician/work-orders/:id` (detalhe)
- Auth: JWT via cookie `technician_token` + `protectedTechnicianProcedure`
- Fluxo: admin atribui técnico → técnico vê OS → inicia → preenche tarefas/checklists/comentários/fotos → assina (obrigatório) → finaliza

### Fluxo de assinaturas das OS (2026-04-27)
3 campos independentes no banco (`workOrders`):
| Campo | Quem preenche |
|---|---|
| `technicianSignature` + `technicianSignedAt` | Técnico (portal técnico) |
| `collaboratorSignature` + `collaboratorName` | Admin (aba Assinaturas) |
| `clientSignature` + `clientName` | Técnico ou Admin |

### Banco — tabelas principais
`admins`, `clients`, `workOrders`, `workOrderTasks`, `workOrderMaterials`, `workOrderAttachments`, `workOrderComments`, `inspectionReports`, `reports`, `documents`, `checklists`, `users`, `budgets`, `budgetItems`, `budgetHistory`, `budgetAttachments`, `technicians`, `laudos`, `laudoFotos`, `laudoMedicoes`, `laudoTecnicos`, `normasBiblioteca`

### Módulo de Laudos Técnicos (Etapa 3 completa — 2026-04-28)
- **Rotas:** `/gestor/laudos` (lista), `/gestor/laudos/novo`, `/gestor/laudos/:id` (AdminLaudoForm) e `/tecnico/laudos/:id` (TecnicoLaudoForm)
- **Editor de Fotos:** `src/components/laudo/FotoEditor.tsx` — Dialog com Fabric.js v5 (setas, círculos, retângulos, texto) + Cropper.js v1 (recorte/zoom)
- **Modos de layout no PDF:** `normal`, `destaque`, `destaque_duplo`, `original_zoom`, `anotada`
- **PDF:** `server/pdfLaudo.ts` — geração completa com PDFKit

### Sistema de sensores de caixa d'água
- **Buffer MQTT (30s):** acumula leituras, persiste no flush. Para sensores ultrassônicos: guarda a **maior distância** (= menor nível).
- **Cache de config (TTL 5 min):** evita queries excessivas
- **Máquina de estados por sensor:** 8 tipos de alerta (alarm1, alarm2, sci_reserve, drop_step, alarm3_boia, filling, level_restored, boia_fault)
- **Signal badge:** Ao vivo (<3 min), Sem sinal (3–10 min), Fora do ar (>10 min)

### App Mobile (React Native / Expo)
- Pasta `mobile/` no mesmo repositório. Expo SDK 54 + Expo Router v4 + NativeWind v4.
- JWT salvo no SecureStore; enviado como `Authorization: Bearer <token>` em cada request tRPC

### API
- tRPC em `/api/trpc/*` — routers: `auth`, `adminAuth`, `clients`, `workOrders`, `documents`, `clientProfile`, `adminProfile`, `checklists`, `reports`, `budgets`, `waterTankAdmin`, `waterTankMonitoring`, `pdv`, `whatsapp`

---

## Feedback — Padrões de Desenvolvimento

### Commit e push: sempre em português + fazer push após commit
Mensagens de commit sempre em português, no estilo `fix:`, `feat:`, `refactor:`. Após cada commit, fazer `git push` imediatamente.  
**Por quê:** Sem o push, o usuário fica testando o código antigo e precisa fazer o push manualmente.

### Tailwind responsivo: botões no mobile
Para esconder apenas o **texto** de um botão no mobile, usar `hidden sm:inline` no `<span>` de texto — não `hidden sm:flex` no container.  
**Por quê:** `hidden sm:flex` no container esconde o botão inteiro no mobile.

### Cast para `any` em funções DB com retorno tipado
Quando uma função DB retorna um tipo específico mas o código acessa propriedades extras como `.insertId`, fazer cast do resultado para `any`.

### Busca case/accent insensitive no MySQL com Drizzle
Usar `COLLATE utf8mb4_general_ci LIKE` em vez de `like()` do Drizzle ou `LOWER() LIKE LOWER()`.

### MySQL ONLY_FULL_GROUP_BY: usar subquery
Quando o SELECT contém `FROM_UNIXTIME(FLOOR(...))` e o GROUP BY usa a mesma expressão, usar subquery:
```sql
SELECT MAX(v), bucket FROM (SELECT v, FROM_UNIXTIME(...) AS bucket FROM ...) t GROUP BY bucket
```

### MySQL INTERVAL e literais em sql`` — usar sql.raw()
MySQL não aceita bind params (`?`) dentro de `INTERVAL ? DAY`. Usar `sql.raw()` para literais numéricos e datas:
```ts
const cutoff = sql.raw(`'${date.toISOString().slice(0,19).replace("T"," ")}'`)
```

### Buffer MQTT: para sensor ultrassônico, acumular maior DISTÂNCIA
Maior distância = menor nível = leitura mais conservadora. A conversão dist→% acontece no flush.

### Nível atual no dashboard: usar leitura real, não o último ponto do gráfico downsampled
O gráfico usa `MAX(currentLevel)` por bucket. `getSensorById` deve incluir a última leitura real via subquery `ORDER BY measuredAt DESC LIMIT 1`.

### Enums Zod no router devem espelhar exatamente o enum do schema Drizzle
Ao adicionar tipos novos ao schema Drizzle, atualizar também os enums Zod nos procedures correspondentes.

### Sensores de água: invalidar SEMPRE os dois caches ao mudar config
Ao alterar configurações de um sensor, chamar **tanto** `invalidateSensorCache(deviceId)` **quanto** `invalidateSensorAlertState(deviceId)`.

### Git: sempre incluir todos os arquivos modificados no commit
Usar `git add .` antes de cada commit. Verificar `git status` e não deixar arquivos modificados de fora.

### Fabric.js: canvas deve permanecer montado ao trocar para Cropper
Em fluxos de dois passos, nunca desmontar o canvas Fabric ao exibir o Cropper. Usar `display: none` via CSS.

### pdfGenerator: seção de inspeção visual deve manter DOIS loops de detecção
Três gerações de dados coexistem — nunca remover nenhum dos dois loops ao editar a seção de inspeção visual.

---

## Feedback — Segurança

Em qualquer sessão, manter foco especial em segurança. A auditoria deve acontecer **DURANTE** a implementação, não depois.

### Regras de procedure tRPC
- `adminLocalProcedure` → obrigatório para qualquer ação administrativa. Usa `ctx.adminId` do JWT.
- `protectedClientProcedure` → portal do cliente; `ctx.clientId` vem do JWT, nunca do input.
- `protectedTechnicianProcedure` → portal do técnico; `ctx.technicianId` vem do JWT.
- `publicProcedure` → apenas para: login, aprovação de orçamento por token. **Não usar para dados de OS ou cliente.**

### Outros padrões de segurança
- Para endpoints públicos que acessam dados por ID, **sempre** usar token/slug opaco — nunca expor `id` numérico sem validação de ownership.
- Não confiar em `adminId` vindo do input do frontend — usar `ctx.adminId` do JWT.
- Credenciais hardcoded no código são proibidas. Usar variáveis de ambiente (`.env`).

### Padrões inseguros já corrigidos (referência histórica)
- `adminProfile`, `adminAuth.changePassword`, `adminAuth.updateCustomLabel`, `budgets.shareToPortal`, `budgets.sendWhatsappBudget`, `workOrders.sendToClientWhatsapp`, `workOrders.sendToAdminWhatsapp`, `workOrders.shareToClientPortal`
- Correção massiva em 2026-04-13: todos os `workOrders.*` migraram de `publicProcedure` → `adminLocalProcedure`.

---

## Protocolo e Pendências

### Arquivos criados em 2026-05-01 na raiz do projeto
- **`PROTOCOLO.md`** — Regras obrigatórias de desenvolvimento: checklist de segurança, tipos de procedure, padrões de código, fluxo de trabalho com IA, deploy
- **`PENDENCIAS.md`** — Lista viva de vulnerabilidades críticas/médias + sugestões + dívida técnica

### Vulnerabilidades críticas identificadas em 2026-05-01
| ID | Resumo |
|---|---|
| CRIT-01 | 8 endpoints REST em `server/index.ts` sem nenhuma autenticação |
| CRIT-02 | `budgets.approve` e `budgets.create` como `publicProcedure` |
| CRIT-03 | `budgets.getItems`, `exportPDF`, `reject`, `getForPortal` como `publicProcedure` com IDs sequenciais |
| CRIT-04 | Router `checklists` inteiro como `publicProcedure` — qualquer um cria/deleta checklists |
| CRIT-05 | `adminId` lido do input (não do `ctx`) em `clients.*` e `adminDocuments.list` |
| CRIT-06 | `resetPassword` hardcoded no adminId = 1 — qualquer token pode redefinir senha do admin principal |
| CRIT-07 | `clientProfile.uploadPhoto` sem auth, com `clientId` do input |

> Consultar `PENDENCIAS.md` no início de cada sessão. Corrigir itens críticos antes de novas features.

---

## Histórico de Sessões

| Data | Título |
|------|--------|
| 2026-04-23 | Rotina de início de sessão — explicação do fluxo padrão ao usuário |
| 2026-04-23 | Fix: Portal do técnico — adicionar/editar legenda das fotos das OS |
| 2026-04-23 | Diagnóstico: erro 404 no deploy GitHub Pages |
| 2026-04-24 | Consulta: viabilidade de criar app mobile com os portais do técnico e do cliente |
| 2026-04-24 | Fix: Metro bundler — blockList granular para VirtualViewExperimentalNativeComponent.js |
| 2026-04-25 | Melhoria nos checklists: merge templates de bomba, foto por item, fix perda de dados |
| 2026-04-26 | Conclusão das melhorias de checklist: PDF com tipo_bomba, ok/nok/na e insert-templates atualizado |
| 2026-04-26 | Fix pdfGenerator: restaura detecção ok/nok/na nos itens de inspeção visual |
| 2026-04-27 | Migração de domínio: React app → app.soluteg.com.br |
| 2026-04-27 | Alinhamento do fluxo de assinaturas: 3 slots independentes no PDF, aba Assinaturas no admin |
| 2026-04-27 | Compartilhamento de orçamento: dropdown unificado (WhatsApp Admin, WhatsApp Cliente, portal, link, PDF) |
| 2026-04-27 | Sistema de alertas de caixa d'água: máquina de estados, 8 tipos de alerta, tabela de ocorrências |
| 2026-04-27 | WhatsApp: reconexão manual pelo painel admin (card com status, botão reconectar e QR code) |
| 2026-04-27 | Fix portal do técnico: legendas nas fotos e visibilidade dos comentários |
| 2026-04-27 | Módulo de mensagens em massa via WhatsApp com variáveis personalizadas |
| 2026-04-28 | Fix mobile: botões de paginação misturados no rodapé |
| 2026-04-28 | Fix: remover botões "Voltar ao site" das páginas de login |
| 2026-04-28 | Etapa 3 — Editor de fotos avançado no módulo de laudos (Fabric.js + Cropper.js) |
| 2026-04-28 | Fix bugs FotoEditor: enterEditing rAF, double-click reabrir texto, etapaZoom original_zoom |
| 2026-04-29 | Diagnóstico: PDV sem acesso ao banco de dados |
| 2026-04-29 | Fix FotoEditor: foco Radix Dialog, espaço coordenadas mundo, teclado mobile, cleanup Cloudinary |
| 2026-04-30 | Fix laudos: template limpa após salvar rascunho, técnico não salva (regressão pós-migração) |
| 2026-04-30 | Etapa 5 — IA (sugerir normas e conclusão), WhatsApp para laudo finalizado, laudos na ficha do cliente |
| 2026-05-01 | Criação do PROTOCOLO.md e PENDENCIAS.md + auditoria de segurança: 7 vulnerabilidades críticas |
| 2026-05-01 | Cópia visível do MEMORY.md gerada na raiz do projeto |
