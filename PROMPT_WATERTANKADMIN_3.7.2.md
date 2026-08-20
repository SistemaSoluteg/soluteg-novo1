# Prompt — Sub-fase 3.7.2 (router 8/N): isolar `waterTankAdmin`

> Cole no Claude do terminal (VS Code), branch `multi-tenant`. Referência: `workOrders`/`budgets` (Método B, `// GUARDA:`, fail-closed). **Baseline do `tsc` é 32.**

## Contexto e diagnóstico (já auditado — não reconfirmar)

`waterTankAdmin` tem **duas metades** com regras diferentes:
- **Metade admin (tRPC, tem `ctx`):** o router `waterTankAdmin.router.ts`. **Todos os endpoints recebem `adminId` do input e confiam nele** — um admin logado pode passar o `adminId` de outro admin/tenant e acessar/editar/deletar sensores dele (IDOR grave, viola regra 5.3). Filtra por `adminId`, não por tenant.
- **Metade ingestão (MQTT, SEM `ctx`):** `mqttService.ts` → `getAssignedSensorByDeviceId(deviceId)` → `saveWaterTankReading(...)` grava leitura em `waterTankMonitoring`; `waterTankAlertService.ts` grava alerta em `waterTankAlertLog`. **É o sistema de alarme da Fase 1, em produção — não pode quebrar.**

As 4 tabelas têm `tenantId`: `waterTankSensors`, `waterTankMonitoring`, `waterTankAlertLog`, `waterTankFaultLog`.

## ⚠️ Regra de ouro desta leva
**A metade admin usa fail-closed (tem `ctx.tenantId`). A metade de ingestão MQTT NÃO usa fail-closed** — carimba o `tenantId` do sensor se houver, mas **nunca dropa uma leitura/alerta** por `tenantId` ausente. Perder uma leitura de nível ou um alarme é risco real (caixa secar/transbordar). Integridade de `tenantId` nessas tabelas é resolvida por carimbo best-effort + backfill, não por fail-closed.

## Parte A — Metade admin (`waterTankAdmin.router.ts` + `waterTankSensorDb.ts`)

### A1. `adminId` sai do input, vem do `ctx` (todos os endpoints)
Remover `adminId: z.number()` de **todos** os inputs. Usar `ctx.adminId`/`ctx.tenantId`.

### A2. Filtrar por tenant, não por adminId
- `listSensorsWithStatus(adminId)` → filtrar por `tenantId` (novo parâmetro; a query interna troca `WHERE s.adminId = ?` por `WHERE s.tenantId = ?`).
- `updateSensor(id, adminId, ...)`, `deleteSensor(id, adminId)`, `getSensorById(sensorId, adminId)` → trocar o filtro `adminId` por `tenantId` (guarda de posse por tenant).
- Raw SQL em `registerFault`, `listFaults`, `getFaultStats`, `listRecentAlerts`: trocar `WHERE s.adminId = ${input.adminId}` por `WHERE s.tenantId = ${ctx.tenantId}`.

### A3. `assignSensor` — carimbar tenant + validar FKs do input
- Carimbar `tenantId: ctx.tenantId` no `.set({...})` do `assignSensor` (hoje seta clientId/adminId mas não tenantId).
- Validar posse do `clientId` do input: `getClientById(clientId)`, `if (!cliente || cliente.tenantId !== ctx.tenantId) throw NOT_FOUND`.
- Se `technicianId` for informado, validar posse (`getTechnicianById(technicianId, ctx.tenantId)`).

### A4. `registerFault` — tenant + FKs
- A query que valida o sensor: `WHERE id = ? AND tenantId = ${ctx.tenantId}`.
- A validação do `osId` (hoje `AND adminId = ?`): trocar por `AND tenantId = ${ctx.tenantId}`.
- Carimbar `tenantId` no `INSERT INTO waterTankFaultLog` (do `ctx.tenantId`).

### A5. `getSensorDashboard` — guarda por tenant
`getSensorById(sensorId, ctx.tenantId)` (via A2); o resto segue.

### A6. `listPending` — DECISÃO DE DESIGN (confirmar com o Thiago)
Sensores pendentes têm `clientId`/`tenantId` NULL (device anunciado, não atribuído). Hoje `listPendingSensors()` retorna todos, sem filtro. Isso **não é vazamento de dado de tenant** (pendente não tem dono ainda), mas em multi-tenant real significa "pool de devices compartilhado" — qualquer admin vê e pode reivindicar qualquer device pendente. Para o JNC-only atual, **manter global** e comentar como decisão pendente (a política de atribuição de device a tenant é assunto de fase futura, provavelmente via `platformAdmin`). **Não guardar agora**, só comentar.

