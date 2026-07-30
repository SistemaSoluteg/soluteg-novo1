import { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Droplet, Loader2, Copy, Check, Pencil, Trash2, AlertTriangle,
  Wifi, WifiOff, Flame, BarChart2, Radio, ClipboardCheck,
} from "lucide-react";
import { trpc } from "@/lib/trpc";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SensorRow {
  id: number;
  deviceId: string | null;
  clientId: number;
  clientName: string;
  tankName: string;
  capacity: number | null;
  notes: string | null;
  deadVolumePct: number;
  alarm1Pct: number;
  alarm2Pct: number;
  alarm3BoiaPct: number;
  alarm3BoiaEnabled: number;
  technicianId: number | null;
  technicianName: string | null;
  dropStepPct: number;
  tankType: string;
  alertPhone: string | null;
  alertPhone2: string | null;
  distVazia: number | null;
  distCheia: number | null;
  active: number;
  lastSeenAt: Date | null;
  createdAt: Date;
  currentLevel: number | null;
  lastUpdate: Date | null;
  status: string | null;
}

interface PendingRow {
  id: number;
  deviceId: string;
  lastSeenAt: Date | null;
  createdAt: Date;
}

type AssignForm = {
  clientId: string;
  tankName: string;
  capacity: string;
  notes: string;
  deadVolumePct: string;
  alarm1Pct: string;
  alarm2Pct: string;
  alarm3BoiaPct: string;
  alarm3BoiaEnabled: string; // "1" = habilitado, "0" = desabilitado
  technicianId: string;      // "" = nenhum, ou ID numérico
  dropStepPct: string;
  tankType: string;
  alertPhone: string;
  alertPhone2: string;
  distVazia: string;
  distCheia: string;
};

const defaultAssign: AssignForm = {
  clientId: "", tankName: "", capacity: "", notes: "",
  deadVolumePct: "0", alarm1Pct: "30", alarm2Pct: "15",
  alarm3BoiaPct: "90", alarm3BoiaEnabled: "1", technicianId: "", dropStepPct: "10",
  tankType: "superior", alertPhone: "", alertPhone2: "", distVazia: "", distCheia: "",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getLevelBg(pct: number, a2: number, a1: number, dead: number) {
  if (dead > 0 && pct < dead) return "bg-red-600";
  if (a2 > 0 && pct < a2) return "bg-red-500";
  if (a1 > 0 && pct < a1) return "bg-yellow-500";
  if (pct >= 75) return "bg-green-500";
  if (pct >= 50) return "bg-blue-500";
  return "bg-blue-400";
}

function getLevelText(pct: number, a2: number, a1: number, dead: number) {
  if (dead > 0 && pct < dead) return "text-red-700";
  if (a2 > 0 && pct < a2) return "text-red-600";
  if (a1 > 0 && pct < a1) return "text-yellow-600";
  if (pct >= 75) return "text-green-600";
  if (pct >= 50) return "text-blue-600";
  return "text-blue-500";
}

function timeAgo(date: Date | null) {
  if (!date) return "—";
  const d = new Date(date);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins} min atrás`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h atrás`;
  return d.toLocaleDateString("pt-BR");
}

// Retorna o status do sinal com base no tempo desde a última leitura
// < 3 min → ao vivo | 3–10 min → sem sinal | > 10 min → fora do ar
function getSensorSignalStatus(lastSeenAt: Date | null): "live" | "delayed" | "offline" {
  if (!lastSeenAt) return "offline";
  const mins = (Date.now() - new Date(lastSeenAt).getTime()) / 60_000;
  if (mins < 3) return "live";
  if (mins < 10) return "delayed";
  return "offline";
}

// Badge visual de status de sinal do sensor
function SignalBadge({ lastSeenAt }: { lastSeenAt: Date | null }) {
  const status = getSensorSignalStatus(lastSeenAt);
  if (status === "live") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
        </span>
        Ao vivo
      </span>
    );
  }
  if (status === "delayed") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-yellow-700">
        <span className="inline-flex rounded-full h-2 w-2 bg-yellow-500" />
        Sem sinal
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
      <WifiOff className="w-3 h-3" />
      Fora do ar
    </span>
  );
}

