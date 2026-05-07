/**
 * syncQueue.ts — fila de mutations offline para o portal do técnico.
 *
 * Fluxo:
 *   1. Técnico fica offline e preenche dados (status, tarefas, checklists, etc.)
 *   2. Cada ação chama enqueueMutation() — salva no IndexedDB com JWT atual
 *   3. Ao voltar online, processSyncQueue() percorre a fila em ordem de criação
 *   4. Cada mutation é enviada ao servidor via tRPC standalone
 *   5. Sucesso → remove da fila; falha → incrementa retries (máx. 3)
 *   6. Após 3 falhas → marca como "error" (visível no modal de pendências)
 *
 * Regra de conflito: técnico vence. O payload completo é enviado ao backend,
 * que sobrescreve qualquer alteração do admin feita enquanto offline.
 */

import {
  PendingMutation,
  MutationType,
  addPendingMutation,
  getPendingMutations,
  updatePendingMutation,
  removePendingMutation,
  countPendingMutations,
  saveOrderDetail,
  getAllPendingMedia,
  updatePendingMedia,
  removePendingMedia,
} from "./offlineDB";
import { createSyncClient } from "./trpcStandalone";

const MAX_RETRIES = 3;

// Lock global para evitar que dois processSyncQueue() rodem ao mesmo tempo
// (ex: auto-sync global + sync manual no TechnicianPortal)
let syncInProgress = false;

// ---------------------------------------------------------------------------
// enqueueMutation — adiciona uma mutation à fila
// ---------------------------------------------------------------------------

/**
 * Enfileira uma mutation para ser enviada quando a rede voltar.
 * O JWT atual é capturado aqui (não no momento do envio) por segurança.
 */
export async function enqueueMutation(
  type: MutationType,
  payload: Record<string, unknown>
): Promise<void> {
  const jwtToken = localStorage.getItem("technicianToken") ?? "";

  const mutation: Omit<PendingMutation, "id"> = {
    type,
    payload,
    jwtToken,
    createdAt: Date.now(),
    retries:   0,
    lastError: null,
    status:    "pending",
  };

  const id = await addPendingMutation(mutation);
  console.log(`[OFFLINE] Mutation enfileirada: ${type} (id=${id})`, payload);
}

// ---------------------------------------------------------------------------
// processSyncQueue — processa a fila ao voltar online
// ---------------------------------------------------------------------------

export type SyncResult = {
  synced: number;
  errors: number;
};

/**
 * Processa todas as mutations pendentes em ordem de criação.
 * Retorna quantas foram sincronizadas e quantas falharam definitivamente.
 */
export async function processSyncQueue(): Promise<SyncResult> {
  if (syncInProgress) {
    console.log("[OFFLINE] Sync já em andamento, ignorando chamada concorrente");
    return { synced: 0, errors: 0 };
  }
  syncInProgress = true;

  try {
    return await _processSyncQueueInner();
  } finally {
    syncInProgress = false;
  }
}

async function _processSyncQueueInner(): Promise<SyncResult> {
  const pending = await getPendingMutations();
  if (pending.length === 0) return { synced: 0, errors: 0 };

  console.log(`[OFFLINE] Processando fila: ${pending.length} mutations pendentes`);

  const client = createSyncClient();
  let synced = 0;
  let errors = 0;

  for (const mutation of pending) {
    try {
      await dispatchMutation(client, mutation);
      await removePendingMutation(mutation.id!);
      synced++;
      console.log(`[OFFLINE] Mutation sincronizada: ${mutation.type} (id=${mutation.id})`);
    } catch (err) {
      const newRetries  = mutation.retries + 1;
      const errorMsg    = err instanceof Error ? err.message : String(err);
      const isFinal     = newRetries >= MAX_RETRIES;

      await updatePendingMutation(mutation.id!, {
        retries:   newRetries,
        lastError: errorMsg,
        status:    isFinal ? "error" : "pending",
      });

      if (isFinal) {
        errors++;
        console.error(
          `[OFFLINE] Mutation falhou definitivamente (${MAX_RETRIES} tentativas): ${mutation.type}`,
          errorMsg
        );
      } else {
        console.warn(
          `[OFFLINE] Tentativa ${newRetries}/${MAX_RETRIES} falhou: ${mutation.type}`,
          errorMsg
        );
      }
    }
  }

  console.log(`[OFFLINE] Fila processada: ${synced} sincronizadas, ${errors} com erro definitivo`);
  return { synced, errors };
}

// ---------------------------------------------------------------------------
// dispatchMutation — chama o endpoint tRPC correto para cada tipo
// ---------------------------------------------------------------------------