## Parte B — Metade ingestão MQTT (carimbo best-effort, SEM fail-closed)

### B1. `getAssignedSensorByDeviceId` retorna `tenantId`
Adicionar `tenantId` ao `SELECT` e ao tipo de retorno (hoje traz clientId/adminId/tankName/... mas não `tenantId`).

### B2. `saveWaterTankReading` carimba `tenantId`
- Adicionar `tenantId?: number | null` ao parâmetro e incluir no `.insert(waterTankMonitoring).values({...})`.
- Em `mqttService.ts` (~linha 148), passar `tenantId: sensor.tenantId` (o `sensor` vem do `getAssignedSensorByDeviceId`, agora com `tenantId`).
- **Sem fail-closed:** se `sensor.tenantId` for null, gravar a leitura mesmo assim (com `tenantId` null) — nunca lançar/dropar.

### B3. `waterTankAlertLog` carimba `tenantId`
No `INSERT INTO waterTankAlertLog` (`waterTankAlertService.ts` ~linha 350): adicionar a coluna `tenantId` e passar `${cfg.tenantId}` (o `cfg` já tem `tenantId` desde a leva anterior). Sem fail-closed.

### B4. NÃO tocar
`upsertSensorDevice` (device pendente se anuncia — sem tenant ainda) e `getAssignedSensorByDeviceId` como lookup por device (é o "login" do sensor, global por design — só ganha o campo `tenantId` no retorno, sem filtro).

## Backfill (staging, antes de validar) — ORDEM IMPORTA
Primeiro os sensores (senão a ingestão continua carimbando null):
```sql
UPDATE waterTankSensors     SET tenantId = 1 WHERE tenantId IS NULL AND clientId IS NOT NULL; -- pendentes ficam null
UPDATE waterTankMonitoring  SET tenantId = 1 WHERE tenantId IS NULL;
UPDATE waterTankAlertLog    SET tenantId = 1 WHERE tenantId IS NULL;
UPDATE waterTankFaultLog    SET tenantId = 1 WHERE tenantId IS NULL;
```
(Anotar as 4 tabelas no backfill de produção do `PENDENCIAS_DEPLOY_PRODUCAO.md`. `waterTankMonitoring` provavelmente tem MUITO NULL — é a de maior volume.)

## Validação
1. `tsc --noEmit` — baseline **32**, zero novos.
2. **Ghost-probe (metade admin):** semear um sensor sob o tenant 2 (`INSERT INTO waterTankSensors (tenantId, deviceId, clientId, adminId, tankName, active) VALUES (2, 'GHOST-DEV-T2', 1, 1, 'GHOST TANK', 1)`); logado como admin do JNC, ele não pode aparecer em `listSensors`, e `getSensorDashboard`/`updateSensor`/`deleteSensor` com esse `sensorId` → erro/NOT_FOUND. Como `adminId` saiu do input, não dá mais pra forjar. Limpar depois.
3. **FK-do-input:** `assignSensor` com `clientId` de um cliente do tenant 2 → NOT_FOUND.
4. **Regressão CRÍTICA — ingestão/alarme (Fase 1):** confirmar que leituras de sensor continuam sendo gravadas em `waterTankMonitoring` (checar `SELECT ... ORDER BY measuredAt DESC LIMIT 5` — devem entrar novas com `tenantId=1`) e que o portal do cliente (`waterTankMonitoring` router) mostra os níveis. Se der pra simular um alarme, confirmar que o `waterTankAlertLog` grava com `tenantId`. **Se MQTT estiver desligado no staging (`MQTT_DISABLED=true`), essa parte é validada por revisão de código** — mas a garantia de "sem fail-closed na ingestão" é o que protege produção.
5. Regressão admin JNC: listar sensores, abrir dashboard, registrar falha, ver alertas recentes.

## Ao final
Após validar: `CLAUDE.md`, `ROADMAP.md`, `ARCHITECTURE_HANDOFF.md` (seção 8.15) e `PENDENCIAS_DEPLOY_PRODUCAO.md` (4 tabelas de caixa d'água). Registrar a distinção admin (fail-closed) vs ingestão MQTT (best-effort, sem fail-closed) e a decisão pendente do `listPending` (pool de devices). Trazer o diff pro Thiago revisar antes de commitar.
