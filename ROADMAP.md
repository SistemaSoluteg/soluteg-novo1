# Roadmap Soluteg — Status e Próximos Passos

**Última atualização:** 18/05/2026
**Dedicação:** ~3h/dia
**Princípio:** uma fase por vez. Não pular. Não misturar.

---

## 📌 Onde estamos hoje

```
✅ Fase 1   — Alarmes funcionando
⏭️  Fase 2   — Pulada deliberadamente (hardware definido fora do código)
✅ Fase 3   — Portal técnico PWA offline
🟡 Fase 3.6 — Web Push (infra pronta, ativação adiada para após multi-tenant)
🟡 Fase 3.7 — Multi-tenant (EM ANDAMENTO — Sub-fase 3.7.1c concluída)
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

**Status:** EM ANDAMENTO. Sub-fase 3.7.1c recém concluída.

Visão arquitetural completa em [`ARCHITECTURE_HANDOFF.md`](./ARCHITECTURE_HANDOFF.md) seção 5.

### Sub-fases

| Sub-fase | Descrição | Status |
|----------|-----------|--------|
| 3.7.1a | Tabelas de segurança (auditLog, loginAttempts, migrationAuditLog) + helper de ambiente | ✅ Concluída |
| 3.7.1b | Tabelas centrais (tenants, platformAdmins, gestors, condominiums, notificationContacts) | ✅ Concluída |
| 3.7.1c | Adicionar `tenantId` nas tabelas existentes (nullable) | ✅ Concluída |
| 3.7.1d | Script de migração de dados (dry-run) | ⏳ PRÓXIMA |
| 3.7.1e | Executar migração real + criar conta platformAdmin | ⏳ Pendente |
| 3.7.1f | `tenantId` NOT NULL + rotacionar JWT_SECRET | ⏳ Pendente |
| 3.7.2 | Isolamento de queries (helper `forTenant`) — **mais crítica** | ⏳ Pendente |
| 3.7.3 | Procedures tRPC tipadas por papel | ⏳ Pendente |
| 3.7.4 | UI portal platformAdmin | ⏳ Pendente |
| 3.7.5 | Branding dinâmico por tenant | ⏳ Pendente |
| 3.7.6 | Fluxo de primeiro acesso do gestor migrado | ⏳ Pendente |
| 3.7.7 | Auditoria ativa (registrar ações sensíveis) | ⏳ Pendente |
| 3.7.8 | Testes E2E de isolamento | ⏳ Pendente |

### Histórico recente

- **13/05/2026** — Sub-fase 3.7.1a concluída em staging. 14 divergências de schema legacy descobertas e sincronizadas. Helper `environment.ts` criado.
- **14/05/2026** — Bugfix paralelo: aprovação de orçamento via link público falhava ao gerar OS. Causa: `getBudgetByToken` sem `adminId`/`priority` no SELECT. Mergeado em master, deployado em produção (commit `51a18a7`).
- **15/05/2026** — Sub-fase 3.7.1b concluída em staging. 5 tabelas multi-tenant criadas com `utf8mb4_bin`, 4 FKs e 18 índices. Senha do banco staging rotacionada.
- **18/05/2026** — Sub-fase 3.7.1c concluída em staging. 38 tabelas operacionais receberam coluna `tenantId INT NULL`. Dados existentes intactos (29 clients, 76 workOrders, 270 products). Bug descoberto: `grep -v "statement-breakpoint"` não funciona quando os marcadores estão inline; solução documentada em `PENDENCIAS_DEPLOY_PRODUCAO.md` (`sed` em vez de `grep -v`).

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