function MqttDeviceCell({ deviceId }: { deviceId: string | null }) {
  const [copied, setCopied] = useState(false);
  const topic = deviceId ? `soluteg/sensor/${deviceId}/level` : null;
  const copy = () => {
    if (!topic) return;
    navigator.clipboard.writeText(topic).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };
  if (!topic) return <span className="text-slate-400 text-xs">—</span>;
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded font-mono truncate max-w-[220px]" title={topic}>{topic}</code>
      <button onClick={copy} className="shrink-0 text-slate-400 hover:text-slate-700" title="Copiar">
        {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

// ── Sub-form for assigning / editing ─────────────────────────────────────────

function AssignFormFields({
  form, setForm, clients, technicians,
}: {
  form: AssignForm;
  setForm: (f: AssignForm) => void;
  clients: Array<{ id: number; name: string }>;
  technicians: Array<{ id: number; name: string }>;
}) {
  return (
    <>
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Cliente *</label>
        <Select value={form.clientId} onValueChange={(v) => setForm({ ...form, clientId: v })}>
          <SelectTrigger><SelectValue placeholder="Selecione o cliente" /></SelectTrigger>
          <SelectContent>
            {clients.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Nome da caixa *</label>
        <Input
          placeholder="ex: Torre A, Reservatório Superior"
          value={form.tankName}
          onChange={(e) => setForm({ ...form, tankName: e.target.value })}
          required
        />
        <p className="text-xs text-slate-500">Nome exibido no portal do cliente.</p>
      </div>

      <div className="rounded-md border border-orange-200 bg-orange-50 p-3 space-y-1">
        <label className="text-sm font-semibold text-orange-800">🔧 Técnico responsável</label>
        <Select
          value={form.technicianId || "none"}
          onValueChange={(v) => setForm({ ...form, technicianId: v === "none" ? "" : v })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Nenhum técnico configurado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Nenhum</SelectItem>
            {technicians.map((t) => (
              <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-orange-700">Acionado automaticamente via WhatsApp quando o alarm2 (nível crítico) disparar.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Capacidade (L)</label>
          <Input
            type="number" min={1} placeholder="ex: 5000"
            value={form.capacity}
            onChange={(e) => setForm({ ...form, capacity: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Tel. de alerta adicional 1</label>
          <Input
            type="tel" placeholder="(13) 99999-9999"
            value={form.alertPhone}
            onChange={(e) => setForm({ ...form, alertPhone: e.target.value })}
          />
        </div>
        <div className="space-y-1.5 col-span-2">
          <label className="text-sm font-medium">Tel. de alerta adicional 2</label>
          <Input
            type="tel" placeholder="(13) 99999-9999"
            value={form.alertPhone2}
            onChange={(e) => setForm({ ...form, alertPhone2: e.target.value })}
          />
        </div>
      </div>

      {/* SCI */}
      <div className="border rounded-lg p-3 space-y-2 bg-red-50 border-red-200">
        <div className="flex items-center gap-1.5">
          <Flame className="w-4 h-4 text-red-600" />
          <p className="text-sm font-semibold text-red-900">Sistema de Combate a Incêndio (SCI)</p>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-red-900">Volume morto SCI (%)</label>
          <Input
            type="number" min={0} max={99} placeholder="0"
            value={form.deadVolumePct}
            onChange={(e) => setForm({ ...form, deadVolumePct: e.target.value })}
          />
          <p className="text-xs text-red-700">
            Reserva mínima para combate a incêndio. 0 = desabilitado.
          </p>
        </div>
      </div>

      {/* Alarmes */}
      <div className="border rounded-lg p-3 space-y-3">
        <p className="text-sm font-semibold text-slate-700">Limiares de Alarme</p>

        <div className="space-y-1">
          <label className="text-sm font-medium">Tipo de Reservatório</label>
          <Select value={form.tankType} onValueChange={(v) => setForm({ ...form, tankType: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="superior">Superior</SelectItem>
              <SelectItem value="inferior">Inferior (Cisterna)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium text-yellow-700">⚠ Alerta 1 (%)</label>
            <Input
              type="number" min={0} max={100} placeholder="30"
              value={form.alarm1Pct}
              onChange={(e) => setForm({ ...form, alarm1Pct: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-red-700">🚨 Alerta 2 (%)</label>
            <Input
              type="number" min={0} max={100} placeholder="15"
              value={form.alarm2Pct}
              onChange={(e) => setForm({ ...form, alarm2Pct: e.target.value })}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium text-purple-700">🔧 Nível de boia (%)</label>
            <Input
              type="number" min={0} max={100} placeholder="90"
              value={form.alarm3BoiaPct}
              onChange={(e) => setForm({ ...form, alarm3BoiaPct: e.target.value })}
            />
            <p className="text-xs text-slate-500">Alerta quando nível ficar acima deste valor — possível falha na boia</p>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">📉 Alertas progressivos a cada (%) de queda</label>
            <Input
              type="number" min={1} max={50} placeholder="10"
              value={form.dropStepPct}
              onChange={(e) => setForm({ ...form, dropStepPct: e.target.value })}
            />
            <p className="text-xs text-slate-500">Notifica a cada X% que o nível cair dentro da faixa de alerta</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-md border border-purple-200 bg-purple-50 p-3">
          <input
            id="alarm3BoiaEnabled"
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300 accent-purple-600"
            checked={form.alarm3BoiaEnabled !== "0"}
            onChange={(e) => setForm({ ...form, alarm3BoiaEnabled: e.target.checked ? "1" : "0" })}
          />
          <div>
            <label htmlFor="alarm3BoiaEnabled" className="text-sm font-medium text-purple-800 cursor-pointer">
              Habilitar alarme de nível alto (boia)
            </label>
            <p className="text-xs text-purple-600">
              {form.tankType === "inferior"
                ? "Alerta admin quando cisterna ultrapassar o limiar — pane na boia mecânica"
                : "Alerta admin quando caixa superior ultrapassar o limiar — pane na boia de corte da bomba"}
            </p>
          </div>
        </div>

        <p className="text-xs text-slate-500">Use 0 para desabilitar os limiares de alarme.</p>
      </div>

      {/* Calibração */}
      <div className="border rounded-lg p-3 space-y-2 bg-blue-50 border-blue-200">
        <p className="text-sm font-semibold text-blue-900">Calibração do Sensor (JSN-SR04T)</p>
        <p className="text-xs text-blue-700">
          Distâncias medidas fisicamente do sensor até a superfície da água. O ESP32 envia{" "}
          <code className="bg-blue-100 px-1 rounded">distance_cm</code> e o servidor converte para %.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium text-blue-900">Dist. quando VAZIA (cm)</label>
            <Input
              type="number" min={1} placeholder="ex: 120"
              value={form.distVazia}
              onChange={(e) => setForm({ ...form, distVazia: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-blue-900">Dist. quando CHEIA (cm)</label>
            <Input
              type="number" min={1} placeholder="ex: 35"
              value={form.distCheia}
              onChange={(e) => setForm({ ...form, distCheia: e.target.value })}
            />
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Deixe em branco se o ESP32 enviar <code className="bg-slate-100 px-1 rounded">level_pct</code> diretamente.
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Observações</label>
        <Textarea
          placeholder="Localização, instruções, etc."
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          rows={2}
        />
      </div>
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminWaterTanks() {
  const [adminId, setAdminId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Assign dialog (for pending sensors)
  const [assignTarget, setAssignTarget] = useState<PendingRow | null>(null);
  const [assignForm, setAssignForm] = useState<AssignForm>(defaultAssign);

  // Edit dialog (for assigned sensors)
  const [editTarget, setEditTarget] = useState<SensorRow | null>(null);
  const [editForm, setEditForm] = useState<AssignForm>(defaultAssign);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; label: string } | null>(null);

  useEffect(() => {
    const id = localStorage.getItem("adminId");
    if (id) setAdminId(parseInt(id));
  }, []);

  const { data: pending = [], isLoading: pendingLoading, refetch: refetchPending } =
    trpc.waterTankAdmin.listPending.useQuery(
      { adminId: adminId ?? 0 },
      { enabled: !!adminId, refetchInterval: 15_000 },
    );

  const { data: sensors = [], isLoading: sensorsLoading, refetch: refetchSensors } =
    trpc.waterTankAdmin.listSensors.useQuery(
      { adminId: adminId ?? 0 },
      { enabled: !!adminId },
    );

  const { data: clients = [] } = trpc.clients.list.useQuery(undefined);
  const { data: techniciansList = [] } = trpc.technicians.list.useQuery(
    { adminId: adminId ?? 0 },
    { enabled: !!adminId },
  );

  const refetch = () => { refetchPending(); refetchSensors(); };

  const assignMutation = trpc.waterTankAdmin.assignSensor.useMutation({
    onSuccess: () => { setSuccess("Sensor atribuído!"); setAssignTarget(null); setAssignForm(defaultAssign); refetch(); },
    onError: (e: { message: string }) => setError(e.message),
  });

  const updateMutation = trpc.waterTankAdmin.updateSensor.useMutation({
    onSuccess: () => { setSuccess("Sensor atualizado!"); setEditTarget(null); refetch(); },
    onError: (e: { message: string }) => setError(e.message),
  });

  const deleteMutation = trpc.waterTankAdmin.deleteSensor.useMutation({
    onSuccess: () => { setSuccess("Sensor removido."); setDeleteTarget(null); refetch(); },
    onError: (e: { message: string }) => setError(e.message),
  });

  const parseForm = (f: AssignForm) => ({
    clientId: parseInt(f.clientId),
    tankName: f.tankName.trim(),
    capacity: f.capacity ? parseInt(f.capacity) : null,
    notes: f.notes || null,
    deadVolumePct: parseInt(f.deadVolumePct) || 0,
    alarm1Pct: parseInt(f.alarm1Pct) || 30,
    alarm2Pct: parseInt(f.alarm2Pct) || 15,
    alarm3BoiaPct: parseInt(f.alarm3BoiaPct) || 90,
    alarm3BoiaEnabled: f.alarm3BoiaEnabled === "0" ? 0 : 1,
    technicianId: f.technicianId ? parseInt(f.technicianId) : null,
    dropStepPct: parseInt(f.dropStepPct) || 10,
    tankType: (f.tankType || "superior") as "superior" | "inferior",
    alertPhone: f.alertPhone || null,
    alertPhone2: f.alertPhone2 || null,
    distVazia: f.distVazia ? parseInt(f.distVazia) : null,
    distCheia: f.distCheia ? parseInt(f.distCheia) : null,
  });

  const handleAssign: React.FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault(); setError("");
    if (!adminId || !assignTarget || !assignForm.clientId || !assignForm.tankName.trim()) return;
    assignMutation.mutate({ adminId, sensorId: assignTarget.id, ...parseForm(assignForm) });
  };

  const handleEdit: React.FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault(); setError("");
    if (!adminId || !editTarget) return;
    updateMutation.mutate({ adminId, sensorId: editTarget.id, ...parseForm(editForm) });
  };

  const openEdit = (s: SensorRow) => {
    setEditTarget(s);
    setEditForm({
      clientId: String(s.clientId),
      tankName: s.tankName,
      capacity: s.capacity?.toString() ?? "",
      notes: s.notes ?? "",
      deadVolumePct: String(s.deadVolumePct ?? 0),
      alarm1Pct: String(s.alarm1Pct ?? 30),
      alarm2Pct: String(s.alarm2Pct ?? 15),
      alarm3BoiaPct: String(s.alarm3BoiaPct ?? 90),
      alarm3BoiaEnabled: String(s.alarm3BoiaEnabled ?? 1),
      technicianId: s.technicianId ? String(s.technicianId) : "",
      dropStepPct: String(s.dropStepPct ?? 10),
      tankType: s.tankType ?? "superior",
      alertPhone: s.alertPhone ?? "",
      alertPhone2: s.alertPhone2 ?? "",
      distVazia: s.distVazia?.toString() ?? "",
      distCheia: s.distCheia?.toString() ?? "",
    });
  };

  const isLoading = pendingLoading || sensorsLoading;

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2">
            <Droplet className="w-8 h-8 text-blue-500" /> Sensores de Caixa d'Água
          </h1>
          <p className="text-slate-600 mt-1">
            Sensores se auto-registram ao conectar. Atribua cada um a um cliente pelo portal.
          </p>
        </div>

        {success && (
          <Alert className="bg-green-50 border-green-200">
            <AlertDescription className="text-green-800">{success}</AlertDescription>
          </Alert>
        )}

        {/* ── Pending sensors ──────────────────────────────────────────── */}
        <Card className={pending.length > 0 ? "border-orange-300 shadow-orange-100 shadow-md" : ""}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Radio className="w-4 h-4 text-orange-500" />
              Sensores Detectados
              {pending.length > 0 && (
                <Badge className="bg-orange-500 hover:bg-orange-600 text-white ml-1">
                  {pending.length} aguardando
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Sensores que enviaram sinal mas ainda não foram atribuídos a nenhum cliente.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(pending as PendingRow[]).length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <Radio className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Nenhum sensor pendente.</p>
                <p className="text-xs mt-1">Configure o ESP32 com o tópico <code className="bg-slate-100 px-1 rounded">soluteg/sensor/SEU_ID/level</code> e ele aparecerá aqui.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID do Dispositivo</TableHead>
                      <TableHead>Primeiro sinal</TableHead>
                      <TableHead>Último sinal</TableHead>
                      <TableHead className="text-right">Ação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(pending as PendingRow[]).map((p) => (
                      <TableRow key={p.id} className="bg-orange-50/40">
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                            <code className="font-mono text-sm font-semibold text-slate-800">{p.deviceId}</code>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-slate-500">
                          {new Date(p.createdAt).toLocaleString("pt-BR")}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <SignalBadge lastSeenAt={p.lastSeenAt} />
                            <span className="text-xs text-slate-400">{timeAgo(p.lastSeenAt)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            className="gap-1.5 bg-orange-500 hover:bg-orange-600"
                            onClick={() => { setAssignTarget(p); setAssignForm(defaultAssign); setError(""); }}
                          >
                            <ClipboardCheck className="w-4 h-4" /> Atribuir
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Assigned sensors ─────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Sensores Atribuídos</CardTitle>
            <CardDescription>
              {(sensors as SensorRow[]).length} sensor{(sensors as SensorRow[]).length !== 1 ? "es" : ""} configurado{(sensors as SensorRow[]).length !== 1 ? "s" : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(sensors as SensorRow[]).length === 0 ? (
              <div className="text-center py-10">
                <Droplet className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 text-sm">Nenhum sensor atribuído ainda.</p>
                <p className="text-slate-400 text-xs mt-1">Atribua os sensores detectados acima.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Caixa</TableHead>
                      <TableHead>Device ID</TableHead>
                      <TableHead>Nível atual</TableHead>
                      <TableHead>SCI / Alarmes</TableHead>
                      <TableHead>Último sinal</TableHead>
                      <TableHead>Tópico MQTT</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(sensors as SensorRow[]).map((s) => {
                      const dead = s.deadVolumePct ?? 0;
                      const a1 = s.alarm1Pct ?? 30;
                      const a2 = s.alarm2Pct ?? 15;
                      return (
                        <TableRow key={s.id}>
                          <TableCell className="font-medium">{s.clientName}</TableCell>
                          <TableCell>{s.tankName}</TableCell>
                          <TableCell>
                            <code className="text-xs font-mono text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                              {s.deviceId ?? "—"}
                            </code>
                          </TableCell>
                          <TableCell>
                            {s.currentLevel != null ? (
                              <div className="flex items-center gap-2">
                                <div className="w-16 bg-slate-200 rounded-full h-2 overflow-hidden">
                                  <div
                                    className={`h-full ${getLevelBg(s.currentLevel, a2, a1, dead)}`}
                                    style={{ width: `${s.currentLevel}%` }}
                                  />
                                </div>
                                <span className={`text-sm font-semibold ${getLevelText(s.currentLevel, a2, a1, dead)}`}>
                                  {s.currentLevel}%
                                </span>
                              </div>
                            ) : (
                              <span className="flex items-center gap-1 text-xs text-slate-400">
                                <Wifi className="w-3 h-3" /> Aguardando
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="text-xs space-y-0.5">
                              {dead > 0 && (
                                <div className="flex items-center gap-1 text-red-600">
                                  <Flame className="w-3 h-3" /> SCI: {dead}%
                                </div>
                              )}
                              {a1 > 0 && <div className="text-yellow-700">⚠ Alerta: {a1}%</div>}
                              {a2 > 0 && <div className="text-red-600">🚨 Crítico: {a2}%</div>}
                              {!dead && !a1 && !a2 && <span className="text-slate-400">—</span>}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-0.5">
                              <SignalBadge lastSeenAt={s.lastSeenAt} />
                              <span className="text-xs text-slate-400">{timeAgo(s.lastSeenAt)}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <MqttDeviceCell deviceId={s.deviceId} />
                          </TableCell>
                          <TableCell className="text-right space-x-1">
                            <Button
                              size="sm" variant="ghost"
                              onClick={() => window.location.href = `/gestor/sensores-agua/${s.id}`}
                              className="text-orange-500 hover:text-orange-700" title="Dashboard"
                            >
                              <BarChart2 className="w-4 h-4" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => openEdit(s)} className="text-blue-500 hover:text-blue-700">
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm" variant="ghost"
                              onClick={() => setDeleteTarget({ id: s.id, label: `${s.tankName} (${s.clientName})` })}
                              className="text-red-500 hover:text-red-700"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
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

      {/* ── Assign dialog ─────────────────────────────────────────────────── */}
      <Dialog open={!!assignTarget} onOpenChange={(o) => { if (!o) setAssignTarget(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5 text-orange-500" />
              Atribuir Sensor
            </DialogTitle>
          </DialogHeader>

          {assignTarget && (
            <div className="bg-slate-50 border rounded-lg px-3 py-2 mb-4">
              <p className="text-xs text-slate-500">Device ID do sensor</p>
              <code className="font-mono text-sm font-semibold text-slate-800">{assignTarget.deviceId}</code>
              <p className="text-xs text-slate-400 mt-0.5">Último sinal: {timeAgo(assignTarget.lastSeenAt)}</p>
            </div>
          )}

          <form onSubmit={handleAssign} className="space-y-4">
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

            <AssignFormFields
              form={assignForm}
              setForm={setAssignForm}
              clients={clients as Array<{ id: number; name: string }>}
              technicians={techniciansList as Array<{ id: number; name: string }>}
            />

            <Button
              type="submit"
              className="w-full bg-orange-500 hover:bg-orange-600"
              disabled={!assignForm.clientId || !assignForm.tankName.trim() || assignMutation.isPending}
            >
              {assignMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Atribuir e ativar sensor
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Edit dialog ───────────────────────────────────────────────────── */}
      <Dialog open={!!editTarget} onOpenChange={(o) => { if (!o) setEditTarget(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Editar Sensor</DialogTitle></DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4 mt-2">
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
            <AssignFormFields
              form={editForm}
              setForm={setEditForm}
              clients={clients as Array<{ id: number; name: string }>}
              technicians={techniciansList as Array<{ id: number; name: string }>}
            />
            <Button
              type="submit" className="w-full bg-orange-500 hover:bg-orange-600"
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Salvar alterações
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm ────────────────────────────────────────────────── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" /> Remover sensor
            </AlertDialogTitle>
            <AlertDialogDescription>
              Remover <strong>{deleteTarget?.label}</strong>? O histórico de leituras é mantido.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-3 justify-end">
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteTarget && adminId && deleteMutation.mutate({ adminId, sensorId: deleteTarget.id })}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Remover
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
