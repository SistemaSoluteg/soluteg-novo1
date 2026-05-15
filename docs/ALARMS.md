# ALARMS.md — Regras de Negócio do Sistema de Alertas de Caixa d'Água

**Versão:** 1.0 — 2026-05-04
**Responsável:** JNC Elétrica / Soluteg

---

## Visão Geral

O sistema monitora o nível de caixas d'água via sensores ultrassônicos (ESP32 + JSN-SR04T).
Quando o nível sobe ou desce além dos limiares configurados, alertas são disparados via
WhatsApp e, em casos críticos, uma OS emergencial é criada automaticamente.

---

## Tipos de Caixa

| Tipo | Descrição |
|------|-----------|
| `superior` | Reservatório elevado abastecido por bomba de recalque |
| `inferior` | Cisterna/reservatório enterrado alimentado pela rede pública |

---

## Zonas de Nível (configuráveis por sensor)

| Zona | Limiar padrão | Descrição |
|------|--------------|-----------|
| Normal | > Alarm1Pct | Operação normal |
| Alarm1 | ≤ Alarm1Pct (padrão 30%) | Nível de atenção |
| Alarm2 | ≤ Alarm2Pct (padrão 15%) | Nível crítico |
| SCI | ≤ DeadVolumePct (padrão 0%) | Reserva de incêndio |
| Boia alta | ≥ Alarm3BoiaPct (padrão 90%) | Risco de transbordamento |

---

## Regras de Alerta por Tipo de Caixa

### Caixa Superior

#### Alarm1 — Nível de Atenção (≤ 30%)
- **Destinatários:** Admin + Cliente
- **Ação:** Mensagem WhatsApp de orientação
- **Mensagem:**
  ```
  ⚠️ ATENÇÃO — Caixa d'Água Superior
  Cliente: {nome}  |  Caixa: {nome_caixa}
  Nível atual: {X}%

  Verifique:
  • Nível da cisterna (caixa inferior)
  • Alarmes no painel elétrico
  • Se o disjuntor da bomba está ligado
  • Se houve queda de energia
  • Teste as eletroboias
  ```
- **Cria OS?** Não

#### Alarm2 — Nível Crítico (≤ 15%)
- **Destinatários:** Admin + Cliente
- **Ação:** Mensagem WhatsApp + OS Emergencial criada automaticamente
- **Mensagem:**
  ```
  🚨 NÍVEL CRÍTICO — Caixa d'Água Superior
  Cliente: {nome}  |  Caixa: {nome_caixa}
  Nível atual: {X}%

  Nível crítico detectado. OS emergencial criada automaticamente.
  Técnico será acionado.
  ```
- **Cria OS?** Sim — tipo `emergencial`, título automático

#### SCI — Reserva de Incêndio
- **Destinatários:** Admin + Cliente
- **Ação:** Mensagem de emergência (OS já foi criada no Alarm2)
- **Mensagem:**
  ```
  🔴 EMERGÊNCIA SCI — Caixa d'Água
  Reserva de incêndio sendo consumida.
  Acionar abastecimento IMEDIATAMENTE.
  ```
- **Cria OS?** Não (já foi criada no Alarm2)

#### Alarm3 Boia — Nível Alto (≥ 90%)
- **Habilitado/desabilitado:** configurável por sensor (campo `alarm3BoiaEnabled`)
- **Destinatários:** Admin
- **Mensagem:**
  ```
  🔧 PANE NA BOIA SUPERIOR
  Cliente: {nome}  |  Caixa: {nome_caixa}
  Nível atual: {X}%

  Nível ultrapassou {limiar}%. Possível pane na boia de corte
  da bomba de recalque. Verificar imediatamente.
  ```
- **Cria OS?** Não

---

### Caixa Inferior (Cisterna)

#### Alarm1 — Nível de Atenção (≤ 30%)
- **Destinatários:** Admin + Cliente
- **Ação:** Mensagem WhatsApp de orientação
- **Mensagem:**
  ```
  ⚠️ ATENÇÃO — Cisterna (Caixa Inferior)
  Cliente: {nome}  |  Caixa: {nome_caixa}
  Nível atual: {X}%

  Verifique a entrada de água da rede pública no prédio.
  Pode haver queda de pressão ou falta d'água.
  Oriente os moradores a racionar o consumo.
  ```