async function dispatchMutation(
  client: ReturnType<typeof createSyncClient>,
  mutation: PendingMutation
): Promise<void> {
  const p = mutation.payload as any;

  switch (mutation.type) {
    case "updateStatus":
      await (client as any).technicianPortal.updateStatus.mutate({
        workOrderId: p.workOrderId,
        newStatus:   p.newStatus,
        notes:       p.notes,
      });
      // Atualiza o cache local com o novo status
      await saveOrderDetail({ id: p.workOrderId, status: p.newStatus });
      break;

    case "toggleTask":
      await (client as any).technicianPortal.tasks.toggle.mutate({
        workOrderId: p.workOrderId,
        taskId:      p.taskId,
      });
      break;

    case "updateChecklistResponses":
      await (client as any).technicianPortal.checklists.updateResponses.mutate({
        checklistId: p.checklistId,
        workOrderId: p.workOrderId,
        responses:   p.responses,
      });
      break;

    case "createComment":
      await (client as any).technicianPortal.comments.create.mutate({
        workOrderId: p.workOrderId,
        comment:     p.comment,  // server usa "comment", não "content"
        isInternal:  p.isInternal,
      });
      break;

    case "saveSignature":
      await (client as any).technicianPortal.saveSignature.mutate({
        workOrderId: p.workOrderId,
        signature:   p.signature,
      });
      // Atualiza o cache local com a assinatura
      await saveOrderDetail({
        id:                 p.workOrderId,
        technicianSignature: p.signature,
        technicianSignedAt:  new Date().toISOString(),
      });
      break;

    default:
      throw new Error(`Tipo de mutation desconhecido: ${(mutation as any).type}`);
  }
}

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

/** Retorna a contagem de mutations com status "pending" (para o badge). */
export async function getPendingCount(): Promise<number> {
  return countPendingMutations();
}

// ---------------------------------------------------------------------------
// processMediaQueue — faz upload das fotos capturadas offline
// ---------------------------------------------------------------------------

export type MediaQueueResult = {
  uploaded: number;
  errors: number;
};

let mediaQueueInProgress = false;

/**
 * Processa a fila de mídias offline: faz upload de cada foto pendente para o
 * Cloudinary via /api/work-orders/upload e cria o attachment na OS via tRPC.
 *
 * Chamado automaticamente pelo useAutoSync ao voltar online, junto com
 * processSyncQueue.
 */
export async function processMediaQueue(): Promise<MediaQueueResult> {
  if (mediaQueueInProgress) return { uploaded: 0, errors: 0 };
  mediaQueueInProgress = true;

  let uploaded = 0;
  let errors   = 0;

  try {
    const pendingItems = (await getAllPendingMedia()).filter(m => !m.uploaded);
    if (pendingItems.length === 0) return { uploaded: 0, errors: 0 };

    console.log(`[OFFLINE] Processando ${pendingItems.length} foto(s) pendente(s)`);

    const client = createSyncClient();

    for (const media of pendingItems) {
      try {
        // Faz o upload do Blob como FormData para o endpoint existente do backend
        const formData = new FormData();
        formData.append("files", media.blob, media.fileName);

        const res = await fetch("/api/work-orders/upload", {
          method: "POST",
          body: formData,
          credentials: "include",
          headers: { "X-Sync-Source": "technician-offline" },
        });

        if (!res.ok) throw new Error(`Upload falhou: HTTP ${res.status}`);

        const data = await res.json();
        if (!data.success || !data.urls?.[0]) {
          throw new Error(data.message || "Resposta de upload inválida");
        }

        const file = data.urls[0];

        // Cria o attachment na OS via tRPC standalone
        await (client as any).technicianPortal.attachments.create.mutate({
          workOrderId: media.orderId,
          fileName:    file.fileName,
          fileKey:     file.key,
          fileUrl:     file.url,
          fileType:    file.fileType,
          fileSize:    file.fileSize,
          category:    "during",
        });

        // Marca como enviado — o Blob fica por 7 dias para consulta offline
        await updatePendingMedia(media.id!, { uploaded: true, cloudinaryUrl: file.url });
        uploaded++;
        console.log(`[OFFLINE] Foto enviada: ${media.fileName} → ${file.url}`);
      } catch (err) {
        const newRetries = media.retries + 1;
        const errorMsg   = err instanceof Error ? err.message : String(err);
        await updatePendingMedia(media.id!, { retries: newRetries, lastError: errorMsg });
        errors++;
        console.error(`[OFFLINE] Erro ao enviar foto ${media.fileName}:`, errorMsg);
      }
    }
  } finally {
    mediaQueueInProgress = false;
  }

  console.log(`[OFFLINE] Fila de mídias: ${uploaded} enviada(s), ${errors} erro(s)`);
  return { uploaded, errors };
}

/** Retorna o label descritivo de um tipo de mutation (para o modal). */
export function getMutationLabel(type: MutationType): string {
  const labels: Record<MutationType, string> = {
    updateStatus:              "Atualizar status da OS",
    toggleTask:                "Marcar/desmarcar tarefa",
    updateChecklistResponses:  "Salvar respostas do checklist",
    createComment:             "Adicionar comentário",
    saveSignature:             "Salvar assinatura",
  };
  return labels[type] ?? type;
}
