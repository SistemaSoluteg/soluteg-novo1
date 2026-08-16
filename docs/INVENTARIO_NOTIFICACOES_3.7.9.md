# Inventário de Notificações — preparação da sub-fase 3.7.9

**Criado em:** 16/08/2026
**Propósito:** Levantamento read-only (sem mudança de código em runtime) dos pontos de envio de WhatsApp/Email e das mensagens montadas inline, para servir de base às três partes da 3.7.9 (config por tenant, WhatsApp multi-instância, templates editáveis). É a "primeira tarefa" da 3.7.9c antecipada enquanto a 3.7.2 fecha.
**Escopo:** apenas mapeamento. Nenhuma função foi alterada. O rewiring (`tenantId` nas funções + propagação nos call sites) só entra **depois** da 3.7.2 concluída.

> ⚠️ Este documento é um retrato do código em 16/08/2026 (branch `multi-tenant`, HEAD `5b3e962`). Se um call site mudar, revalidar antes de usar como fonte para a implementação.

---

## 1. As funções de envio (a "camada de transporte" atual)

Todas em [`server/whatsapp.ts`](../server/whatsapp.ts) e [`server/emailService.ts`](../server/emailService.ts).

| Função | Destino | Número/destinatário | Vira, na 3.7.9 |
|--------|---------|---------------------|----------------|
| `sendWhatsappAlert(message)` | **admin (JNC)** | número **hardcoded** `5513981301010` (linha 275) | `tenant.whatsappAdminNumber` + instância do tenant |
| `sendWhatsappAlertWithPDF(message, pdf, filename)` | **admin (JNC)** | número **hardcoded** `5513981301010` (linha 315) | idem |
| `sendWhatsappToNumber(phone, message)` | **número arbitrário** (cliente) | recebe `phone` por parâmetro | só troca a instância `Client` pela do tenant |
| `sendWhatsappToNumberWithPDF(phone, message, pdf, filename)` | **número arbitrário** (cliente) | recebe `phone` por parâmetro | idem |
| `sendAlertEmail(subject, body)` | **admin** | `EMAIL_TO_ADMIN` / SMTP global via `.env` | `tenantNotificationSettings` (SMTP + destinatário por tenant) |

**Observações-chave:**
- O **número da JNC só aparece hardcoded nas duas funções de "admin"** (`sendWhatsappAlert` / `...WithPDF`). As funções `...ToNumber` já recebem o telefone de fora — para elas, multi-tenant é só usar a instância `Client` certa.
- **Só existe um remetente de email hoje:** o fallback do alarme de caixa d'água. Todo o resto é WhatsApp.
- O hub `notify()` de [`server/lib/notifications.ts`](../server/lib/notifications.ts) (linha 180) é **passthrough**: usa `payload.whatsappMessage ?? "${title}\n${body}"` e chama `sendWhatsappToNumber`. Não tem texto próprio — quem compõe é o caller (Web Push / Fase 3.6). Vai precisar de `tenantId` no rewiring, mas **não é um template**.

---

## 2. Templates de WhatsApp (mensagens montadas inline)

Legenda de destino: **ADMIN** = número do tenant (hoje JNC) · **CLIENTE** = telefone do registro.