- **Cria OS?** Não

#### Alarm2 — Nível Crítico (≤ 15%)
- **Destinatários:** Admin + Cliente
- **Ação:** Mensagem WhatsApp + OS Emergencial criada automaticamente
- **Mensagem:**
  ```
  🚨 NÍVEL CRÍTICO — Cisterna (Caixa Inferior)
  Cliente: {nome}  |  Caixa: {nome_caixa}
  Nível atual: {X}%

  ATENÇÃO: Possível falha na boia inferior.
  DESLIGAR IMEDIATAMENTE A BOMBA DE RECALQUE.
  OS emergencial criada — técnico será acionado para troca da boia.
  ```
- **Cria OS?** Sim — tipo `emergencial`, título automático

#### SCI — Reserva de Incêndio
- Mesmo comportamento da caixa superior (OS já criada no Alarm2)

#### Alarm3 Boia — Nível Alto (≥ 90%)
- **Habilitado/desabilitado:** configurável por sensor
- **Destinatários:** Admin
- **Mensagem:**
  ```
  🔧 PANE NA BOIA MECÂNICA — Cisterna
  Cliente: {nome}  |  Caixa: {nome_caixa}
  Nível atual: {X}%

  Nível ultrapassou {limiar}%. Possível pane na boia mecânica
  de corte da entrada de água. Verificar imediatamente.
  ```
- **Cria OS?** Não

---

## Alertas de Subida

| Tipo | Condição | Destinatários | Cria OS? |
|------|----------|--------------|---------|
| `filling` | Saindo de zona de alarme, subindo | Admin | Não |
| `level_restored` | Voltou à zona normal | Admin | Não |

---

## Cooldown

**Regra:** Um único disparo por tipo de alerta, garantindo entrega.
- Não há cooldown por tempo — a máquina de estados controla os disparos.
- Cada tipo dispara apenas na transição de zona (não repetidamente).
- **Garantia de entrega:** alertas não entregues ficam marcados como `delivered=false`
  e são reenviados quando o WhatsApp reconectar.

---

## Entrega das Mensagens

### Canal primário: WhatsApp
- Usa `whatsapp-web.js` com Puppeteer no VPS.
- Se o WhatsApp estiver offline no momento do alerta:
  - Alerta é salvo em `waterTankAlertLog` com `delivered = false`.
  - Ao reconectar, o sistema processa todos os alertas não entregues das últimas 24h.

### Canal secundário: Email
- Fallback quando WhatsApp falha 3x seguidas.
- Configurado via variáveis de ambiente: `EMAIL_FROM`, `EMAIL_TO_ADMIN`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`.

---

## OS Automática (Alarm2)

Quando o `alarm2` dispara:
1. OS criada com tipo `emergencial`, status `aberta`
2. Título: `[AUTOMÁTICO] Nível crítico — {nome_caixa} ({tipo_caixa})`
3. Descrição com nível atual, limiar e orientações
4. `clientId` e `adminId` herdados do sensor
5. O ID da OS é salvo no log do alerta (`waterTankAlertLog.osId`)
6. Admin deve atribuir técnico manualmente pela interface

---

## Variáveis de Ambiente Necessárias

```env
# WhatsApp (já existente)
# (configurado via QR code no painel admin)

# Email (novo)
EMAIL_FROM=alertas@soluteg.com.br
EMAIL_TO_ADMIN=soluteggeradores@gmail.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=seu_email@gmail.com
SMTP_PASS=sua_senha_de_app
```

---

## Campos de Configuração por Sensor

| Campo | Tipo | Padrão | Descrição |
|-------|------|--------|-----------|
| `alarm1Pct` | int | 30 | Limiar alarm1 (%) |
| `alarm2Pct` | int | 15 | Limiar alarm2 (%) |
| `alarm3BoiaPct` | int | 90 | Limiar boia alta (%) |
| `alarm3BoiaEnabled` | boolean | true | Habilita/desabilita alarme de boia alta |
| `deadVolumePct` | int | 0 | Limiar SCI (%) |
| `dropStepPct` | int | 10 | Passo do alerta progressivo (%) |
| `alertPhone` | string | null | Telefone extra de alerta (além do cliente) |
| `tankType` | enum | superior | Tipo da caixa |
