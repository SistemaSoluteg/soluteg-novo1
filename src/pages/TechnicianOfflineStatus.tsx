/**
 * TechnicianOfflineStatus — painel de diagnóstico do modo offline.
 *
 * Exibe o estado completo do cache local do técnico:
 *   - OS baixadas no IndexedDB
 *   - Mutations pendentes de sincronização (texto: status, tarefas, etc.)
 *   - Mídias pendentes de upload (fotos)
 *   - Log de erros definitivos
 *   - Uso de armazenamento (navigator.storage.estimate)
 *   - Botões: Forçar sincronização | Limpar dados offline
 */

import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft,
  RefreshCw,
  Trash2,
  Database,
  Clock,
  Image,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  HardDrive,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import {
  getAllOrders,
  getAllPendingMutations,
  getAllPendingMedia,
  getErrorLog,
  clearAllOfflineData,
  clearErrorLog,
  type OfflineOrder,
  type PendingMutation,
  type PendingMedia,
  type ErrorLogEntry,
} from "@/lib/offlineDB";
import { processSyncQueue, processMediaQueue, getMutationLabel } from "@/lib/syncQueue";
import { useOnlineStatus } from "@/hooks/useOfflineOrders";

type StorageEstimate = { usage: number; quota: number };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function TechnicianOfflineStatus() {
  const [, setLocation] = useLocation();
  const isOnline = useOnlineStatus();

  const [orders,    setOrders]    = useState<OfflineOrder[]>([]);
  const [mutations, setMutations] = useState<PendingMutation[]>([]);
  const [media,     setMedia]     = useState<PendingMedia[]>([]);
  const [errors,    setErrors]    = useState<ErrorLogEntry[]>([]);
  const [storage,   setStorage]   = useState<StorageEstimate | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [syncing,   setSyncing]   = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [o, m, med, err] = await Promise.all([
        getAllOrders(),
        getAllPendingMutations(),
        getAllPendingMedia(),
        getErrorLog(),
      ]);
      setOrders(o);
      setMutations(m);
      setMedia(med);
      setErrors(err);

      if ("storage" in navigator) {
        const est = await navigator.storage.estimate();
        setStorage({ usage: est.usage ?? 0, quota: est.quota ?? 0 });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  async function handleForceSync() {
    if (!isOnline) { toast.error("Sem conexão. Conecte-se para sincronizar."); return; }
    setSyncing(true);
    try {
      const [mut, med] = await Promise.all([processSyncQueue(), processMediaQueue()]);
      const total = mut.synced + med.uploaded;
      const errs  = mut.errors + med.errors;
      if (errs === 0) toast.success(`${total} item(s) sincronizado(s)!`);
      else toast.warning(`${total} sincronizados, ${errs} com erro`);
      window.dispatchEvent(new CustomEvent("soluteg:sync-complete", { detail: { synced: total, errors: errs } }));
      await reload();
    } finally {
      setSyncing(false);
    }
  }

  async function handleClearAll() {
    await clearAllOfflineData();
    toast.success("Dados offline removidos.");
    await reload();
  }

  async function handleClearErrors() {
    await clearErrorLog();
    setErrors([]);
    toast.success("Log de erros limpo.");
  }

  const pendingMutations = mutations.filter(m => m.status === "pending");
  const errorMutations   = mutations.filter(m => m.status === "error");
  const pendingMedia     = media.filter(m => !m.uploaded);
  const uploadedMedia    = media.filter(m => m.uploaded);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="bg-white dark:bg-gray-900 border-b shadow-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex items-center gap-3 max-w-2xl">
          <Button size="icon" variant="ghost" onClick={() => setLocation("/technician/portal")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <p className="text-xs text-muted-foreground">Portal do Técnico</p>
            <p className="font-semibold text-sm">Status Offline</p>
          </div>
          <Button size="icon" variant="ghost" onClick={reload} className="ml-auto" disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-4 max-w-2xl">

        {/* Armazenamento */}
        {storage && (
          <div className="bg-white dark:bg-gray-900 rounded-lg border p-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2 mb-3">
              <HardDrive className="w-4 h-4" />
              Armazenamento Local
            </h2>
            <div className="flex items-center gap-3">
              <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all"
                  style={{ width: `${Math.min(100, (storage.usage / storage.quota) * 100).toFixed(1)}%` }}
                />
              </div>
              <span className="text-sm font-medium tabular-nums">
                {formatBytes(storage.usage)} / {formatBytes(storage.quota)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {((storage.usage / storage.quota) * 100).toFixed(1)}% usado
            </p>
          </div>
        )}

        {/* Ações */}
        <div className="grid grid-cols-2 gap-3">
          <Button
            onClick={handleForceSync}
            disabled={!isOnline || syncing}
            className="gap-2"
          >
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {syncing ? "Sincronizando..." : "Forçar sincronização"}
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" className="gap-2">
                <Trash2 className="w-4 h-4" />
                Limpar dados offline
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Limpar todos os dados offline?</AlertDialogTitle>
                <AlertDialogDescription>
                  Remove todas as OS baixadas, fotos salvas localmente e mutations pendentes.
                  Esta ação não pode ser desfeita. Mutations não sincronizadas serão perdidas.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={handleClearAll} className="bg-red-600 hover:bg-red-700">
                  Limpar tudo
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {/* OS baixadas */}
        <div className="bg-white dark:bg-gray-900 rounded-lg border p-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2 mb-3">
            <Database className="w-4 h-4" />
            OS no Cache Local
            <Badge variant="secondary" className="ml-auto">{orders.length}</Badge>
          </h2>
          {orders.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma OS no cache. Clique em "Atualizar OS offline" no portal.</p>
          ) : (
            <div className="space-y-1.5">
              {orders.map(o => (
                <div key={o.id} className="flex items-center gap-2 text-sm py-0.5">
                  <span className="font-mono text-xs text-muted-foreground w-20 shrink-0">{o.osNumber}</span>
                  <span className="flex-1 truncate">{o.title}</span>
                  <Badge variant="outline" className="text-[10px] shrink-0">{o.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Mutations pendentes */}
        <div className="bg-white dark:bg-gray-900 rounded-lg border p-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4" />
            Alterações Pendentes
            {pendingMutations.length > 0 && (
              <Badge className="ml-auto bg-orange-500">{pendingMutations.length}</Badge>
            )}
            {pendingMutations.length === 0 && (
              <Badge variant="secondary" className="ml-auto">0</Badge>
            )}
          </h2>
          {mutations.length === 0 ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              Nenhuma alteração pendente.
            </p>
          ) : (
            <div className="space-y-2">
              {mutations.map(m => (
                <div
                  key={m.id}
                  className={`p-2.5 rounded-lg border text-sm ${
                    m.status === "error" ? "bg-red-50 border-red-200" : "bg-orange-50 border-orange-200"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{getMutationLabel(m.type)}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(m.createdAt), "dd/MM HH:mm", { locale: ptBR })}
                        {m.retries > 0 && ` · ${m.retries} tentativa(s)`}
                      </p>
                      {m.status === "error" && m.lastError && (
                        <p className="text-xs text-red-600 mt-0.5">{m.lastError}</p>
                      )}
                    </div>
                    <Badge variant={m.status === "error" ? "destructive" : "outline"} className="text-[10px] shrink-0">
                      {m.status === "error" ? "Erro" : "Pendente"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Mídias offline */}
        <div className="bg-white dark:bg-gray-900 rounded-lg border p-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2 mb-3">
            <Image className="w-4 h-4" />
            Fotos Offline
            <Badge variant="secondary" className="ml-auto">
              {pendingMedia.length} pendente{pendingMedia.length !== 1 ? "s" : ""} · {uploadedMedia.length} enviada{uploadedMedia.length !== 1 ? "s" : ""}
            </Badge>
          </h2>
          {media.length === 0 ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              Nenhuma foto pendente.
            </p>
          ) : (
            <div className="space-y-1.5">
              {media.map(m => (
                <div key={m.id} className="flex items-center gap-2 text-sm py-0.5">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${m.uploaded ? "bg-green-500" : "bg-orange-400"}`} />
                  <span className="flex-1 truncate text-xs">{m.fileName}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{formatBytes(m.blob.size)}</span>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {m.uploaded ? "Enviada" : `${m.retries} retry`}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Log de erros */}
        {errors.length > 0 && (
          <div className="bg-white dark:bg-gray-900 rounded-lg border p-4">
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2 flex-1">
                <AlertTriangle className="w-4 h-4 text-red-500" />
                Log de Erros
                <Badge variant="destructive" className="ml-1">{errors.length}</Badge>
              </h2>
              <Button size="sm" variant="ghost" onClick={handleClearErrors} className="text-xs h-7">
                Limpar log
              </Button>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {errors.map(e => (
                <div key={e.id} className="p-2 bg-red-50 border border-red-200 rounded-lg text-xs">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-medium text-red-700">{getMutationLabel(e.type as any) || e.type}</span>
                    <span className="text-muted-foreground ml-auto shrink-0">
                      {format(new Date(e.timestamp), "dd/MM HH:mm", { locale: ptBR })}
                    </span>
                  </div>
                  <p className="text-red-600 break-all">{e.message}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Resumo de status */}
        <div className={`rounded-lg border p-4 ${isOnline ? "bg-green-50 border-green-200" : "bg-yellow-50 border-yellow-200"}`}>
          <p className={`text-sm font-medium ${isOnline ? "text-green-700" : "text-yellow-700"}`}>
            {isOnline
              ? "✓ Online — dados serão sincronizados automaticamente"
              : "⚠ Offline — dados salvos localmente serão enviados ao reconectar"}
          </p>
          {(pendingMutations.length > 0 || pendingMedia.length > 0) && (
            <p className="text-xs text-muted-foreground mt-1">
              {pendingMutations.length} alteração(ões) + {pendingMedia.length} foto(s) aguardando envio
            </p>
          )}
          {errorMutations.length > 0 && (
            <p className="text-xs text-red-600 mt-1">
              {errorMutations.length} alteração(ões) com erro permanente — verifique o log acima
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
