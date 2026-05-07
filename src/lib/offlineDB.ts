/**
 * offlineDB.ts — banco de dados local (IndexedDB) para o modo offline.
 *
 * Versão 3: adiciona store "pendingMedia" para fotos capturadas offline.
 *
 * Stores:
 *   "orders"           — OS completas (sumário + detalhe) do técnico (keyPath: id)
 *   "metadata"         — chave/valor genérico: lastSync, technicianId, etc.
 *   "pendingMutations" — mutations enfileiradas enquanto offline (keyPath: id, autoIncrement)
 *   "pendingMedia"     — fotos capturadas offline como Blobs (keyPath: id, autoIncrement)
 */

import { openDB, IDBPDatabase } from "idb";

const DB_NAME    = "soluteg-offline";
const DB_VERSION = 4; // v3→v4: adiciona errorLog (rolling buffer)

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Dados da OS armazenados localmente (sumário + campos opcionais de detalhe). */
export type OfflineOrder = {
  // Campos do sumário (sempre presentes)
  id: number;
  osNumber: string;
  title: string;
  status: string;
  priority: string;
  scheduledDate: string | null; // ISO string
  createdAt: string;            // ISO string
  clientName: string | null;
  description: string | null;
  serviceType: string | null;
  type: string;

  // Campos do detalhe — preenchidos quando o técnico abre a OS (opcionais)
  clientAddress?: string | null;
  clientPhone?: string | null;
  clientId?: number;
  technicianSignature?: string | null;
  technicianSignedAt?: string | null;
  clientSignature?: string | null;
  internalNotes?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  pausedAt?: string | null;
  updatedAt?: string;

  // Metadado interno
  _savedAt: number; // Date.now()
};

/** Tipos de mutation que podem ser enfileirados offline. */
export type MutationType =
  | "updateStatus"
  | "toggleTask"
  | "updateChecklistResponses"
  | "createComment"
  | "saveSignature"
  | "saveClientSignature";

/** Entrada na fila de mutations offline. */
export type PendingMutation = {
  id?: number;          // autoIncrement — preenchido pelo IndexedDB
  type: MutationType;
  payload: Record<string, unknown>;
  /** JWT no momento da criação, não do envio (segurança). */
  jwtToken: string;
  createdAt: number;    // Date.now()
  retries: number;
  lastError: string | null;
  /** "pending" = aguardando envio; "error" = falhou após 3 tentativas. */
  status: "pending" | "error";
};

export type MetadataKey = "lastSync" | "technicianId";

/**
 * Foto capturada offline antes de ter acesso à rede.
 * O Blob é armazenado diretamente no IndexedDB (mais eficiente que base64).
 */
export type PendingMedia = {
  id?: number;          // autoIncrement — preenchido pelo IndexedDB
  orderId: number;      // ID da OS à qual a foto pertence
  blob: Blob;           // Conteúdo binário da foto
  mimeType: string;     // ex: "image/jpeg"
  fileName: string;     // nome original do arquivo
  createdAt: number;    // Date.now()
  uploaded: boolean;    // true = já enviado ao Cloudinary
  cloudinaryUrl?: string; // URL final após upload bem-sucedido
  retries: number;
  lastError?: string;
};

// ---------------------------------------------------------------------------
// Singleton de conexão
// ---------------------------------------------------------------------------

let dbInstance: IDBPDatabase | null = null;

export async function openOfflineDB(): Promise<IDBPDatabase> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      // v1: stores originais
      if (oldVersion < 1) {
        db.createObjectStore("orders",   { keyPath: "id" });
        db.createObjectStore("metadata", { keyPath: "key" });
        console.log("[OFFLINE] Stores v1 criados no IndexedDB");
      }
      // v2: fila de mutations offline
      if (oldVersion < 2) {
        db.createObjectStore("pendingMutations", { keyPath: "id", autoIncrement: true });
        console.log("[OFFLINE] Store 'pendingMutations' criado no IndexedDB");
      }
      // v3: fila de mídias (fotos capturadas offline como Blobs)
      if (oldVersion < 3) {
        db.createObjectStore("pendingMedia", { keyPath: "id", autoIncrement: true });
        console.log("[OFFLINE] Store 'pendingMedia' criado no IndexedDB");
      }
      // v4: log de erros definitivos (rolling buffer — máx. 100 entradas)
      if (oldVersion < 4) {
        db.createObjectStore("errorLog", { keyPath: "id", autoIncrement: true });
        console.log("[OFFLINE] Store 'errorLog' criado no IndexedDB");
      }
    },
    blocked() {
      console.warn("[OFFLINE] IndexedDB bloqueado por outra aba.");
    },
    blocking() {
      dbInstance?.close();
      dbInstance = null;
    },
  });

  return dbInstance;
}

