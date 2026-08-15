import { useState, useEffect, useRef } from "react";
import { useParams } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Droplet, Flame, AlertTriangle, Loader2, Copy, Check, Activity, Wrench } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Brush,
} from "recharts";

// ---- range options -----------------------------------------------------------

const RANGES = [
  { label: "6h",  days: 0.25 },
  { label: "24h", days: 1 },
  { label: "7d",  days: 7 },
  { label: "30d", days: 30 },
] as const;

type RangeDays = typeof RANGES[number]["days"];

// ---- fault labels ------------------------------------------------------------

const FAULT_LABELS: Record<string, { label: string; badge: string }> = {
  boia:        { label: "Pane na boia",               badge: "bg-orange-100 text-orange-800" },
  cebola:      { label: "Pane na cebola",             badge: "bg-yellow-100 text-yellow-800" },
  bomba:       { label: "Pane na bomba d'água",       badge: "bg-red-100 text-red-800" },
  falta_agua:  { label: "Falta d'água da rua",        badge: "bg-blue-100 text-blue-800" },
  tubulacao:   { label: "Pane na tubulação",          badge: "bg-slate-100 text-slate-700" },
  acionamento: { label: "Pane no acionamento",        badge: "bg-rose-100 text-rose-800" },
  fiacao:      { label: "Pane na fiação elétrica",    badge: "bg-amber-100 text-amber-800" },
  outro:       { label: "Outro",                      badge: "bg-gray-100 text-gray-600" },
};

// ---- helpers ----------------------------------------------------------------

function getActiveAlarm(pct: number, a2: number, a1: number, dead: number, a3 = 90) {
  if (dead > 0 && pct < dead) return "sci";
  if (a2 > 0 && pct < a2) return "alarm2";
  if (a1 > 0 && pct < a1) return "alarm1";
  if (a3 > 0 && a3 < 100 && pct > a3) return "boia_high";
  return null;
}

function getLevelColor(pct: number, a2: number, a1: number, dead: number, a3 = 90) {
  const a = getActiveAlarm(pct, a2, a1, dead, a3);
  if (a === "sci" || a === "alarm2") return { bar: "bg-red-500",    text: "text-red-600",    hex: "#ef4444" };
  if (a === "alarm1")                return { bar: "bg-yellow-500", text: "text-yellow-600", hex: "#eab308" };
  if (a === "boia_high")             return { bar: "bg-purple-500", text: "text-purple-600", hex: "#a855f7" };
  if (pct >= 75) return { bar: "bg-green-500", text: "text-green-600", hex: "#22c55e" };
  if (pct >= 50) return { bar: "bg-blue-500",  text: "text-blue-600",  hex: "#3b82f6" };
  return { bar: "bg-blue-400", text: "text-blue-500", hex: "#60a5fa" };
}

function LevelBar({ pct, dead, alarm1, alarm2, alarm3 }: {
  pct: number; dead: number; alarm1: number; alarm2: number; alarm3: number;
}) {
  const colors = getLevelColor(pct, alarm2, alarm1, dead, alarm3);
  return (
    <div className="relative w-full bg-slate-200 rounded-full h-6 overflow-hidden">
      <div className={`absolute left-0 top-0 h-full ${colors.bar} transition-all duration-500`} style={{ width: `${pct}%` }} />
      {dead > 0 && (
        <div
          className="absolute left-0 top-0 h-full opacity-70"
          style={{ width: `${dead}%`, background: "repeating-linear-gradient(45deg,#ef4444,#ef4444 4px,#fca5a5 4px,#fca5a5 8px)" }}
          title={`Reserva SCI: ${dead}%`}
        />
      )}
      {alarm1 > 0 && <div className="absolute top-0 h-full w-0.5 bg-yellow-400 opacity-90" style={{ left: `${alarm1}%` }} />}
      {alarm2 > 0 && <div className="absolute top-0 h-full w-0.5 bg-red-600 opacity-90" style={{ left: `${alarm2}%` }} />}
      {alarm3 > 0 && alarm3 < 100 && (
        <div className="absolute top-0 h-full w-0.5 bg-purple-500 opacity-90" style={{ left: `${alarm3}%` }} title={`Boia: ${alarm3}%`} />
      )}
    </div>
  );
}

