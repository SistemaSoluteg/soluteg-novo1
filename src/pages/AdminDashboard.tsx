import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { FileText, Users, Wrench, TrendingUp, MessageSquare, ClipboardList, HardHat, Droplet, Bell, AlertTriangle, Flame, Clock } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

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

function alertIcon(type: string) {
  if (type === "sci_reserve") return <Flame className="w-4 h-4 text-red-600" />;
  if (type === "alarm2" || type === "boia_fault") return <AlertTriangle className="w-4 h-4 text-red-500" />;
  if (type === "alarm1" || type === "drop_step") return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
  if (type === "alarm3_boia") return <Wrench className="w-4 h-4 text-purple-500" />;
  if (type === "filling" || type === "level_restored") return <Droplet className="w-4 h-4 text-blue-500" />;
  return <Bell className="w-4 h-4 text-slate-400" />;
}

const ALERT_LABELS: Record<string, string> = {
  alarm1: "Alerta 1", alarm2: "Crítico", sci_reserve: "Emergência SCI",
  alarm3_boia: "Nível de boia", drop_step: "Queda progressiva",
  filling: "Enchendo", level_restored: "Nível restaurado", boia_fault: "Falha de boia",
};

export default function AdminDashboard() {
  const [, setLocation] = useLocation();
  const [adminId, setAdminId] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const id = localStorage.getItem("adminId");
    if (!id) {
      setLocation("/gestor/login");
      return;
    }
    const parsed = parseInt(id);
    setAdminId(parsed);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: waStatus, refetch: refetchWa } = (trpc as any).whatsapp.getStatus.useQuery(
    undefined,
    { enabled: !!adminId, refetchInterval: 30_000 },
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reconnectMutation = (trpc as any).whatsapp.reconnect.useMutation({
    onSuccess: () => {
      toast.success("Reconexão iniciada. Aguarde alguns segundos...");
      setTimeout(() => refetchWa(), 5000);
    },
    onError: () => toast.error("Erro ao reconectar WhatsApp."),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: recentAlerts = [] } = (trpc as any).waterTankAdmin.listRecentAlerts.useQuery(
    { limit: 20 },
    { enabled: !!adminId, refetchInterval: 60_000 },
  ) as { data: any[] };

  const alertsLast24h = (recentAlerts as any[]).filter(
    (a) => Date.now() - new Date(a.sentAt).getTime() < 86_400_000,
  ).length;

  // Métricas do dashboard via tRPC autenticado (adminId/tenant vêm do JWT, não do input).
  const { data: metrics = { totalClients: 0, openWorkOrders: 0, totalDocuments: 0, activeClients: 0 } } =
    trpc.adminMetrics.getDashboard.useQuery(undefined, { enabled: !!adminId });

  const metricCards = [
    {
      label: "Total de Clientes",
      value: metrics.totalClients,
      sub: `${metrics.activeClients} ativos`,
      icon: Users,
      color: "text-blue-600",
      bg: "bg-blue-50",
      border: "border-blue-200",
      href: "/gestor/clientes",
    },
    {
      label: "Ordens Abertas",
      value: metrics.openWorkOrders,
      sub: "Aguardando conclusão",
      icon: Wrench,
      color: "text-amber-600",
      bg: "bg-amber-50",
      border: "border-amber-200",
      href: "/gestor/work-orders",
    },
    {
      label: "Total de Documentos",
      value: metrics.totalDocuments,
      sub: "Enviados aos clientes",
      icon: FileText,
      color: "text-green-600",
      bg: "bg-green-50",
      border: "border-green-200",
      href: "/gestor/documentos",
    },
    {
      label: "Taxa de Atividade",
      value: `${metrics.totalClients > 0 ? Math.round((metrics.activeClients / metrics.totalClients) * 100) : 0}%`,
      sub: "Clientes ativos",
      icon: TrendingUp,
      color: "text-purple-600",
      bg: "bg-purple-50",
      border: "border-purple-200",
    },
  ];

  const actionCards = [
    {
      title: "Ordens de Serviço",
      desc: "Gerencie atendimentos e serviços",
      action: () => setLocation("/gestor/work-orders"),
      label: "Acessar",
      color: "bg-amber-600 hover:bg-amber-700",
      icon: Wrench,
    },
    {
      title: "Orçamentos",
      desc: "Propostas, aprovações e geração de OS",
      action: () => setLocation("/gestor/orcamentos"),
      label: "Acessar",
      color: "bg-indigo-600 hover:bg-indigo-700",
      icon: ClipboardList,
    },
    {
      title: "Clientes",
      desc: "Criar e gerenciar clientes",
      action: () => setLocation("/gestor/clientes"),
      label: "Acessar",
      color: "bg-blue-600 hover:bg-blue-700",
      icon: Users,
    },
    {
      title: "Documentos",
      desc: "Editar, deletar e substituir documentos",
      action: () => setLocation("/gestor/documentos"),
      label: "Acessar",
      color: "bg-green-600 hover:bg-green-700",
      icon: FileText,
    },
    {
      title: "Mensagens em Massa",
      desc: "Envie WhatsApp para grupos de clientes",
      action: () => setLocation("/gestor/mensagens"),
      label: "Acessar",
      color: "bg-orange-500 hover:bg-orange-600",
      icon: MessageSquare,
    },
    {
      title: "Técnicos",
      desc: "Gerencie técnicos e seus acessos",
      action: () => setLocation("/gestor/tecnicos"),
      label: "Acessar",
      color: "bg-cyan-600 hover:bg-cyan-700",
      icon: HardHat,
    },
  ];

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto w-full space-y-6">
        {/* Título */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
            <p className="text-sm text-slate-500 mt-1">Visão geral do sistema Soluteg</p>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 bg-slate-800">
            <Clock className="h-4 w-4 text-blue-400" />
            <div className="text-right">
              <p className="text-sm font-semibold text-white">
                {currentTime.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
              </p>
              <p className="text-lg font-bold tabular-nums text-blue-400">
                {currentTime.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </p>
            </div>
          </div>
        </div>

        {/* Métricas */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {metricCards.map((m) => {
            const Icon = m.icon;
            return (
              <Card
                key={m.label}
                className={`border ${m.border} transition-shadow ${m.href ? "cursor-pointer hover:shadow-md" : ""}`}
                onClick={() => m.href && setLocation(m.href)}
              >
                <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-sm font-medium text-slate-600">
                    {m.label}
                  </CardTitle>
                  <div className={`h-8 w-8 rounded-lg ${m.bg} flex items-center justify-center`}>
                    <Icon className={`h-4 w-4 ${m.color}`} />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className={`text-3xl font-bold ${m.color}`}>{m.value}</div>
                  <p className="text-xs text-slate-500 mt-1">{m.sub}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Status */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Status do Sistema</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              {["Sistema Operacional", "Banco de Dados", "API"].map((item) => (
                <div key={item} className="flex items-center gap-2 text-sm text-slate-600">
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                  {item}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* WhatsApp */}
        <Card className={waStatus?.isReady ? "border-green-200" : "border-red-200"}>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-2">
              <MessageSquare className={`h-4 w-4 ${waStatus?.isReady ? "text-green-600" : "text-red-500"}`} />
              <CardTitle className="text-sm">WhatsApp</CardTitle>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                  waStatus?.isReady
                    ? "bg-green-100 text-green-700"
                    : "bg-red-100 text-red-700"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${waStatus?.isReady ? "bg-green-500" : "bg-red-500"}`} />
                {waStatus?.isReady ? "Conectado" : "Desconectado"}
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={reconnectMutation.isPending}
              onClick={() => reconnectMutation.mutate()}
            >
              {reconnectMutation.isPending ? "Reconectando..." : "Reconectar"}
            </Button>
          </CardHeader>
          {!waStatus?.isReady && waStatus?.qrCodeDataUrl && (
            <CardContent className="pt-2">
              <p className="text-xs text-slate-500 mb-2">Escaneie o QR Code com o WhatsApp para reconectar:</p>
              <img
                src={waStatus.qrCodeDataUrl}
                alt="QR Code WhatsApp"
                className="w-48 h-48 rounded-lg border border-slate-200"
              />
            </CardContent>
          )}
          {!waStatus?.isReady && !waStatus?.qrCodeDataUrl && (
            <CardContent className="pt-0 pb-3">
              <p className="text-xs text-slate-500">Clique em "Reconectar" para iniciar a reconexão.</p>
            </CardContent>
          )}
        </Card>

        {/* Acesso rápido */}
        <div>
          <h2 className="text-base font-semibold text-slate-900 mb-3">Acesso Rápido</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {actionCards.map((card) => {
              const Icon = card.icon;
              return (
                <Card key={card.title} className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-slate-500" />
                      <CardTitle className="text-sm">{card.title}</CardTitle>
                    </div>
                    <CardDescription className="text-xs">{card.desc}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button
                      onClick={card.action}
                      className={`w-full text-white text-xs h-8 ${card.color}`}
                    >
                      {card.label}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Alertas recentes — Caixa d'Água */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Droplet className="h-4 w-4 text-blue-500" />
                <CardTitle className="text-sm">Alertas Recentes — Caixa d'Água</CardTitle>
                {alertsLast24h > 0 && (
                  <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                    {alertsLast24h} nas últimas 24h
                  </span>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-slate-500 h-7"
                onClick={() => setLocation("/gestor/sensores-agua")}
              >
                Ver sensores
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {recentAlerts.length === 0 ? (
              <div className="py-6 text-center text-slate-400 text-sm">
                <Bell className="w-6 h-6 mx-auto mb-1 opacity-30" />
                Nenhum alerta recente.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {recentAlerts.slice(0, 10).map((a: any, i: number) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 py-2 cursor-pointer hover:bg-slate-50 rounded px-1 transition-colors"
                    onClick={() => setLocation(`/gestor/sensores-agua/${a.sensorId}`)}
                  >
                    <div className="shrink-0">{alertIcon(a.alertType)}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {a.tankName}
                        <span className="font-normal text-slate-500 ml-1">— {a.clientName}</span>
                      </p>
                      <p className="text-xs text-slate-500">
                        {ALERT_LABELS[a.alertType] ?? a.alertType} · {a.currentLevel}% no disparo
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-slate-400 whitespace-nowrap">
                      {timeAgo(a.sentAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </DashboardLayout>
  );
}
