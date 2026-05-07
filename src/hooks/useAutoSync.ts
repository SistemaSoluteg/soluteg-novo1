/**
 * useAutoSync — hook global de sincronização automática da fila offline.
 *
 * Deve ser montado UMA VEZ em App.tsx para que esteja ativo independente
 * de qual tela o técnico estiver quando a rede voltar.
 *
 * Ao detectar reconexão:
 *  1. Aguarda 2s para a rede estabilizar
 *  2. Verifica se há mutations na fila
 *  3. Processa todas via processSyncQueue()
 *  4. Dispara o evento "soluteg:sync-complete" para que as telas
 *     atualizem seus dados sem precisar saber deste hook
 */

import { useEffect } from "react";
import { toast } from "sonner";
import { processSyncQueue, processMediaQueue, getPendingCount } from "@/lib/syncQueue";
import { cleanOldUploadedMedia } from "@/lib/offlineDB";

export function useAutoSync() {
  useEffect(() => {
    // Limpeza de blobs antigos ao iniciar o app (independente de conectividade)
    cleanOldUploadedMedia().catch(() => {});

    const handleOnline = async () => {
      // Espera 2s para a rede estabilizar
      await new Promise(r => setTimeout(r, 2000));

      const mutationCount = await getPendingCount();
      const hasAnything   = mutationCount > 0;

      if (!hasAnything) {
        // Verifica se há fotos pendentes mesmo sem mutations de texto
        const { getAllPendingMedia } = await import("@/lib/offlineDB");
        const media = await getAllPendingMedia();
        if (media.filter(m => !m.uploaded).length === 0) return;
      }

      const toastId = "global-sync";
      toast.loading("Sincronizando alterações offline...", { id: toastId });

      // Processa mutations de texto e fotos em paralelo
      const [mutResult, mediaResult] = await Promise.all([
        processSyncQueue(),
        processMediaQueue(),
      ]);

      const totalSynced = mutResult.synced + mediaResult.uploaded;
      const totalErrors = mutResult.errors  + mediaResult.errors;

      if (totalErrors === 0) {
        toast.success(
          totalSynced > 0
            ? `${totalSynced} item${totalSynced !== 1 ? "ns" : ""} sincronizado${totalSynced !== 1 ? "s" : ""}!`
            : "Sincronização concluída!",
          { id: toastId }
        );
      } else {
        toast.warning(
          `${totalSynced} sincronizados, ${totalErrors} com erro`,
          { id: toastId }
        );
      }

      // Notifica todas as telas para atualizar seus dados
      window.dispatchEvent(new CustomEvent("soluteg:sync-complete", {
        detail: { synced: totalSynced, errors: totalErrors },
      }));

      console.log(`[OFFLINE] Sync automático: ${mutResult.synced} mutations, ${mediaResult.uploaded} fotos, ${totalErrors} erros`);
    };

    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);
}