| `key` proposta | Call site | Destino | Anexo | Placeholders | Marca inline a extrair |
|----------------|-----------|---------|:-----:|--------------|------------------------|
| `os.portal_request` | [`index.ts:613`](../server/index.ts#L613) | ADMIN | — | `{{condominio}}` `{{servico}}` `{{tipo}}` `{{prioridade}}` `{{descricao?}}` `{{verOsUrl}}` | "JNC SOLUTEG" |
| `os.created` | [`workOrders.router.ts:95`](../server/routers/workOrders.router.ts#L95) | ADMIN | — | `{{servico}}` `{{condominio}}` `{{tipo}}` `{{prioridade}}` `{{verOsUrl}}` | "PORTAL JNC SOLUTEG" |
| `os.pdf_para_cliente` | [`workOrders.router.ts:1063`](../server/routers/workOrders.router.ts#L1063) **e** [`technicianPortal.router.ts:123`](../server/routers/technicianPortal.router.ts#L123) — **duplicado** | CLIENTE | PDF da OS | `{{saudacao}}`(syndicName) `{{numeroOS}}` `{{titulo}}` `{{condominio}}` `{{status}}` `{{portalLinha?}}` | link do portal hardcoded |
| `os.pdf_para_admin` | [`workOrders.router.ts:1096`](../server/routers/workOrders.router.ts#L1096) **e** [`technicianPortal.router.ts:148`](../server/routers/technicianPortal.router.ts#L148) — **duplicado** | ADMIN | PDF da OS | `{{numeroOS}}` `{{titulo}}` `{{cliente}}` `{{tipo}}` `{{status}}` `{{verPainelUrl}}` | — |
| `os.compartilhada_portal` | [`technicianPortal.router.ts:217`](../server/routers/technicianPortal.router.ts#L217) | CLIENTE | — | `{{saudacao}}` `{{numeroOS}}` `{{aba}}` `{{portalUrl}}` `{{login}}` | "JNC Soluteg – Portal do Cliente" |
| `budget.created` | [`budgets.router.ts:79`](../server/routers/budgets.router.ts#L79) | ADMIN | — | `{{cliente?}}` `{{servico}}` `{{numero}}` `{{acessarUrl}}` | — |
| `budget.os_gerada` | [`budgets.router.ts:297`](../server/routers/budgets.router.ts#L297) | ADMIN | — | `{{numero}}` `{{cliente}}` `{{osGeradaUrl}}` | — |
| `budget.pdf_para_cliente` | [`budgets.router.ts:531`](../server/routers/budgets.router.ts#L531) | CLIENTE | PDF do orçamento | `{{numero}}` `{{servico}}` `{{valor}}` `{{validoAte?}}` `{{aprovarUrl}}` | — |
| `budget.pdf_para_admin` | [`budgets.router.ts:539`](../server/routers/budgets.router.ts#L539) | ADMIN | PDF do orçamento | `{{numero}}` `{{servico}}` `{{valor}}` `{{status}}` | — |
| `laudo.para_cliente` | [`laudos.router.ts:674`](../server/routers/laudos.router.ts#L674) | CLIENTE | PDF do laudo | `{{numero}}` `{{titulo}}` (default; sobrescrito por `input.mensagem`) | — |
| `system.online` | [`whatsapp.ts:52`](../server/whatsapp.ts#L52) | ADMIN | — | nenhum | "SISTEMA JNC ONLINE" |

### Caso especial — broadcast livre
| `client.broadcast` | [`clients.router.ts:214`](../server/routers/clients.router.ts#L214) | CLIENTE | — | texto **composto pelo admin** com `{{campo}}` do cliente, já resolvido por `replaceVars` |

Este **não é um template fixo** — o admin escreve a mensagem na hora e o sistema só substitui variáveis do cliente. Já é "template-like". Na 3.7.9c, provavelmente fica de fora da tabela de templates com defaults (é ad-hoc por envio), mas o **mecanismo de placeholders whitelistados** pode ser reaproveitado dele.

---

## 3. Família de alarmes de caixa d'água (Fase 1)

Origem única: `buildGenericMessage()` em [`waterTankAlertService.ts:159`](../server/waterTankAlertService.ts#L159), que despacha por `AlertType`. Destino é uma **lista de telefones** (cliente + admin + técnico, conforme config do sensor) — mais o **fallback de email** e o **Web Push** do cliente.

| `key` proposta | Sub-builder / linha | Texto-base |
|----------------|---------------------|------------|
| `water_tank.alarm1` | `buildAlarm1Message` (l.170) | variante por `tankType` |
| `water_tank.alarm2` | `buildAlarm2Message` (l.171) | variante por `tankType` |
| `water_tank.alarm3_boia` | `buildAlarm3BoiaMessage` (l.172) | variante por `tankType` + `triggerPct` |
| `water_tank.drop_step` | l.175 | "📉 NÍVEL CAINDO — Caixa d'Água" |
| `water_tank.boia_fault` | l.178 | "🔧 FALHA DE BOIA — Cisterna" |
| `water_tank.filling` | l.181–183 | "📈 ENCHENDO" (variante superior/inferior) |
| `water_tank.level_restored` | l.186 | "✅ NÍVEL RESTAURADO" |
| `water_tank.sci_reserve` | l.189 | "🔴 EMERGÊNCIA SCI" |

**Placeholders da família inteira:** `{{cliente}}` `{{caixa}}` `{{nivel}}` `{{gatilho}}` (base comum: `Cliente: … / Caixa: … / Nível atual: …%`).

⚠️ **Risco herdado (Fase 1):** este caminho é **best-effort, sem fail-closed** — nunca pode dropar alarme. Ao editabilizar esses textos na 3.7.9c, o renderizador **precisa cair no default** se o template do tenant estiver quebrado/ausente. Nunca deixar um alarme deixar de sair por erro de template.

---

## 4. Templates de Email

| `key` proposta | Call site | Assunto / corpo |
|----------------|-----------|-----------------|
| `water_tank.alert_email` | [`waterTankAlertService.ts:339`](../server/waterTankAlertService.ts#L339) | subject: `[Soluteg] {{alertType}} — {{caixa}} ({{nivel}}%)` · body: **reusa o mesmo `message` do WhatsApp** da família de alarme |

É o **único email do sistema hoje** (fallback quando todo WhatsApp falha). O corpo não é um texto próprio — reaproveita a mensagem de alarme. Na 3.7.9c isso pode virar: mesmo `key` de alarme, com canal `email` derivando do canal `whatsapp` ou template próprio.

---

## 5. Achados que orientam a implementação da 3.7.9

1. **Número da JNC isolado em 2 pontos.** Só `sendWhatsappAlert`/`...WithPDF` (whatsapp.ts:275 e 315). Trocar por `tenant.whatsappAdminNumber` é cirúrgico. As demais ocorrências de `5513981301010` no repo são links `tel:` no front e docs — **não** são infra de envio.
2. **Dois pares de mensagens duplicados** (`os.pdf_para_cliente` e `os.pdf_para_admin` aparecem idênticos em `workOrders.router` e `technicianPortal.router`). Ao criar os templates, **unificar num só `key` cada** — evita divergência futura.
3. **Marca "JNC" hardcoded** em pelo menos 4 mensagens (`os.portal_request`, `os.created`, `os.compartilhada_portal`, `system.online`). Vira `{{tenantName}}`/branding no default do template.
4. **Base de URL** `https://app.soluteg.com.br` repetida em vários call sites. É URL de plataforma (não de tenant) — provavelmente fica global, mas centralizar num helper evita repetição. **Não** confundir com branding do tenant.
5. **Conjunto de placeholders a whitelistar** (união de tudo acima): `condominio/cliente`, `servico/titulo`, `tipo`, `prioridade`, `status`, `numeroOS`, `numero`(orçamento/laudo), `valor`, `validoAte`, `saudacao`, `login`, `aba`, `descricao`, `caixa`, `nivel`, `gatilho`, e as URLs (`verOsUrl`, `verPainelUrl`, `acessarUrl`, `aprovarUrl`, `portalUrl`, `osGeradaUrl`). Cada template só habilita os seus.
6. **Fallback obrigatório no renderizador** — especialmente para a família de alarme (best-effort, Fase 1): template ausente/quebrado do tenant → usa o default Soluteg, nunca falha o envio.
7. **Anexos PDF** aparecem em 5 templates (OS×2, orçamento×2, laudo). O gerador de PDF é ortogonal ao template de texto — a caption é que vira template.

---

## 6. O que NÃO fazer ainda (espera a 3.7.2 fechar)

- Não adicionar `tenantId` às funções de `whatsapp.ts`/`emailService.ts` nem propagar nos call sites.
- Não criar as tabelas `tenantNotificationSettings` / `messageTemplates` no banco.
- Não instanciar `WhatsappManager` multi-sessão.

Tudo isso é a implementação da 3.7.9 propriamente dita, que por decisão de sequência (ROADMAP §3.7.9) vem **depois** do isolamento de queries. Este documento existe só para que, quando a 3.7.9 começar, o levantamento já esteja pronto.
