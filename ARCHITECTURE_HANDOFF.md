# Soluteg — Documento Técnico de Arquitetura e Handoff

> **Versão:** 1.0
> **Data:** 15 de maio de 2026
> **Autor:** Thiago (com assessoria de Claude AI)
> **Audiência:** Arquiteto de software, desenvolvedores seniores, contributors técnicos
> **Status do projeto:** Em produção (JNC) | Refactor multi-tenant em andamento

---

## Índice

1. [Contexto de Negócio](#1-contexto-de-negócio)
2. [Stack Técnica](#2-stack-técnica)
3. [Infraestrutura](#3-infraestrutura)
4. [Arquitetura Atual (Single-Tenant)](#4-arquitetura-atual-single-tenant)
5. [Arquitetura Alvo (Multi-Tenant)](#5-arquitetura-alvo-multi-tenant)
6. [Decisões de Design e Trade-offs](#6-decisões-de-design-e-trade-offs)
7. [Roadmap e Status](#7-roadmap-e-status)
8. [O que foi feito até agora](#8-o-que-foi-feito-até-agora)
9. [O que vem pela frente](#9-o-que-vem-pela-frente)
10. [Dívida Técnica Conhecida](#10-dívida-técnica-conhecida)
11. [Padrões de Trabalho](#11-padrões-de-trabalho)
12. [Pontos para Revisão Arquitetural](#12-pontos-para-revisão-arquitetural)
13. [Apêndice: Glossário e Referências](#13-apêndice-glossário-e-referências)

---

## 1. Contexto de Negócio

### 1.1 Empresas envolvidas

**JNC Comércio e Serviços** — empresa familiar de serviços elétricos, hidráulicos e de bombeamento, atuante na Baixada Santista (litoral de São Paulo). Atende principalmente condomínios residenciais e empresas. Negócio tradicional, base de clientes pequena mas fiel (~30 clientes ativos).

**Soluteg** — plataforma de software desenvolvida originalmente para gerenciar a operação da JNC. Cresceu em escopo e funcionalidades a ponto de ter potencial de ser vendida como SaaS para outras empresas do mesmo nicho.

### 1.2 O problema

Hoje o Soluteg é **monolítico e single-tenant**: todos os dados pertencem implicitamente à JNC. Para virar SaaS, precisa suportar múltiplas empresas (tenants) com isolamento de dados, branding próprio, e diferentes modos de uso comercial.

Existem **dois cenários comerciais** previstos:

- **Cenário A (B2B clássico):** uma empresa de serviços (como a JNC) contrata o Soluteg para gerenciar seus clientes (condomínios). Os síndicos desses condomínios usam o portal do cliente; a empresa usa o portal admin.

- **Cenário B (B2C com técnico avulso):** um síndico contrata o Soluteg **diretamente** (sem intermediário), e indica um técnico de manutenção de sua confiança como "contato de notificação". Esse técnico **não loga** no sistema — só recebe alertas (WhatsApp/email) quando sensores disparam alarmes.

### 1.3 Características do produto

- **Portal Admin** (gestor/operacional): React, full-featured. CRUD de clientes, ordens de serviço (OS), orçamentos, PDV (vendas avulsas), estoque, técnicos, sensores de caixa d'água, laudos técnicos.
- **Portal Cliente** (síndico): React, simplificado. Visualiza suas OS, aprova orçamentos, recebe relatórios.
- **Portal Técnico** (PWA offline-capable): React. Recebe OS atribuídas, executa checklists, faz upload de fotos, captura assinatura digital, funciona offline e sincroniza depois.
- **Backend tRPC + WhatsApp + MQTT:** tRPC routers, integração WhatsApp Web.js para alertas, MQTT para receber dados de sensores ESP32 instalados em caixas d'água, geração de PDFs (OS, orçamentos, laudos).
- **Sensores físicos:** ESP32 com ultrassônico HC-SR04 medindo nível de caixa d'água, publicam via MQTT. Sistema detecta níveis críticos, dispara alarmes por zona com cooldown.

### 1.4 Restrições e contexto pessoal

Importante para entender decisões de design:

- **Equipe:** 1 desenvolvedor (Thiago), 3h/dia disponíveis em média.
- **Orçamento:** zero capital para investir. JNC paga as contas.
- **Pressão:** validação comercial precisa acontecer logo. Não há margem para over-engineering ou refactors longos sem retorno.
- **Filosofia:** preferir simplicidade testada vs novidades brilhantes. Cloudinary, MySQL, WhatsApp Web.js, MQTT são "boring tech" deliberadamente.

---

## 2. Stack Técnica

### 2.1 Frontend

- **React 19** + **TypeScript** + **Vite 7**
- **TanStack Router** (file-based routing)
- **Tailwind CSS** + componentes shadcn/ui
- **tRPC client** para chamadas ao backend (type-safe end-to-end)
- **PWA** (vite-plugin-pwa) com Workbox
- **IndexedDB** para cache offline (portal técnico)
- **Lucide React** para ícones

### 2.2 Backend

- **Node.js 22** + **TypeScript**
- **Express** como servidor HTTP
- **tRPC server** (routers organizados por domínio)
- **Drizzle ORM** com MySQL 8
- **Zod** para validação de schema
- **bcryptjs** para hash de senhas (cost 12)
- **JWT** para sessões (httpOnly cookies)
- **csurf** para proteção CSRF

### 2.3 Integrações

- **WhatsApp Web.js** (Puppeteer-based) — único serviço de alerta funcional hoje
- **MQTT** (mqtt.js) — broker hospedado, recebe dados dos sensores ESP32
- **Cloudinary** — armazenamento de imagens (fotos de OS, perfis, anexos)
- **PDFKit** — geração de PDFs server-side
- **Nodemailer** — email de fallback (pouco usado)
- **Web Push API** — push notifications via VAPID (recém implementado)

### 2.4 Build & Deploy

- **pnpm 10.4** (workspace simples, sem monorepo)
- **esbuild** para bundling do backend
- **Vite** para build do frontend
- **PM2** para process management
- **Nginx** como reverse proxy
- **Certbot/Let's Encrypt** para SSL

### 2.5 Banco de dados

- **MySQL 8.0** hospedado em servidor próprio do provedor (Hostgator VPS)
- **InnoDB**, charset **utf8mb4**, collation **utf8mb4_bin** (case-sensitive, byte-exato) — escolha deliberada para evitar problemas de comparação de strings em emails, slugs, usernames

---

## 3. Infraestrutura

### 3.1 Topologia

```
                            ┌──────────────────────────┐
                            │   Hostgator VPS Ubuntu   │
                            │                          │
                            │  Nginx (reverse proxy)   │
                            │     ↓                    │
                            │  ┌──────────────────┐    │
                            │  │ PM2 process mgr  │    │
                            │  │                  │    │
                            │  │ soluteg-sistema  │    │ porta 3000 (PROD)
                            │  │ soluteg-staging  │    │ porta 3001 (STG)
                            │  └──────────────────┘    │
                            │                          │
                            └──────────┬───────────────┘
                                       │
                                       │ TCP 3306
                                       ↓
                            ┌──────────────────────────┐
                            │   MySQL 8 (Hostgator)    │
                            │  69.6.213.57             │
                            │                          │
                            │  d5ea2e96_solutegdb  ←PROD│
                            │  d5ea2e96_tst        ←STG│
                            └──────────────────────────┘

                            ┌──────────────────────────┐
                            │  MQTT Broker externo     │
                            │  (sensores ESP32 publish)│
                            └──────────────────────────┘
```

### 3.2 Domínios

| Domínio | Aponta para | Conteúdo |
|---------|-------------|----------|
| `jnc.soluteg.com.br` | Astro static site | Landing page institucional da JNC |
| `app.soluteg.com.br` | PM2 `soluteg-sistema` :3000 | Sistema operacional (admin/client/technician portals) |
| `tst.soluteg.com.br` | PM2 `soluteg-staging` :3001 | Mesma codebase, ambiente de staging |
| `soluteg.com.br` | (planejado) | Landing comercial SaaS — não construído ainda |

### 3.3 Bancos de dados

**Produção (`d5ea2e96_solutegdb`):**
- Dados reais da JNC
- 29 clientes ativos
- 76 ordens de serviço históricas
- 270 produtos cadastrados
- User: `d5ea2e96_soluteg`

**Staging (`d5ea2e96_tst`):**
- Dump de produção (de 13/05/2026)
- Isolado por user MySQL diferente: `d5ea2e96_id_rsa` (sem acesso ao banco de produção)
- Onde todo o trabalho de multi-tenant está sendo testado antes de subir

### 3.4 Isolamento de ambientes

O staging foi explicitamente isolado de produção via flags no `.env`:

```env
PORT=3001                      # porta diferente
MQTT_DISABLED=true             # não consome MQTT (evita duplicação)
WHATSAPP_DISABLED=true         # não envia WhatsApp real
DB_NAME=d5ea2e96_tst          # banco separado
```

Código em `server/index.ts`, `server/mqttService.ts`, `server/whatsapp.ts` respeita essas flags. Há também `server/lib/environment.ts` com `assertStagingEnvironment()` que aborta scripts caso detecte `DB_NAME` de produção.

### 3.5 Backups

Backups manuais via `mysqldump` em `/var/backups/soluteg-staging/` e `/var/backups/soluteg-producao/`. Permissão `0600` (só root). **Não há backup automatizado configurado** — ver dívida técnica.

---

## 4. Arquitetura Atual (Single-Tenant)

### 4.1 Modelo de dados (simplificado)

```
┌──────────┐
│  admins  │  ← Thiago e qualquer outro admin (raro)
└──────────┘

┌──────────┐
│ clients  │  ← Síndicos/Administradoras (clientes da JNC)
└────┬─────┘
     │ 1:N
     ↓
┌────────────┐    ┌──────────────┐    ┌────────────┐
│ workOrders │────│ technicians  │    │  budgets   │
│   (OS)     │    │              │    │ (orçamentos)│
└────┬───────┘    └──────────────┘    └────┬───────┘
     │                                      │
     │ 1:N                                  │ 1:N
     ↓                                      ↓
┌──────────────────────┐         ┌──────────────────┐
│workOrderAttachments  │         │   budgetItems    │
│ workOrderPhotos      │         └──────────────────┘
│ workOrderChecklists  │
└──────────────────────┘

Sensores e alarmes:
┌─────────────────────┐    ┌──────────────────────┐
│  waterTankSensors   │────│ waterTankMonitoring  │
└─────────────────────┘    └──────────────────────┘
       │
       ↓
┌──────────────────────┐
│  waterTankAlertLog   │
└──────────────────────┘

PDV (vendas avulsas):
┌──────────┐   ┌────────────┐    ┌────────────────┐
│ products │←──│ saleItems  │←───│     sales      │
└──────────┘   └────────────┘    └────────────────┘
                                  ↑
                                  │ 1:N
                                  ↓
                          ┌──────────────────┐
                          │ cashTransactions │
                          └──────────────────┘

Laudos técnicos:
┌──────────────┐    ┌────────────────┐
│ laudoTipos   │    │ normasBiblioteca│
└──────┬───────┘    └─────────────────┘
       │
       ↓
┌──────────────┐    ┌──────────────┐
│   laudos     │←───│  laudoFotos  │
└──────────────┘    └──────────────┘
       │
       ↓
┌──────────────────┐
│ laudoCitacoes    │
│ normaTrechos     │
└──────────────────┘

Push notifications (recente):
┌──────────────────────┐    ┌────────────────────┐
│ pushSubscriptions    │    │ notificationLogs   │
└──────────────────────┘    └────────────────────┘

Auditoria (criado na 3.7.1a):
┌──────────────┐    ┌───────────────────┐    ┌─────────────────────┐
│  auditLog    │    │  loginAttempts    │    │ migrationAuditLog   │
└──────────────┘    └───────────────────┘    └─────────────────────┘
```

### 4.2 Camadas de aplicação

```
Frontend (React)
     ↓
tRPC Client (type-safe RPC)
     ↓
Express + tRPC routers (server/routers/*.ts)
     ↓
DB modules (server/budgetsDb.ts, etc) — funções que encapsulam queries Drizzle
     ↓
Drizzle ORM
     ↓
MySQL 8
```

**Não há separação formal entre domain/application/infrastructure.** É um monolito pragmático: routers chamam funções DB, funções DB usam Drizzle, Drizzle fala com MySQL. Para o tamanho do time e do produto hoje, é adequado.

### 4.3 Autenticação

- **Admin**: login via username/senha, JWT em cookie httpOnly
- **Client**: login via username/senha, JWT em cookie httpOnly separado
- **Technician**: login via username/senha, JWT em cookie httpOnly separado
- **Public budget approval**: link com token JWT de uso único, expira

Três tipos de cookie diferentes, três middlewares tRPC. Não há refresh token. Não há revogação ativa de sessão. JWT_SECRET único para todos.

### 4.4 Limitações arquiteturais conhecidas

- **Acoplamento JNC ↔ Soluteg:** UI e dados assumem que a empresa é a JNC (branding, número de WhatsApp hardcoded em `server/whatsapp.ts`).
- **`adminId` em workOrders:** referencia o admin que criou a OS, mas é usado como se fosse "dono da OS" — confunde papéis.
- **Sem `tenantId` em lugar nenhum:** tudo é implicitamente da JNC.
- **WhatsApp único:** uma única sessão de WhatsApp Web.js para todo o sistema, ligada ao número da JNC.

---

## 5. Arquitetura Alvo (Multi-Tenant)

### 5.1 Princípios

1. **Isolamento forte por tenant.** Nenhum admin de tenant pode ver dados de outro tenant. Garantido por filtro automático em toda query, não pela boa vontade do desenvolvedor.
2. **Plataforma como entidade separada.** Donos da plataforma (`platformAdmin`) são diferentes de admins de tenant. Visão global, mas explícita.
3. **Multi-tenancy via shared database + tenant_id.** Não vamos para schema-per-tenant nem database-per-tenant. Tenant_id em toda tabela operacional. Simples, performante, suficiente para a escala prevista (50–200 tenants).
4. **Soft delete via `active` flag.** Não usamos CASCADE em FKs. Exclusão é sempre lógica.
5. **Branding por tenant.** Logo, cor primária, número de WhatsApp, email de contato — tudo configurável.
6. **WhatsApp Multi-sessão (futuro).** Hoje uma sessão. Futuramente uma sessão por tenant (ou tenants compartilham se quiserem).

### 5.2 Novo modelo de dados (camadas a adicionar)

```
PLATAFORMA
┌──────────────────┐
│ platformAdmins   │  ← Donos do Soluteg (Thiago e quem mais entrar)
└──────────────────┘

TENANTS
┌──────────┐
│ tenants  │  ← JNC, Soluteg Direto, futuros parceiros
└────┬─────┘
     │ 1:N
     ↓
┌──────────┐         ┌──────────────┐
│ gestors  │←────────│ condominiums │
│(síndicos)│   N:1   │  (lugares)   │
└──────────┘         └──────┬───────┘
                            │ 1:N
                            ↓
                    ┌─────────────────────┐
                    │ notificationContacts│  ← técnicos avulsos (Cenário B)
                    └─────────────────────┘
```

### 5.3 Definição das novas tabelas

#### `tenants`
- `id` int PK
- `name` varchar(200)
- `slug` varchar(100) UNIQUE — identificador URL-friendly
- `isPlatformTenant` tinyint — flag para o tenant especial "Soluteg Direto"
- `logoUrl`, `primaryColor` (default `#D4A84B`), `whatsappNumber`, `contactEmail`, `cnpj`, `address`, `city`, `state`
- `active` tinyint default 1

#### `platformAdmins`
- Donos da plataforma, sem FK para tenant
- `id`, `name`, `email` UNIQUE, `passwordHash`, `active`, `lastLoginAt`, `mustResetPassword`

#### `gestors`
- Síndicos, administradoras, gerentes de manutenção
- `id`, `tenantId` FK, `name`, `email`, `whatsapp`, `username`, `passwordHash`
- `role` varchar — `sindico`, `subsindico`, `conselheiro`, `zelador`, `gerente_manutencao`, `administradora`, `outro`
- UNIQUE composto em `(tenantId, username)` — username único POR tenant, não globalmente
- `mustResetPassword` default 1 — gestores migrados devem trocar senha no 1º acesso

#### `condominiums`
- Lugares físicos
- `id`, `tenantId` FK, `gestorId` FK (nullable)
- `name`, `address`, `city`, `state`, `zipCode`, `units`
- `active`

#### `notificationContacts`
- Cenário B: técnicos avulsos que **não logam**, só recebem alertas
- `id`, `condominiumId` FK, `name`, `whatsapp`, `email`, `role`

### 5.4 Foreign keys e estratégia de delete

Todas as FKs com `ON DELETE NO ACTION ON UPDATE NO ACTION`. Soft delete via campo `active`. Razão: queremos manter histórico mesmo quando um gestor sai ou um tenant é desativado.

### 5.5 Plano de migração de dados existentes

Os 29 clients da JNC viram:
- 1 tenant ("JNC Comércio e Serviços") + N condominiums (1 por client, na maioria dos casos)
- 1 ou mais gestors por condomínio (deduplicando síndicos que aparecem em múltiplos clients)

Senhas dos gestores migrados ficam aleatórias (32 bytes) com `mustResetPassword=true`. Comunicação por WhatsApp para o primeiro acesso.

JWT_SECRET será **rotacionado** durante a migração para invalidar todas as sessões antigas.

### 5.6 Camada de autorização tRPC

Procedures novas serão adicionadas:

```typescript
platformAdminProcedure   // só platformAdmin loga
tenantAdminProcedure     // admin de um tenant específico
gestorProcedure          // síndico (loga no portal client)
technicianProcedure      // técnico
```

Cada procedure injeta `ctx.tenantId` (exceto platformAdmin que é cross-tenant). Toda query de tabela com `tenantId` DEVE filtrar por `ctx.tenantId` — sem confiar no developer lembrar.

### 5.7 Isolamento de queries

Estratégia escolhida: **helper centralizado** `forTenant(table, tenantId)` que retorna queries Drizzle já filtradas. Code review rejeita PRs que tocam queries sem usar o helper.

Alternativas consideradas e descartadas:
- **Row-Level Security do MySQL:** suporte fraco em MySQL 8, sem maturidade.
- **Schema-per-tenant:** complexo de operar com 100+ tenants, custo de migration cresce linear.
- **Database-per-tenant:** caro para uma operação 1-pessoa.

---

## 6. Decisões de Design e Trade-offs

### 6.1 Shared database + tenant_id

**Decisão:** uma tabela compartilhada com coluna `tenantId` em vez de schemas ou databases separados por tenant.

**Trade-offs:**
- ✅ Operação simples (1 banco, 1 backup, 1 migration)
- ✅ Performance adequada para a escala prevista (até ~200 tenants, milhares de clients por tenant)
- ✅ Queries cross-tenant possíveis quando necessário (relatórios da plataforma)
- ⚠️ Risco de vazamento se filtro de tenant_id for esquecido — mitigado pelo helper centralizado e auditoria
- ⚠️ Backup/restore não isola tenants — se um tenant pedir "apague tudo meu", é trabalho manual

### 6.2 Soft delete sempre

**Decisão:** nada de hard delete. Campo `active` em quase toda tabela.

**Trade-offs:**
- ✅ Histórico preservado (importante para LGPD e auditoria)
- ✅ Reativação simples
- ⚠️ Queries sempre precisam filtrar `WHERE active = 1` — risco de esquecer
- ⚠️ Tabelas crescem indefinidamente — mas com a escala prevista, não é problema

### 6.3 Collation `utf8mb4_bin` deliberada

**Decisão:** todas as tabelas do projeto em `utf8mb4_bin` (não a default `utf8mb4_0900_ai_ci`).

**Razão:**
- Comparação case-sensitive em emails, slugs, usernames evita bugs sutis ("JNC" vs "jnc" como slugs diferentes)
- Performance ligeiramente melhor (comparação byte-a-byte)
- Consistência com tabelas legacy que já estavam em `utf8mb4_bin`

**Trade-off:** Drizzle ORM não suporta collation por tabela no schema — precisamos editar SQL manual nas migrations. Documentado.

### 6.4 IDs `int` em vez de `bigint` ou UUID

**Decisão:** `int autoincrement` (4 bytes, ~2 bilhões de valores).

**Razão:**
- Mais que suficiente para a escala prevista
- Consistência com tabelas legacy
- UUIDs trazem overhead de 16 bytes + perda de localidade de cache + URLs feias
- Não vamos expor IDs em APIs públicas (orçamentos públicos usam token, não ID)

### 6.5 WhatsApp Web.js como canal principal de alerta

**Decisão:** continuar usando WhatsApp Web.js (via Puppeteer headless) como canal primário de alertas.

**Razão:**
- Custo zero (vs Twilio, Z-API, etc)
- Funciona com número pessoal da JNC, que já tem reputação
- Clientes preferem WhatsApp a SMS ou email

**Trade-offs:**
- ⚠️ Não-oficial. WhatsApp pode banir o número a qualquer momento.
- ⚠️ Sessão precisa de QR code para reautenticar quando cai
- ⚠️ Puppeteer é pesado em memória
- ⚠️ Stack frágil — bugs intermitentes como `detached Frame`

**Plano:** quando viável financeiramente, migrar para WhatsApp Business API oficial (Meta).

### 6.6 Cloudinary mantido

**Decisão:** Cloudinary continua sendo o storage de imagens.

**Razão:** alternativa Google Drive foi analisada e descartada por:
- Sem CDN, performance ruim em mobile
- Quotas imprevisíveis (Drive pode bloquear download por "uso comercial")
- URLs instáveis (problemas com PDFKit)
- Compartilhamento por link público vaza isolamento por tenant
- Conta pessoal vira gargalo de negócio

Cloudinary plano grátis suporta até ~20 condomínios sem custo. Pago US$89/mês cobre ~100 condomínios.

### 6.7 Cherry-pick em vez de PR para staging-isolation

**Decisão:** ajustes de staging (porta dinâmica, MQTT_DISABLED, WHATSAPP_DISABLED) vão para a branch `multi-tenant` sem PR. Quando merge na master, vão junto.

**Razão:** são "neutros" em produção (sem as flags no `.env`, comportamento é idêntico). Não justificam burocracia de PR separado.

---

## 7. Roadmap e Status

### 7.1 Fases gerais (do `ROADMAP.md`)

| Fase | Descrição | Status |
|------|-----------|--------|
| 1 | Alarmes funcionando (WhatsApp + retry queue + auto-OS) | ✅ CONCLUÍDA |
| 2 | Hardware (sensores ESP32) — feito em paralelo, fora do código | ⏭️ PULADA |
| 3 | Portal técnico PWA offline-capable | ✅ CONCLUÍDA |
| 3.6 | Web Push notifications | 🟡 INFRA PRONTA, ATIVAÇÃO ADIADA |
| 3.7 | Refactor multi-tenant | 🟡 EM ANDAMENTO |
| 4 | Validação comercial (3-5 condomínios pagantes) | ⏳ PENDENTE |
| 5 | Landing page comercial `soluteg.com.br` | ⏳ PENDENTE |

### 7.2 Detalhamento da Fase 3.7 (Multi-tenant)

| Sub-fase | Descrição | Status |
|----------|-----------|--------|
| 3.7.1a | Tabelas de segurança (auditLog, loginAttempts, migrationAuditLog) + helper de ambiente | ✅ CONCLUÍDA |
| 3.7.1b | Tabelas centrais (tenants, platformAdmins, gestors, condominiums, notificationContacts) | ✅ CONCLUÍDA |
| 3.7.1c | Adicionar coluna `tenantId` nas tabelas existentes (nullable) | ⏳ PRÓXIMA |
| 3.7.1d | Script de migração de dados (dry-run primeiro) | ⏳ PENDENTE |
| 3.7.1e | Executar migração real + criar conta platformAdmin | ⏳ PENDENTE |
| 3.7.1f | Tornar `tenantId` NOT NULL + rotacionar JWT_SECRET | ⏳ PENDENTE |
| 3.7.2 | Isolamento de queries por tenant (helper centralizado + audit) | ⏳ PENDENTE |
| 3.7.3 | Procedures tRPC tipadas (platformAdmin/tenantAdmin/gestor/technician) | ⏳ PENDENTE |
| 3.7.4 | UI: portal platformAdmin (CRUD de tenants e admins) | ⏳ PENDENTE |
| 3.7.5 | UI: branding dinâmico por tenant (logo, cor, nome) | ⏳ PENDENTE |
| 3.7.6 | Fluxo de "primeiro acesso" do gestor migrado (link WhatsApp único) | ⏳ PENDENTE |
| 3.7.7 | Auditoria ativa (registrar ações sensíveis em `auditLog`) | ⏳ PENDENTE |
| 3.7.8 | Testes end-to-end de isolamento (tenant A NÃO acessa tenant B) | ⏳ PENDENTE |

---

## 8. O que foi feito até agora

### 8.1 Sub-fase 3.7.1a — Tabelas de segurança

**Objetivo:** preparar infraestrutura de auditoria antes de mexer em dados.

**Entregue:**
- Tabela `auditLog` (eventos sensíveis: criação de tenant, login admin, mudança de senha, etc)
- Tabela `loginAttempts` (rate limiting futuro)
- Tabela `migrationAuditLog` (rastreabilidade da migração de dados)
- Helper `server/lib/environment.ts`:
  - `assertStagingEnvironment()` aborta scripts se `DB_NAME` for de produção
  - `assertProductionEnvironment()` análogo
  - `maskPhone()`, `maskEmail()`, `maskString()` para logs sem dados sensíveis

**Migração:** `drizzle/0032_illegal_shinobi_shaw.sql`

**Achado importante:** durante o push para staging, o Drizzle Kit reportou 14 divergências entre schema e banco — dívida técnica acumulada de meses (UNIQUEs não aplicados, tipos diferentes, NOT NULLs sem default).

Todas as 14 foram analisadas, classificadas como seguras, e aplicadas via `scripts/sync-schema-staging.sql`. Documentadas em `drizzle/PENDENCIAS_DEPLOY_PRODUCAO.md` para replicar em produção.

### 8.2 Sub-fase 3.7.1b — Tabelas centrais multi-tenant

**Objetivo:** criar o esqueleto do modelo multi-tenant (sem migrar dados ainda).

**Entregue:**
- 5 tabelas criadas: `tenants`, `platformAdmins`, `gestors`, `condominiums`, `notificationContacts`
- Todas com `utf8mb4_bin` (consistente com tabelas de negócio)
- 4 foreign keys (NO ACTION, soft delete via `active`)
- 18 índices (incluindo UNIQUE composto `gestors_tenantId_username_unique`)
- IDs `int autoincrement`

**Migração:** `drizzle/0033_giant_tomorrow_man.sql` + `drizzle/migrations/0042_collation_fix_audit_tables.sql`

**Problema enfrentado durante aplicação:**

O arquivo de migration gerado pelo Drizzle Kit tem marcadores `--> statement-breakpoint` que não são SQL válido. Ao tentar aplicar via `mysql < arquivo.sql`, o parser quebrou. Solução: pipe via `grep -v "statement-breakpoint"`. Mas isso aplicou apenas os CREATE TABLE — as 4 foreign keys e 17 índices que vinham depois foram silenciosamente ignorados.

Foi necessário **detectar isso via validação pós-aplicação** (comparando `information_schema.TABLE_CONSTRAINTS` e `STATISTICS` contra o esperado) e aplicar manualmente os ALTERs e CREATE INDEX faltantes.

Lição: Drizzle Kit + `mysql` CLI nativo não conversam bem. Para produção, **toda migration multi-statement deve ser aplicada via DBeaver ou script Node.js que entende `statement-breakpoint`**.

### 8.3 Isolamento staging vs produção (ortogonal ao multi-tenant)

Durante o trabalho, foi necessário garantir que o staging não interferisse em produção. Implementado:

- `PORT` dinâmica via env (staging 3001, produção 3000)
- `MQTT_DISABLED=true` no staging (evita duplicar leituras de sensores)
- `WHATSAPP_DISABLED=true` no staging (evita mandar WhatsApp para clientes reais)
- `sessions/` no `.gitignore` (sessões WhatsApp Web.js não vão para o repo)

Todos os ajustes são "neutros" para produção (sem as flags no `.env`, comportamento padrão).

### 8.4 Bugfix paralelo de aprovação de orçamento

Durante o multi-tenant, surgiu um bug crítico em produção:

**Sintoma:** aprovação de orçamento falhava ao tentar criar a OS (Ordem de Serviço) automaticamente. O `status` do orçamento mudava para "aprovado" mas a OS nunca era gerada.

**Causa raiz:** `getBudgetByToken` em `server/budgetsDb.ts` não incluía `adminId` nem `priority` no SELECT. Quando `approveBudget` tentava criar a OS, esses campos chegavam como `undefined`. Drizzle traduz `undefined` para `default`, e como `workOrders.adminId` é `NOT NULL` sem default, o INSERT falhava silenciosamente.

A função "irmã" `getBudgetById` (usada pelo fluxo de admin) já incluía esses campos — foi uma inconsistência entre dois "getters" que evoluíram em momentos diferentes.

**Fix:** 2 linhas adicionadas ao SELECT. Commit `51a18a7`, branch `fix/budget-approval`, mergeado em master e deployado em produção. Validado.

---

## 9. O que vem pela frente

### 9.1 Sub-fase 3.7.1c — Adicionar `tenantId` nas tabelas existentes

**Escopo:**
- Adicionar coluna `tenantId int` (nullable durante migração) em:
  - `clients`, `workOrders`, `budgets`, `technicians`, `waterTankSensors`, `products`, `sales`, `cashTransactions`, `laudos`, etc
- Sem FK ainda (será adicionada na 3.7.1f, após populada)
- Sem index ainda (será adicionado na 3.7.1f)

**Por que separar:** mudanças aditivas (ADD COLUMN nullable) são reversíveis e seguras. Garante que aplicação continua rodando enquanto migramos.

**Estimativa:** 30 min execução, 15 min validação.

### 9.2 Sub-fase 3.7.1d — Script de migração de dados (DRY-RUN)

**Escopo:** escrever script Node.js (`scripts/migrate-to-multi-tenant.ts`) que:

1. **Em modo DRY-RUN (default):** lê dados existentes, calcula o que faria, mostra preview, **não escreve nada**
2. Cria tenant "JNC Comércio e Serviços" (slug `jnc`)
3. Cria tenant "Soluteg Direto" (slug `soluteg-direto`, `isPlatformTenant=1`)
4. Para cada `client` da JNC:
   - Cria `condominium` correspondente
   - Identifica/deduplica `gestor` (síndico)
   - Cria `gestor` se não existe, vinculado ao tenant JNC
   - Atribui `gestorId` ao `condominium`
5. Para cada `workOrder`, `budget`, etc, popula `tenantId = jncTenantId`
6. Cria conta `platformAdmin` (Thiago) — prompt interativo pede senha
7. Registra cada ação em `migrationAuditLog`
8. Reporta totais ao final

**Em modo REAL (flag `--apply`):** mesma lógica, mas grava no banco. Usa transação MySQL onde possível. Em caso de erro, rollback.

**Estimativa:** 4-6h de desenvolvimento + 2h de testes.

### 9.3 Sub-fase 3.7.1e — Executar migração real em staging

**Escopo:**
- Backup obrigatório
- Rodar script com `--apply` em staging
- Validar contagens, integridade referencial, integridade de senhas (todos os gestores devem conseguir trocar senha)
- Smoke test do sistema: login de admin, login de cliente, abrir OS, criar orçamento

**Estimativa:** 30 min execução, 1-2h validação.

### 9.4 Sub-fase 3.7.1f — NOT NULL e JWT_SECRET

**Escopo:**
- ALTER `tenantId` para NOT NULL em todas as tabelas (depois de garantir 0 nulls)
- Adicionar FKs `tenantId → tenants.id`
- Adicionar índices em `tenantId`
- Rotacionar `JWT_SECRET` (invalidar sessões antigas)

**Estimativa:** 20 min execução, 15 min validação.

### 9.5 Sub-fase 3.7.2 — Isolamento de queries

**Escopo:** o mais sensível e crítico de todas as sub-fases.

- Criar helper `forTenant(table, tenantId)` em `server/lib/tenantScope.ts`
- Auditar **TODAS** as queries do projeto e adaptar para usar o helper
- Code review checklist: PRs que tocam queries SQL sem `forTenant` são rejeitadas
- Teste explícito: criar tenant B com dados, validar que admin JNC NÃO acessa tenant B (mesmo manipulando IDs no front)

**Estimativa:** 10-15h de auditoria + 5h de testes. **Sub-fase mais arriscada.**

### 9.6 Sub-fases 3.7.3 a 3.7.8

Detalhamento existe mas é mais especulativo nesta etapa. Resumo:

- **3.7.3:** procedures tRPC com tipos diferentes por papel (`platformAdminProcedure` etc)
- **3.7.4:** portal `platformAdmin` (CRUD de tenants)
- **3.7.5:** branding dinâmico (logo + cor por tenant no frontend)
- **3.7.6:** fluxo de primeiro acesso do gestor migrado
- **3.7.7:** ativar registro em `auditLog` para ações sensíveis
- **3.7.8:** testes E2E de isolamento

### 9.7 Pós-multi-tenant

- **Fase 4 (Validação comercial):** trazer 3-5 condomínios pagantes para validar modelo
- **Fase 5 (Landing comercial):** construir `soluteg.com.br` no estilo SaaS
- **Migração WhatsApp para Business API oficial** (quando viável)
- **Backup automatizado** (S3 ou similar)
- **Monitoramento** (Sentry, Better Uptime, etc)
- **Tests:** quase zero hoje — adicionar vitest para regressão

---

## 10. Dívida Técnica Conhecida

### 10.1 Bagunça nas migrations

Existe duas pastas com migrations SQL:
- `drizzle/` (raiz) — migrations geradas pelo Drizzle Kit + alguns SQL manuais
- `drizzle/migrations/` — SQL manuais organizados (recentes)

**Problema:** numeração colide entre as duas pastas. Existem pares de arquivos com mesmo prefixo numérico (`0030_careless_vermin.sql` + `0030_work_order_technician_flow.sql`, idem `0032`, `0033`). O Drizzle Kit só "enxerga" os do `_journal.json` — todas as migrations manuais são invisíveis para ele.

**`__drizzle_migrations` table está vazia** no banco. Nenhuma migration foi aplicada via `drizzle-kit migrate` — sempre aplicada manualmente via SQL.

**Consequências:**
- `drizzle-kit push` é perigoso (tentaria reaplicar tudo)
- Histórico de aplicação só existe na mente do desenvolvedor
- Risco de pular migration ao subir produção

**Plano:** consolidar tudo em `drizzle/migrations/` com numeração linear. Registrar no journal as que foram aplicadas. Fazer em sub-fase dedicada (não bloqueante para multi-tenant).

### 10.2 Sem testes automatizados

Não há suite de testes. Bugs são detectados em staging ou produção. Para multi-tenant, isso é particularmente arriscado — vamos precisar adicionar pelo menos testes de isolamento (tenant A não vê tenant B) na sub-fase 3.7.8.

### 10.3 WhatsApp Web.js frágil

Bugs intermitentes:
- `detached Frame` — Puppeteer perde referência, requer restart do PM2
- `No LID for user` — algum problema interno do WhatsApp, intermitente
- Sessão expira sem aviso, requer QR code novamente

**Plano:** migrar para WhatsApp Business API oficial quando houver receita.

### 10.4 Backup manual

Não há cron de backup automatizado. Backups são feitos sob demanda via `mysqldump` antes de mudanças críticas. Em caso de incidente fora dessas janelas, perda é total desde o último backup manual.

**Plano:** cron diário com retenção 30 dias, replicação para S3.

### 10.5 Frontend bundle gigante

`dist/assets/index-XXXXXXXX.js` tem 2.4MB minificado (600KB gzipped). Code splitting é warning do Vite há meses. Não é crítico (clientes carregam uma vez e cacheiam) mas atrapalha first-load mobile.

**Plano:** dynamic imports nas rotas pouco usadas (PDV, laudos).

### 10.6 Coupling JNC ↔ Soluteg

Há strings hardcoded com "JNC" em diversos arquivos:
- `server/whatsapp.ts` — número de WhatsApp da JNC, formato do litoral
- Frontend — logo JNC, cor dourada
- PDFs — header "JNC Elétrica e Bombas"

Essa dívida será paga progressivamente nas sub-fases 3.7.5 (branding dinâmico) e 3.7.6 em diante.

### 10.7 Senhas/credenciais

JWT_SECRET único para todos os papéis. Sem refresh tokens. Sem revogação ativa de sessão. Sem 2FA.

**Plano:** revisar tudo isso na Fase 4 (pré-validação comercial).

---

## 11. Padrões de Trabalho

### 11.1 Branches

```
master                    ← produção
multi-tenant              ← refactor em andamento, base para sub-fases
fix/*                     ← bugfixes urgentes, baseados em master
```

Regra: bugfix em produção SEMPRE de uma branch `fix/*` baseada em master, nunca direto da `multi-tenant`. Após merge, sincronizar `multi-tenant` com `master`.

### 11.2 Commits

Padrão `conventional commits`:
- `feat(escopo): mensagem`
- `fix(escopo): mensagem`
- `chore(escopo): mensagem`
- `docs(escopo): mensagem`

Exemplo:
```
feat(multi-tenant/3.7.1b): tabelas centrais com collation utf8mb4_bin

- Cria 5 tabelas: tenants, platformAdmins, gestors, condominiums, notificationContacts
- Todas com utf8mb4_bin consistente com tabelas de negócio
- Foreign keys com NO ACTION (soft delete via campo active)
- IDs int autoincrement
```

### 11.3 Deploy

Atualmente manual via SSH no VPS:
```bash
ssh root@vps...
cd /var/www/soluteg/backend     # produção
# ou
cd /var/www/soluteg-staging     # staging
git pull origin <branch>
pnpm install
pnpm run build
pm2 restart <process-name> --update-env
```

Sem CI/CD. Sem rollback automatizado. Em caso de problema, `git checkout <commit-anterior>` + rebuild.

### 11.4 Aplicação de migrations

Manual via `mysql` CLI ou DBeaver. Para multi-statement com Drizzle, **filtrar `statement-breakpoint`** ou aplicar via DBeaver.

Sempre fazer backup antes:
```bash
mysqldump -h 69.6.213.57 -u <user> -p \
  --routines --triggers --single-transaction --no-tablespaces \
  <database> > /var/backups/<dir>/backup-pre-<descricao>-$(date +%Y%m%d-%H%M%S).sql
chmod 600 /var/backups/<dir>/backup-pre-*.sql
```

### 11.5 Ferramentas

- **VS Code** (PC) — desenvolvimento principal, usado com extensão Claude Code para bugfixes em master
- **Antigravity** (PC) — usado especificamente para o refactor multi-tenant na branch correspondente
- **SSH/Terminal** (VPS) — deploy, migrations, ops
- **DBeaver** — inspeção e queries adhoc no banco

**Regra:** uma ferramenta de IA por contexto, não misturar.

### 11.6 Documentação

- `ROADMAP.md` — fases gerais e status
- `CLAUDE.md` — contexto persistente para sessões de IA
- `PENDENCIAS_DEPLOY_PRODUCAO.md` — lista de mudanças aplicadas em staging que precisam replicar em produção
- Este documento (`ARCHITECTURE_HANDOFF.md`) — handoff para arquitetos/devs novos

---

## 12. Pontos para Revisão Arquitetural

Pontos onde **a opinião de um arquiteto sênior pode mudar decisões**, por ordem de impacto:

### 12.1 Estratégia de isolamento de tenant (alta criticidade)

A escolha por **helper centralizado `forTenant()` + code review** vs alternativas mais fortes (Row-Level Security, ABAC com policy engine, schema-per-tenant) merece revisão. Para a escala prevista (200 tenants, 5000 condomínios) é provavelmente adequado, mas a decisão é reversível só com muito esforço depois.

Pergunta para o arquiteto: **vale a pena investir em algo mais robusto desde o início**, sabendo que isolamento errado é o pior tipo de bug em SaaS multi-tenant (vazamento entre clientes)?

### 12.2 Migrations chaos

Como descrito em 10.1, o estado das migrations é caótico. **Sugestão de plano:**
1. Pausa antes da sub-fase 3.7.2
2. Renumerar e consolidar tudo em `drizzle/migrations/`
3. Popular `__drizzle_migrations` com hashes das migrations já aplicadas
4. A partir daí, todo deploy passa por `drizzle-kit migrate`

É um trabalho de 1-2 dias de risco médio. Vale fazer agora ou postergar para depois do multi-tenant?

### 12.3 Sem testes automatizados

A ausência de testes é dívida séria. Conforme o sistema cresce, **regressões silenciosas ficam cada vez mais prováveis**.

Pergunta: começar a adicionar testes durante o refactor multi-tenant (mais devagar mas mais seguro) ou postergar para a Fase 4?

### 12.4 Autenticação

JWT único, sem refresh, sem revogação ativa, sem 2FA. Para um produto que vai vender a empresas, é frágil.

Plano sugerido (não confirmado): adicionar refresh tokens + tabela `revokedTokens` + opcionalmente 2FA TOTP. Estimativa: 1-2 semanas.

### 12.5 Observabilidade zero

Sem Sentry, sem logs estruturados, sem métricas. Problemas em produção são detectados quando um cliente reclama.

Plano sugerido: Sentry (free tier suficiente) + alguns dashboards básicos (Better Uptime, Plausible).

### 12.6 WhatsApp Web.js

Não-oficial, frágil, risco de banimento. Continuamos apostando nele porque funciona e é grátis. Mas **antes da validação comercial seria prudente ter plano B operacional** (mesmo que custe dinheiro).

Sugestão: já fazer integração com Twilio ou Z-API como fallback, ativado apenas se WhatsApp Web cair.

### 12.7 Frontend bundle

2.4MB JS é muito para um SaaS B2B. Não bloqueia mas vai virar reclamação de cliente em algum momento.

### 12.8 LGPD

Hoje há campos de PII (nome, telefone, email, endereço) sem qualquer estratégia de criptografia em repouso, anonimização ou auditoria de acesso.

**Plano:** revisar antes do piloto comercial. Considerar:
- Criptografia AES-256-GCM em CPF/CNPJ (se forem armazenados)
- Política de retenção (90 dias para logs, X anos para OS, etc)
- Termo de uso + política de privacidade publicados
- DPO formal (Thiago seria o DPO inicialmente)

---

## 13. Apêndice: Glossário e Referências

### 13.1 Glossário

- **OS** — Ordem de Serviço (tabela `workOrders`)
- **Orçamento** — proposta comercial pré-OS (tabela `budgets`)
- **Gestor** — síndico, administradora ou similar (cliente "tipo manager")
- **Condominium** — lugar físico atendido
- **Tenant** — empresa cliente do Soluteg (JNC é o primeiro)
- **PlatformAdmin** — dono da plataforma Soluteg (não confundir com admin de tenant)
- **NotificationContact** — técnico avulso do Cenário B (não loga, só recebe alertas)
- **Cenário A** — B2B clássico: empresa de serviços contrata Soluteg para gerenciar seus condomínios
- **Cenário B** — B2C direto: síndico contrata Soluteg, indica técnico avulso de sua confiança
- **Sensor de caixa d'água** — ESP32 + HC-SR04 medindo distância, publicando via MQTT
- **PDV** — Ponto de Venda (vendas avulsas no balcão da JNC, tabelas `sales`/`saleItems`)
- **Laudo** — relatório técnico formal (vistorias, perícias) — tabelas `laudos`, `laudoFotos`, etc

### 13.2 Arquivos importantes do repo

```
ROADMAP.md                          ← visão geral de fases
PENDENCIAS_DEPLOY_PRODUCAO.md       ← o que precisa replicar em prod
CLAUDE.md                           ← contexto para IAs
ARCHITECTURE_HANDOFF.md             ← este documento

drizzle/schema.ts                   ← schema canônico (TypeScript)
drizzle/0033_giant_tomorrow_man.sql ← migration multi-tenant
drizzle/migrations/0042_*.sql       ← collation fix
drizzle/meta/_journal.json          ← histórico Drizzle Kit

server/index.ts                     ← bootstrap Express
server/lib/environment.ts           ← guards de ambiente
server/whatsapp.ts                  ← integração WhatsApp Web.js
server/mqttService.ts               ← integração MQTT
server/budgetsDb.ts                 ← módulo de orçamentos (onde o bug 51a18a7 estava)
server/routers/budgets.router.ts    ← router tRPC de orçamentos

src/                                ← frontend React
src/lib/offlineDB.ts                ← IndexedDB do portal técnico
src/hooks/useAutoSync.ts            ← sincronização offline
```

### 13.3 Comandos comuns

**Backup:**
```bash
mysqldump -h 69.6.213.57 -u <user> -p \
  --routines --triggers --single-transaction --no-tablespaces \
  <database> > /var/backups/<dir>/backup-<descricao>-$(date +%Y%m%d-%H%M%S).sql
```

**Deploy staging:**
```bash
cd /var/www/soluteg-staging
git pull origin multi-tenant
pnpm install
pnpm run build
pm2 restart soluteg-staging --update-env
```

**Deploy produção:**
```bash
cd /var/www/soluteg/backend
git pull origin master
pnpm install
pnpm run build
pm2 restart soluteg-sistema --update-env
```

**Aplicar migration:**
```bash
# Sem statement-breakpoint (multi-statement)
grep -v "statement-breakpoint" <arquivo>.sql | mysql -h ... -u ... -p <database>

# Single statement
mysql -h ... -u ... -p <database> < <arquivo>.sql

# Via comando direto
mysql -h ... -u ... -p <database> -e "ALTER TABLE ..."
```

### 13.4 Variáveis de ambiente importantes

```env
# Banco
DB_HOST=69.6.213.57
DB_NAME=d5ea2e96_tst              # ou d5ea2e96_solutegdb em prod
DB_USER=d5ea2e96_id_rsa           # ou d5ea2e96_soluteg em prod
DB_PASS=<senha>
DB_PORT=3306

# Servidor
PORT=3001                          # staging; produção é 3000 (ou unset)

# Flags de isolamento (apenas staging)
MQTT_DISABLED=true
WHATSAPP_DISABLED=true

# JWT
JWT_SECRET=<256 bits hex>

# Cloudinary
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...

# Push (VAPID)
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:contato@soluteg.com.br

# SMTP (fallback)
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
```

### 13.5 Contatos e responsabilidades

- **Thiago** — único desenvolvedor, owner da JNC, owner do Soluteg
- **WhatsApp da JNC** — `(13) 98164-8402` — uso comercial + auth WhatsApp Web.js
- **Email comercial** — `contato@soluteg.com.br`
- **Hosting** — Hostgator (VPS Linux + MySQL)
- **DNS** — gerenciado no painel do Hostgator
- **GitHub** — `https://github.com/JncBombas/soluteg-novo1` (privado)

---

## Encerramento

Este documento reflete o estado em **15 de maio de 2026**. À medida que o multi-tenant avança e novas decisões são tomadas, este documento **deve ser atualizado** — preferencialmente na mesma branch onde a mudança acontece.

Para qualquer dúvida ou sugestão, ver o `ROADMAP.md` para contexto de prioridades, ou abrir issue no GitHub.

**Próximo marco:** Sub-fase 3.7.1c — adicionar `tenantId` (nullable) nas tabelas existentes. Aguardando validação arquitetural antes de prosseguir.