function alertTypeLabel(t: string) {
  const map: Record<string, { label: string; color: "destructive" | "secondary" | "default" | "outline" }> = {
    sci_reserve:    { label: "Emergência SCI",      color: "destructive" },
    alarm2:         { label: "Crítico (Alarme 2)",  color: "destructive" },
    boia_fault:     { label: "Falha de boia",       color: "destructive" },
    alarm1:         { label: "Alerta (Alarme 1)",   color: "secondary" },
    alarm3_boia:    { label: "Nível de boia alto",  color: "secondary" },
    drop_step:      { label: "Queda progressiva",   color: "secondary" },
    filling:        { label: "Enchendo",            color: "secondary" },
    level_restored: { label: "Nível restaurado",    color: "secondary" },
  };
  return map[t] ?? { label: t, color: "secondary" as const };
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
      className="ml-1 text-slate-400 hover:text-slate-700"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-500 inline" /> : <Copy className="w-3.5 h-3.5 inline" />}
    </button>
  );
}

function timeAgo(date: Date | string | null) {
  if (!date) return "—";
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins} min atrás`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h atrás`;
  return new Date(date).toLocaleDateString("pt-BR");
}

// ---- page -------------------------------------------------------------------

export default function AdminWaterTankDashboard() {
  const params = useParams<{ id: string }>();
  const sensorId = parseInt(params.id ?? "0");
  const [adminId, setAdminId] = useState<number | null>(null);
  const [days, setDays] = useState<RangeDays>(1);

  // Fault dialog state
  const [faultDialog, setFaultDialog] = useState(false);
  const [faultType, setFaultType] = useState("");
  const [faultDesc, setFaultDesc] = useState("");
  const [faultOsId, setFaultOsId] = useState("");

  useEffect(() => {
    const id = localStorage.getItem("adminId");
    if (id) setAdminId(parseInt(id));
  }, []);

  const { data, isLoading, isError } = trpc.waterTankAdmin.getSensorDashboard.useQuery(
    { sensorId, days },
    { enabled: !!adminId && !!sensorId, refetchInterval: 30_000 },
  );

  const { data: faults = [], refetch: refetchFaults } = trpc.waterTankAdmin.listFaults.useQuery(
    { sensorId, limit: 50 },
    { enabled: !!adminId && !!sensorId },
  );

  const { data: workOrdersResp } = trpc.workOrders.list.useQuery(
    { clientId: data?.sensor?.clientId, status: "aberta", limit: 50 },
    { enabled: !!adminId && !!data?.sensor?.clientId },
  );
  const workOrdersList = (workOrdersResp as any)?.items ?? [];

  const registerFaultMutation = trpc.waterTankAdmin.registerFault.useMutation({
    onSuccess: () => {
      toast.success("Ocorrência registrada com sucesso!");
      setFaultDialog(false);
      setFaultType("");
      setFaultDesc("");
      setFaultOsId("");
      refetchFaults();
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  // Hooks devem ficar antes dos returns condicionais — regra dos hooks do React
  const prevLevelRef = useRef<number | null>(null);
  const currentLevel = data?.sensor?.currentLevel ?? null;
  const trend: "up" | "down" | "stable" = (() => {
    if (currentLevel === null || prevLevelRef.current === null) return "stable";
    if (currentLevel > prevLevelRef.current + 1) return "up";
    if (currentLevel < prevLevelRef.current - 1) return "down";
    return "stable";
  })();
  useEffect(() => {
    if (currentLevel != null) prevLevelRef.current = currentLevel;
  }, [currentLevel]);

  if (isLoading || !adminId) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
        </div>
      </DashboardLayout>
    );
  }

  if (isError || !data) {
    return (
      <DashboardLayout>
        <div className="text-center py-20 text-slate-500">Sensor não encontrado.</div>
      </DashboardLayout>
    );
  }

  const { sensor, history, alerts } = data;
  const dead = sensor.deadVolumePct ?? 0;
  const a1   = sensor.alarm1Pct ?? 30;
  const a2   = sensor.alarm2Pct ?? 15;
  const a3   = (sensor as any).alarm3BoiaPct ?? 90;
  const dropStep = (sensor as any).dropStepPct ?? 10;
  const tankType = (sensor as any).tankType ?? "superior";

  const pct = sensor.currentLevel ?? null;
  const latest = { measuredAt: sensor.lastUpdate };
  const colors = pct != null ? getLevelColor(pct, a2, a1, dead, a3) : null;
  const alarm  = pct != null ? getActiveAlarm(pct, a2, a1, dead, a3) : null;
  const mqttTopic = `soluteg/sensor/${sensor.deviceId ?? "DEVICE_ID"}/level`;

  const timeFormat = (iso: Date | string) => {
    const d = new Date(iso);
    if (days <= 0.25) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    if (days <= 1)    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  const chartData = history.map((r: { currentLevel: number; measuredAt: Date | string }) => ({
    time: timeFormat(r.measuredAt),
    rawTime: new Date(r.measuredAt).toLocaleString("pt-BR"),
    nivel: r.currentLevel,
  }));

  const activeRange = RANGES.find((r) => r.days === days)!;

  const handleRegisterFault = () => {
    if (!faultType || !adminId) return;
    registerFaultMutation.mutate({
      sensorId,
      faultType: faultType as any,
      description: faultDesc || undefined,
      osId: faultOsId ? parseInt(faultOsId) : undefined,
      registeredBy: undefined,
    });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <Button variant="ghost" size="sm" className="mb-2 -ml-2 text-slate-500"
              onClick={() => window.location.href = "/gestor/sensores-agua"}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Voltar
            </Button>
            <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2">
              <Droplet className="w-8 h-8 text-blue-500" />
              {sensor.tankName}
            </h1>
            <p className="text-slate-500 mt-0.5">
              Cliente: <span className="font-medium text-slate-700">{sensor.clientName}</span>
              {" · "}
              <span className="text-slate-400 text-sm capitalize">{tankType === "superior" ? "Reservatório Superior" : "Cisterna / Inferior"}</span>
            </p>
          </div>

          {/* Status badge */}
          {pct != null && (
            <div className="flex items-center gap-2">
              {alarm === "sci"       && <Badge variant="destructive" className="gap-1"><Flame className="w-3 h-3" /> Emergência SCI</Badge>}
              {alarm === "alarm2"    && <Badge variant="destructive" className="gap-1"><AlertTriangle className="w-3 h-3" /> Crítico</Badge>}
              {alarm === "alarm1"    && <Badge className="gap-1 bg-yellow-500 hover:bg-yellow-600"><AlertTriangle className="w-3 h-3" /> Alerta</Badge>}
              {alarm === "boia_high" && <Badge className="gap-1 bg-purple-600 hover:bg-purple-700"><Wrench className="w-3 h-3" /> NÍVEL BOIA</Badge>}
              {!alarm                && <Badge className="gap-1 bg-green-500 hover:bg-green-600"><Activity className="w-3 h-3" /> Normal</Badge>}
            </div>
          )}
        </div>

        {/* Top row: nível atual + config */}
        <div className="grid gap-4 md:grid-cols-2">

          {/* Nível atual */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Nível atual</CardTitle>
              {latest && (
                <CardDescription>
                  Última leitura: {sensor.lastUpdate ? new Date(sensor.lastUpdate).toLocaleString("pt-BR") : "—"}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {pct != null ? (
                <>
                  <div className="flex items-end gap-2 flex-wrap">
                    <span className={`text-5xl font-bold ${colors!.text}`}>{pct}%</span>
                    {sensor.capacity && (
                      <span className="text-slate-500 mb-1 text-sm">
                        ≈ {Math.round((sensor.capacity * pct) / 100).toLocaleString("pt-BR")} L
                      </span>
                    )}
                    <span className={`mb-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                      trend === "up"   ? "bg-blue-100 text-blue-700" :
                      trend === "down" ? "bg-orange-100 text-orange-700" :
                                        "bg-slate-100 text-slate-500"
                    }`}>
                      {trend === "up" ? "▲ Enchendo" : trend === "down" ? "▼ Esvaziando" : "— Estável"}
                    </span>
                  </div>

                  <LevelBar pct={pct} dead={dead} alarm1={a1} alarm2={a2} alarm3={a3} />

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    {dead > 0 && (
                      <span className="flex items-center gap-1 text-red-500">
                        <span className="w-2 h-2 rounded-sm inline-block"
                          style={{ background: "repeating-linear-gradient(45deg,#ef4444,#ef4444 2px,#fca5a5 2px,#fca5a5 4px)" }} />
                        Reserva SCI {dead}%
                      </span>
                    )}
                    {a1 > 0 && <span className="text-yellow-600"><span className="inline-block w-0.5 h-3 bg-yellow-400 mr-1" />Alerta {a1}%</span>}
                    {a2 > 0 && <span className="text-red-600"><span className="inline-block w-0.5 h-3 bg-red-600 mr-1" />Crítico {a2}%</span>}
                    {a3 > 0 && a3 < 100 && <span className="text-purple-600"><span className="inline-block w-0.5 h-3 bg-purple-500 mr-1" />Boia {a3}%</span>}
                  </div>

                  {sensor.capacity && (
                    <div className="bg-slate-50 p-3 rounded-lg text-sm text-slate-600 space-y-0.5">
                      <p>Capacidade: <span className="font-semibold text-slate-900">{sensor.capacity.toLocaleString("pt-BR")} L</span></p>
                      <p>Volume atual: <span className="font-semibold text-slate-900">{Math.round((sensor.capacity * pct) / 100).toLocaleString("pt-BR")} L</span></p>
                      {dead > 0 && (
                        <>
                          <p>Reserva SCI: <span className="font-semibold text-red-600">{Math.round((sensor.capacity * dead) / 100).toLocaleString("pt-BR")} L</span></p>
                          <p>Vol. utilizável: <span className={`font-semibold ${pct > dead ? "text-slate-900" : "text-red-600"}`}>
                            {Math.max(0, Math.round((sensor.capacity * (pct - dead)) / 100)).toLocaleString("pt-BR")} L
                          </span></p>
                        </>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="py-8 text-center text-slate-400">
                  <Droplet className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Aguardando primeira leitura</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Configuração */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Configuração</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Tópico MQTT</p>
                <div className="flex items-center gap-1">
                  <code className="text-xs bg-slate-100 px-2 py-1 rounded font-mono break-all">{mqttTopic}</code>
                  <CopyButton text={mqttTopic} />
                </div>
                <p className="text-xs text-slate-400 mt-0.5">Payload: {`{"distance_cm": 67}`} ou {`{"level_pct": 73}`}</p>
              </div>

              <div className="border-t pt-2 space-y-1.5 text-slate-700">
                <div className="flex justify-between">
                  <span className="text-slate-500">Tipo</span>
                  <span className="font-medium capitalize">{tankType === "superior" ? "Superior" : "Inferior (Cisterna)"}</span>
                </div>
                {sensor.clientPhone && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">WhatsApp cliente</span>
                    <span className="font-medium">{sensor.clientPhone}</span>
                  </div>
                )}
                {sensor.alertPhone && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Tel. adicional 1</span>
                    <span className="font-medium">{sensor.alertPhone}</span>
                  </div>
                )}
                {sensor.alertPhone2 && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Tel. adicional 2</span>
                    <span className="font-medium">{sensor.alertPhone2}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-500">Volume morto SCI</span>
                  <span className={`font-medium ${dead > 0 ? "text-red-600" : "text-slate-400"}`}>
                    {dead > 0 ? `${dead}%` : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Alerta 1</span>
                  <span className="font-medium text-yellow-600">{a1 > 0 ? `${a1}%` : "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Alerta 2 (crítico)</span>
                  <span className="font-medium text-red-600">{a2 > 0 ? `${a2}%` : "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Boia (alto)</span>
                  <span className="font-medium text-purple-600">{a3 > 0 && a3 < 100 ? `${a3}%` : "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Alerta progressivo</span>
                  <span className="font-medium text-slate-700">a cada {dropStep}%</span>
                </div>
                {sensor.notes && (
                  <div className="bg-blue-50 border border-blue-200 p-2 rounded text-blue-900 text-xs mt-2">
                    {sensor.notes}
                  </div>
                )}
              </div>

              <div className="border-t pt-3">
                <Button
                  variant="outline"
                  className="w-full gap-2 border-orange-300 text-orange-700 hover:bg-orange-50"
                  onClick={() => setFaultDialog(true)}
                >
                  <Wrench className="w-4 h-4" /> Registrar Ocorrência
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Histórico de nível */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <CardTitle className="text-base">Histórico de nível</CardTitle>
                <CardDescription>{chartData.length} pontos · {activeRange.label}</CardDescription>
              </div>
              <div className="flex gap-1">
                {RANGES.map((r) => (
                  <button
                    key={r.days}
                    onClick={() => setDays(r.days)}
                    className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                      days === r.days
                        ? "bg-blue-600 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {chartData.length > 1 ? (
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 10 }}
                    interval="preserveStartEnd"
                    minTickGap={48}
                  />
                  <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} width={40} />
                  <Tooltip
                    formatter={(v: number) => [`${v}%`, "Nível"]}
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.rawTime ?? ""}
                    contentStyle={{ fontSize: 12 }}
                  />
                  {dead > 0 && (
                    <ReferenceLine y={dead} stroke="#ef4444" strokeDasharray="4 3" label={{ value: `SCI ${dead}%`, fill: "#ef4444", fontSize: 11 }} />
                  )}
                  {a1 > 0 && (
                    <ReferenceLine y={a1} stroke="#eab308" strokeDasharray="4 3" label={{ value: `Alerta ${a1}%`, fill: "#ca8a04", fontSize: 11 }} />
                  )}
                  {a2 > 0 && (
                    <ReferenceLine y={a2} stroke="#dc2626" strokeDasharray="4 3" label={{ value: `Crítico ${a2}%`, fill: "#dc2626", fontSize: 11 }} />
                  )}
                  {a3 > 0 && a3 < 100 && (
                    <ReferenceLine y={a3} stroke="#a855f7" strokeDasharray="4 3" label={{ value: `Boia ${a3}%`, fill: "#9333ea", fontSize: 11 }} />
                  )}
                  <Line
                    type="monotone"
                    dataKey="nivel"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                  <Brush
                    dataKey="time"
                    height={24}
                    stroke="#94a3b8"
                    fill="#f1f5f9"
                    travellerWidth={8}
                    tickFormatter={() => ""}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-40 flex items-center justify-center text-slate-400 text-sm">
                Dados insuficientes para o gráfico.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Log de alertas */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Log de alertas</CardTitle>
            <CardDescription>{alerts.length} alerta{alerts.length !== 1 ? "s" : ""} registrado{alerts.length !== 1 ? "s" : ""}</CardDescription>
          </CardHeader>
          <CardContent>
            {alerts.length === 0 ? (
              <div className="py-8 text-center text-slate-400 text-sm">Nenhum alerta enviado ainda.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data / Hora</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Nível no disparo</TableHead>
                      <TableHead>Limiar</TableHead>
                      <TableHead>Enviado para</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {alerts.map((a: { id: number; alertType: string; triggerPct: number; currentLevel: number; sentTo: string | null; sentAt: Date | string }) => {
                      const { label, color } = alertTypeLabel(a.alertType);
                      return (
                        <TableRow key={a.id}>
                          <TableCell className="text-sm text-slate-600 whitespace-nowrap">
                            {new Date(a.sentAt).toLocaleString("pt-BR")}
                          </TableCell>
                          <TableCell>
                            <Badge variant={color} className="text-xs">{label}</Badge>
                          </TableCell>
                          <TableCell className="font-semibold text-red-600">{a.currentLevel}%</TableCell>
                          <TableCell className="text-slate-500">{a.triggerPct}%</TableCell>
                          <TableCell className="text-sm text-slate-600">{a.sentTo ?? "—"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Histórico de ocorrências */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Wrench className="w-4 h-4 text-orange-500" /> Ocorrências Registradas
            </CardTitle>
            <CardDescription>{(faults as any[]).length} ocorrência{(faults as any[]).length !== 1 ? "s" : ""} registrada{(faults as any[]).length !== 1 ? "s" : ""}</CardDescription>
          </CardHeader>
          <CardContent>
            {(faults as any[]).length === 0 ? (
              <div className="py-8 text-center text-slate-400 text-sm">Nenhuma ocorrência registrada.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data / Hora</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead>Nível</TableHead>
                      <TableHead>OS Vinculada</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(faults as any[]).map((f) => {
                      const ft = FAULT_LABELS[f.faultType] ?? { label: f.faultType, badge: "bg-gray-100 text-gray-600" };
                      return (
                        <TableRow key={f.id}>
                          <TableCell className="text-sm text-slate-600 whitespace-nowrap">
                            {new Date(f.createdAt).toLocaleString("pt-BR")}
                          </TableCell>
                          <TableCell>
                            <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${ft.badge}`}>
                              {ft.label}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm text-slate-600 max-w-[200px] truncate">
                            {f.description ?? <span className="text-slate-400">—</span>}
                          </TableCell>
                          <TableCell className="font-semibold text-slate-700">{f.levelAtFault}%</TableCell>
                          <TableCell>
                            {f.osId ? (
                              <a
                                href={`/gestor/work-orders/${f.osId}`}
                                className="text-blue-600 hover:underline text-sm font-medium"
                              >
                                {f.osNumber ?? `OS #${f.osId}`}
                              </a>
                            ) : (
                              <span className="text-slate-400 text-sm">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

      </div>

      {/* ── Registrar Ocorrência Dialog ──────────────────────────────────── */}
      <Dialog open={faultDialog} onOpenChange={(o) => { if (!o) { setFaultDialog(false); setFaultType(""); setFaultDesc(""); setFaultOsId(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wrench className="w-5 h-5 text-orange-500" /> Registrar Ocorrência
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Tipo de ocorrência *</label>
              <Select value={faultType} onValueChange={setFaultType}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o tipo" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(FAULT_LABELS).map(([key, val]) => (
                    <SelectItem key={key} value={key}>{val.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Descrição</label>
              <Textarea
                placeholder="Descreva a ocorrência..."
                value={faultDesc}
                onChange={(e) => setFaultDesc(e.target.value)}
                rows={3}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Vincular a OS <span className="text-slate-400 font-normal">(opcional)</span></label>
              <Select value={faultOsId} onValueChange={setFaultOsId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma OS..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Nenhuma</SelectItem>
                  {workOrdersList.map((wo: any) => (
                    <SelectItem key={wo.id} value={String(wo.id)}>
                      {wo.osNumber} — {wo.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setFaultDialog(false)}>Cancelar</Button>
            <Button
              className="bg-orange-500 hover:bg-orange-600"
              onClick={handleRegisterFault}
              disabled={!faultType || registerFaultMutation.isPending}
            >
              {registerFaultMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </DashboardLayout>
  );
}
