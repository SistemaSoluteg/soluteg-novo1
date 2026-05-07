import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { StatusBadge, PriorityBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { APP_LOGO } from "@/const";
import InstallPWAPrompt from "@/components/InstallPWAPrompt";
import ConnectionStatus from "@/components/ConnectionStatus";
import {
  useOrdersWithOffline,
  useSyncOfflineOrders,
  usePendingCount,
} from "@/hooks/useOfflineOrders";
import { getMutationLabel } from "@/lib/syncQueue";
import {
  HardHat,
  LogOut,
  ChevronRight,
  Calendar,
  User,
  ClipboardList,
  Download,
  Loader2,
  CheckCircle,
  AlertCircle,
  FileText,
  Clock,
  AlertTriangle,
  WifiOff,
  HelpCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

export default function TechnicianPortal() {
  const [, setLocation] = useLocation();
  const [technicianId, setTechnicianId] = useState<number | null>(null);
  const [technicianName, setTechnicianName] = useState("");
  const [pendingModalOpen, setPendingModalOpen] = useState(false);

  useEffect(() => {
    const id   = localStorage.getItem("technicianId");
    const name = localStorage.getItem("technicianName");
    if (!id) { window.location.href = "/technician/login"; return; }
    setTechnicianId(parseInt(id));
    setTechnicianName(name ?? "Técnico");
  }, []);

  // OS com fallback offline
  const { orders: workOrders, isLoading, isOffline, fromCache } =
    useOrdersWithOffline(!!technicianId);

  // Botão "Atualizar OS offline"
  const { syncStatus, lastSync, triggerSync, isOnline } =
    useSyncOfflineOrders(technicianId);

  // Contagem de mutations pendentes para o badge
  const { pendingCount, pendingMutations, refresh: refreshPending } = usePendingCount();

  // Atualiza contagem de pendentes quando o auto-sync global (App.tsx) conclui
  useEffect(() => {
    const handleSyncComplete = () => refreshPending();
    window.addEventListener("soluteg:sync-complete", handleSyncComplete);
    return () => window.removeEventListener("soluteg:sync-complete", handleSyncComplete);
  }, [refreshPending]);

  function handleLogout() {
    fetch("/api/technician-logout", { method: "POST" }).catch(() => {});
    localStorage.removeItem("technicianId");
    localStorage.removeItem("technicianName");
    localStorage.removeItem("technicianToken");
    window.location.href = "/technician/login";
  }

  const total       = workOrders.length;
  const pendentes   = workOrders.filter(o => ["aberta", "aprovada", "aguardando_aprovacao"].includes(o.status)).length;
  const emAndamento = workOrders.filter(o => o.status === "em_andamento").length;
  const concluidas  = workOrders.filter(o => o.status === "concluida").length;

  const syncIcon =
    syncStatus === "downloading" ? <Loader2 className="w-4 h-4 animate-spin" /> :
    syncStatus === "done"        ? <CheckCircle className="w-4 h-4 text-green-500" /> :
    syncStatus === "error"       ? <AlertCircle className="w-4 h-4 text-red-500" /> :
                                   <Download className="w-4 h-4" />;

  const syncLabel =
    syncStatus === "downloading" ? "Baixando..." :
    syncStatus === "done"        ? "Atualizado!" :
    syncStatus === "error"       ? "Erro" :
                                   "Atualizar OS";

  const lastSyncLabel = lastSync
    ? formatDistanceToNow(new Date(lastSync), { addSuffix: true, locale: ptBR })
    : "nunca";

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <InstallPWAPrompt />
      <ConnectionStatus />

      {/* Header */}
      <header className="bg-white dark:bg-gray-900 border-b shadow-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={APP_LOGO} alt="JNC Logo" className="h-8" />
            <div>
              <p className="text-xs text-muted-foreground">Portal do Técnico</p>
              <p className="font-semibold text-sm">{technicianName}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Badge de pendentes — visível quando há mutations na fila */}
            {pendingCount > 0 && (
              <button
                onClick={() => setPendingModalOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-orange-50 border border-orange-200 text-orange-700 text-xs font-medium hover:bg-orange-100 transition-colors"
                title="Ver alterações pendentes de sincronização"
              >
                <Clock className="w-3.5 h-3.5" />
                {pendingCount} pendente{pendingCount !== 1 ? "s" : ""}
              </button>
            )}

            {/* Botão atualizar OS offline */}
            <div className="flex flex-col items-end">
              <Button
                size="sm"
                variant="outline"
                onClick={triggerSync}
                disabled={!isOnline || syncStatus === "downloading"}
                className="gap-1.5 h-8"
                title={isOnline ? `Sincronizar OS (última: ${lastSyncLabel})` : "Sem conexão"}
              >
                {syncIcon}
                <span className="hidden sm:inline text-xs">{syncLabel}</span>
              </Button>
              {lastSync && (
                <span className="text-[10px] text-muted-foreground mt-0.5 hidden sm:block">
                  Sync {lastSyncLabel}
                </span>
              )}
            </div>

            <Button size="sm" variant="outline" onClick={handleLogout} className="gap-1">
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Sair</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-6 max-w-2xl">
        {/* Acesso rápido */}
        <div className="grid grid-cols-1 gap-2">
          <button
            onClick={() => setLocation("/technician/laudos")}
            className="flex items-center gap-3 bg-white dark:bg-gray-900 rounded-lg border p-4 text-left hover:shadow-md hover:border-blue-300 transition-all group"
          >
            <div className="p-2 bg-blue-50 dark:bg-blue-950 rounded-lg">
              <FileText className="w-5 h-5 text-blue-600" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-sm">Laudos Técnicos</p>
              <p className="text-xs text-muted-foreground">Criar e editar laudos de inspeção</p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-blue-600" />
          </button>

          <button
            onClick={() => setLocation("/technician/offline-status")}
            className="flex items-center gap-3 bg-white dark:bg-gray-900 rounded-lg border p-4 text-left hover:shadow-md hover:border-orange-300 transition-all group"
          >
            <div className="p-2 bg-orange-50 dark:bg-orange-950 rounded-lg">
              <WifiOff className="w-5 h-5 text-orange-600" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-sm flex items-center gap-2">
                Status Offline
                {pendingCount > 0 && (
                  <span className="text-[10px] bg-orange-500 text-white px-1.5 py-0.5 rounded-full font-bold">
                    {pendingCount}
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">Pendentes, cache e sincronização</p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-orange-600" />
          </button>

          <button
            onClick={() => setLocation("/technician/como-funciona-offline")}
            className="flex items-center gap-3 bg-white dark:bg-gray-900 rounded-lg border p-4 text-left hover:shadow-md hover:border-gray-300 transition-all group"
          >
            <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded-lg">
              <HelpCircle className="w-5 h-5 text-gray-600" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-sm">Como funciona offline</p>
              <p className="text-xs text-muted-foreground">Guia rápido para trabalhar sem internet</p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-gray-600" />
          </button>
        </div>

        {fromCache && !isOffline && workOrders.length > 0 && (
          <p className="text-xs text-muted-foreground text-center">
            Exibindo dados locais enquanto carrega do servidor...
          </p>
        )}

        {/* Resumo de contadores */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white dark:bg-gray-900 rounded-lg border p-3 text-center">
            <p className="text-2xl font-bold text-yellow-600">{pendentes}</p>
            <p className="text-xs text-muted-foreground mt-1">Pendentes</p>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-lg border p-3 text-center">
            <p className="text-2xl font-bold text-blue-600">{emAndamento}</p>
            <p className="text-xs text-muted-foreground mt-1">Em Andamento</p>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-lg border p-3 text-center">
            <p className="text-2xl font-bold text-green-600">{concluidas}</p>
            <p className="text-xs text-muted-foreground mt-1">Concluídas</p>
          </div>
        </div>

        {/* Lista de OS */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <ClipboardList className="w-5 h-5 text-blue-600" />
            <h2 className="font-semibold text-lg">Minhas Ordens de Serviço</h2>
            <Badge variant="secondary" className="ml-auto">{total}</Badge>
          </div>

          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
              Carregando...
            </div>
          ) : workOrders.length === 0 ? (
            <div className="bg-white dark:bg-gray-900 rounded-lg border p-8 text-center">
              <HardHat className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">
                {isOffline
                  ? "Nenhuma OS no cache. Conecte-se à internet e clique em Atualizar OS."
                  : "Nenhuma OS atribuída a você."}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {workOrders.map((os) => (
                <button
                  key={os.id}
                  onClick={() => setLocation(`/technician/work-orders/${os.id}`)}
                  className="w-full bg-white dark:bg-gray-900 rounded-lg border p-4 text-left hover:shadow-md hover:border-blue-300 transition-all group"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-xs font-mono text-muted-foreground">{os.osNumber}</span>
                        <StatusBadge status={os.status} />
                        <PriorityBadge priority={os.priority} />
                      </div>
                      <p className="font-semibold truncate">{os.title}</p>
                      {os.clientName && (
                        <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                          <User className="w-3 h-3" />{os.clientName}
                        </p>
                      )}
                      {os.scheduledDate && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                          <Calendar className="w-3 h-3" />
                          {format(new Date(os.scheduledDate), "dd/MM/yyyy", { locale: ptBR })}
                        </p>
                      )}
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-blue-600 flex-shrink-0 mt-1" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Modal de mutations pendentes */}
      <Dialog open={pendingModalOpen} onOpenChange={setPendingModalOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-orange-500" />
              Alterações pendentes
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {pendingMutations.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Nenhuma alteração pendente.
              </p>
            ) : (
              pendingMutations.map((m) => (
                <div
                  key={m.id}
                  className={`p-3 rounded-lg border text-sm ${
                    m.status === "error"
                      ? "bg-red-50 border-red-200"
                      : "bg-orange-50 border-orange-200"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {m.status === "error"
                      ? <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                      : <Clock className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" />
                    }
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{getMutationLabel(m.type)}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(m.createdAt), "dd/MM HH:mm", { locale: ptBR })}
                        {m.retries > 0 && ` · ${m.retries} tentativa${m.retries > 1 ? "s" : ""}`}
                      </p>
                      {m.status === "error" && m.lastError && (
                        <p className="text-xs text-red-600 mt-1 truncate">{m.lastError}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          <p className="text-xs text-muted-foreground text-center">
            {isOnline
              ? "As alterações serão enviadas automaticamente."
              : "Conecte-se à internet para sincronizar."}
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
