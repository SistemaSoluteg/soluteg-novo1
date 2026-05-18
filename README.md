# Soluteg

Sistema de gestão para empresas de serviços técnicos (elétrica, hidráulica, bombeamento). Originalmente construído para a **JNC Elétrica** e em transição para SaaS multi-tenant.

---

## 🚀 Sobre

- **Stack:** React 19 + TypeScript + Vite, Node.js + Express + tRPC + Drizzle ORM, MySQL 8
- **Integrações:** WhatsApp Web.js, MQTT (sensores ESP32), Cloudinary, Web Push (VAPID)
- **Hospedagem:** VPS Linux (Hostgator) com PM2 + Nginx
- **Status:** Em produção para a JNC | Refactor multi-tenant em andamento

---

## 📚 Documentação

Estes são os documentos vivos do projeto. Comece sempre pelos quatro primeiros:

| Documento | Propósito |
|-----------|-----------|
| [`ROADMAP.md`](./ROADMAP.md) | Fases do projeto e status atual |
| [`ARCHITECTURE_HANDOFF.md`](./ARCHITECTURE_HANDOFF.md) | Visão técnica completa (para arquitetos/devs novos) |
| [`CLAUDE.md`](./CLAUDE.md) | Contexto operacional curto (para IAs de codificação) |
| [`PENDENCIAS_DEPLOY_PRODUCAO.md`](./PENDENCIAS_DEPLOY_PRODUCAO.md) | Checklist do que precisa replicar em produção |

### Documentação de referência (`docs/`)

| Documento | Propósito |
|-----------|-----------|
| [`docs/PROTOCOLO.md`](./docs/PROTOCOLO.md) | Regras obrigatórias de desenvolvimento (segurança, tRPC procedures, identity) |
| [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) | Passo a passo de deploy em staging e produção |
| [`docs/ALARMS.md`](./docs/ALARMS.md) | Regras de negócio do sistema de alarmes de caixa d'água |
| [`docs/DATA_PROTECTION.md`](./docs/DATA_PROTECTION.md) | Regras críticas de proteção de dados |
| [`docs/PENDENCIAS_TECNICAS.md`](./docs/PENDENCIAS_TECNICAS.md) | Dívida técnica conhecida e histórico de auditorias de segurança |

### Histórico (`docs/archive/`)

Documentos antigos mantidos para referência. Não são mais atualizados.

---

## 🛠️ Desenvolvimento

### Pré-requisitos

- Node.js 22+
- pnpm 10+
- MySQL 8 (local ou remoto)

### Setup local

```bash
git clone https://github.com/SistemaSoluteg/soluteg-novo1
cd soluteg-novo1
pnpm install
cp .env.example .env  # criar manualmente, ver variáveis no ARCHITECTURE_HANDOFF.md seção 13.4
pnpm dev
```

### Branches

- `master` — produção (apenas merges de bugfix e fases concluídas)
- `multi-tenant` — refactor em andamento
- `fix/*` — bugfixes urgentes baseados em master

---

## 🔒 Segurança

Antes de tocar em queries, autenticação ou qualquer endpoint:

1. Leia [`docs/PROTOCOLO.md`](./docs/PROTOCOLO.md) seção "Segurança"
2. Leia [`docs/DATA_PROTECTION.md`](./docs/DATA_PROTECTION.md)
3. Em caso de dúvida, **não commite** — pergunte primeiro

---

## 📬 Contato

- **Owner:** Thiago
- **Empresa:** JNC Comércio e Serviços
- **Email comercial:** contato@soluteg.com.br
- **WhatsApp comercial:** (13) 98164-8402