// ---------------------------------------------------------------------------
// CRUD — store "orders"
// ---------------------------------------------------------------------------

export async function saveOrder(order: OfflineOrder): Promise<void> {
  const db = await openOfflineDB();
  await db.put("orders", order);
}

/** Salva/mescla os campos de detalhe em uma OS já existente no cache. */
export async function saveOrderDetail(detail: Partial<OfflineOrder> & { id: number }): Promise<void> {
  const db   = await openOfflineDB();
  const prev = (await db.get("orders", detail.id)) ?? {};
  await db.put("orders", { ...prev, ...detail, _savedAt: Date.now() });
}

export async function getOrder(id: number): Promise<OfflineOrder | undefined> {
  const db = await openOfflineDB();
  return db.get("orders", id);
}

export async function getAllOrders(): Promise<OfflineOrder[]> {
  const db  = await openOfflineDB();
  const all = await db.getAll("orders");
  return all.sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function deleteOrder(id: number): Promise<void> {
  const db = await openOfflineDB();
  await db.delete("orders", id);
}

export async function clearAllOrders(): Promise<void> {
  const db = await openOfflineDB();
  await db.clear("orders");
}

// ---------------------------------------------------------------------------
// CRUD — store "metadata"
// ---------------------------------------------------------------------------

export async function getMetadata(key: MetadataKey): Promise<number | undefined> {
  const db  = await openOfflineDB();
  const row = await db.get("metadata", key);
  return row?.value as number | undefined;
}

export async function setMetadata(key: MetadataKey, value: number): Promise<void> {
  const db = await openOfflineDB();
  await db.put("metadata", { key, value });
}

// ---------------------------------------------------------------------------
// CRUD — store "pendingMutations"
// ---------------------------------------------------------------------------

/** Adiciona uma mutation à fila. Retorna o id gerado. */
export async function addPendingMutation(
  mutation: Omit<PendingMutation, "id">
): Promise<number> {
  const db = await openOfflineDB();
  const id = await db.add("pendingMutations", mutation);
  return id as number;
}

/** Retorna todas as mutations com status "pending", em ordem de criação. */
export async function getPendingMutations(): Promise<PendingMutation[]> {
  const db  = await openOfflineDB();
  const all = (await db.getAll("pendingMutations")) as PendingMutation[];
  return all
    .filter(m => m.status === "pending")
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Retorna todas as mutations (pending + error) para exibição no modal. */
export async function getAllPendingMutations(): Promise<PendingMutation[]> {
  const db = await openOfflineDB();
  const all = (await db.getAll("pendingMutations")) as PendingMutation[];
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

/** Conta mutations com status "pending". */
export async function countPendingMutations(): Promise<number> {
  const db  = await openOfflineDB();
  const all = (await db.getAll("pendingMutations")) as PendingMutation[];
  return all.filter(m => m.status === "pending").length;
}

/** Atualiza uma mutation existente (ex: incrementar retries ou marcar como error). */
export async function updatePendingMutation(
  id: number,
  changes: Partial<PendingMutation>
): Promise<void> {
  const db   = await openOfflineDB();
  const prev = await db.get("pendingMutations", id);
  if (!prev) return;
  await db.put("pendingMutations", { ...prev, ...changes });
}

/** Remove uma mutation da fila (após sincronização bem-sucedida). */
export async function removePendingMutation(id: number): Promise<void> {
  const db = await openOfflineDB();
  await db.delete("pendingMutations", id);
}

/** Remove todas as mutations da fila (uso administrativo). */
export async function clearPendingMutations(): Promise<void> {
  const db = await openOfflineDB();
  await db.clear("pendingMutations");
}

// ---------------------------------------------------------------------------
// CRUD — store "pendingMedia" (fotos capturadas offline)
// ---------------------------------------------------------------------------

/** Adiciona uma foto offline à fila. Retorna o id gerado. */
export async function addPendingMedia(media: Omit<PendingMedia, "id">): Promise<number> {
  const db = await openOfflineDB();
  // QuotaExceededError é lançado aqui se o armazenamento estiver cheio
  const id = await db.add("pendingMedia", media);
  return id as number;
}

/** Retorna todas as fotos offline de uma OS específica. */
export async function getPendingMediaByOrder(orderId: number): Promise<PendingMedia[]> {
  const db  = await openOfflineDB();
  const all = (await db.getAll("pendingMedia")) as PendingMedia[];
  return all
    .filter(m => m.orderId === orderId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Retorna TODAS as fotos offline (para processamento global na fila). */
export async function getAllPendingMedia(): Promise<PendingMedia[]> {
  const db = await openOfflineDB();
  return (await db.getAll("pendingMedia")) as PendingMedia[];
}

/** Atualiza uma mídia (ex: marcar como uploaded, salvar URL, incrementar retries). */
export async function updatePendingMedia(id: number, changes: Partial<PendingMedia>): Promise<void> {
  const db   = await openOfflineDB();
  const prev = await db.get("pendingMedia", id);
  if (!prev) return;
  await db.put("pendingMedia", { ...prev, ...changes });
}

/** Remove uma mídia da fila (após upload bem-sucedido e criação do attachment). */
export async function removePendingMedia(id: number): Promise<void> {
  const db = await openOfflineDB();
  await db.delete("pendingMedia", id);
}

/** Remove mídias já enviadas há mais de 7 dias (limpeza periódica de blobs). */
export async function cleanOldUploadedMedia(): Promise<void> {
  const db       = await openOfflineDB();
  const all      = (await db.getAll("pendingMedia")) as PendingMedia[];
  const cutoff   = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 dias
  const oldItems = all.filter(m => m.uploaded && m.createdAt < cutoff);
  for (const item of oldItems) {
    await db.delete("pendingMedia", item.id!);
  }
  if (oldItems.length > 0) {
    console.log(`[OFFLINE] ${oldItems.length} blob(s) antigo(s) removido(s) do cache`);
  }
}

// ---------------------------------------------------------------------------
// CRUD — store "errorLog" (rolling buffer de erros definitivos)
// ---------------------------------------------------------------------------

const ERROR_LOG_MAX = 100;

/** Entrada no log de erros offline. */
export type ErrorLogEntry = {
  id?: number;
  timestamp: number;
  /** Origem do erro: mutation de texto, upload de mídia ou sync geral. */
  source: "mutation" | "media" | "sync";
  /** Tipo da mutation ou "upload" para mídias. */
  type: string;
  message: string;
  /** JSON com o payload da mutation para debug (truncado em 500 chars). */
  payloadSummary?: string;
};

/**
 * Registra um erro no log persistente.
 * Mantém no máximo 100 entradas — remove as mais antigas quando excede.
 */
export async function logOfflineError(entry: Omit<ErrorLogEntry, "id">): Promise<void> {
  const db = await openOfflineDB();
  await db.add("errorLog", entry);

  // Rolling buffer: remove entradas acima do limite
  const all = (await db.getAll("errorLog")) as ErrorLogEntry[];
  if (all.length > ERROR_LOG_MAX) {
    const toDelete = all
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, all.length - ERROR_LOG_MAX);
    for (const e of toDelete) {
      await db.delete("errorLog", e.id!);
    }
  }
}

/** Retorna todos os erros do log, do mais recente ao mais antigo. */
export async function getErrorLog(): Promise<ErrorLogEntry[]> {
  const db  = await openOfflineDB();
  const all = (await db.getAll("errorLog")) as ErrorLogEntry[];
  return all.sort((a, b) => b.timestamp - a.timestamp);
}

/** Limpa todo o log de erros. */
export async function clearErrorLog(): Promise<void> {
  const db = await openOfflineDB();
  await db.clear("errorLog");
}

// ---------------------------------------------------------------------------
// clearAllOfflineData — limpa todos os stores (uso administrativo)
// ---------------------------------------------------------------------------

/** Remove todos os dados offline do IndexedDB. Usar com confirmação do usuário. */
export async function clearAllOfflineData(): Promise<void> {
  const db = await openOfflineDB();
  await db.clear("orders");
  await db.clear("metadata");
  await db.clear("pendingMutations");
  await db.clear("pendingMedia");
  await db.clear("errorLog");
  console.log("[OFFLINE] Todos os dados offline removidos do IndexedDB");
}
