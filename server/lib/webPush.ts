/**
 * server/lib/webPush.ts
 *
 * Camada de envio de notificações Web Push.
 *
 * Responsabilidades:
 *   - Configurar as chaves VAPID a partir do .env
 *   - sendPush(): envia para uma subscription individual
 *   - sendPushToUser(): busca todas as subscriptions ativas de um usuário e envia
 *
 * Tratamento de erros:
 *   - Erro 410 Gone (ou 404): subscription inválida → marca active=0 no banco
 *   - Outros erros: loga e retorna falha, mas não remove a subscription
 *
 * Prefixo de log: [PUSH]
 */

import webpush from "web-push";
import { eq, and } from "drizzle-orm";
import { getDb } from "../db";
import { pushSubscriptions } from "../../drizzle/schema";

// ─── Configuração das chaves VAPID ────────────────────────────────────────────

const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT     = process.env.VAPID_SUBJECT;

// Configurar apenas uma vez ao importar o módulo
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  console.log("[PUSH] VAPID configurado com sucesso");
} else {
  console.warn("[PUSH] AVISO: Chaves VAPID não encontradas no .env — notificações push desativadas");
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

/** Payload JSON enviado dentro da notificação push */
export type PushPayload = {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  /** URL para onde o usuário é levado ao clicar na notificação */
  url?: string;
  /** Tag para agrupar notificações do mesmo recurso (ex: "order-42") */
  tag?: string;
  /** true = a notificação permanece visível até o usuário interagir */
  requireInteraction?: boolean;
};

/** Resultado do envio para um usuário (pode ter várias subscriptions) */
export type SendPushResult = {
  delivered: boolean;
  attemptedCount: number;
  successCount: number;
};

// ─── Envio para uma subscription individual ───────────────────────────────────

/**
 * Envia push para uma subscription específica.
 * Retorna true se entregue, false em qualquer falha.
 * Em caso de 410/404 (subscription expirada), marca active=0 no banco.
 */
export async function sendPush(
  subscription: { id: number; endpoint: string; p256dh: string; auth: string },
  payload: PushPayload
): Promise<boolean> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    console.warn("[PUSH] Tentativa de envio sem VAPID configurado — ignorado");
    return false;
  }

  const pushSubscription = {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.p256dh,
      auth:   subscription.auth,
    },
  };

  try {
    await webpush.sendNotification(pushSubscription, JSON.stringify(payload));
    console.log(`[PUSH] Entregue com sucesso — subscriptionId=${subscription.id}`);
    return true;
  } catch (err: any) {
    const statusCode = err?.statusCode ?? err?.status ?? 0;

    // 410 Gone ou 404 Not Found = subscription inválida (navegador a removeu)
    if (statusCode === 410 || statusCode === 404) {
      console.log(`[PUSH] Subscription inválida (${statusCode}) — marcando active=0 id=${subscription.id}`);
      try {
        const db = await getDb();
        if (db) {
          await db
            .update(pushSubscriptions)
            .set({ active: 0 })
            .where(eq(pushSubscriptions.id, subscription.id));
        }
      } catch (dbErr: any) {
        console.error("[PUSH] Erro ao desativar subscription no banco:", dbErr?.message);
      }
    } else {
      console.error(`[PUSH] Erro ao enviar (status=${statusCode}):`, err?.message);
    }

    return false;
  }
}

// ─── Envio para todos os dispositivos de um usuário ──────────────────────────

/**
 * Busca todas as subscriptions ativas de um usuário e envia o payload para cada uma.
 * Retorna contadores para o log de notificações.
 */
export async function sendPushToUser(
  userId: number,
  userType: "client" | "technician",
  payload: PushPayload
): Promise<SendPushResult> {
  const db = await getDb();
  if (!db) {
    console.warn("[PUSH] Banco indisponível — push cancelado");
    return { delivered: false, attemptedCount: 0, successCount: 0 };
  }

  // Busca todas as subscriptions ativas do usuário
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userId, userId),
        eq(pushSubscriptions.userType, userType),
        eq(pushSubscriptions.active, 1)
      )
    );

  if (subs.length === 0) {
    console.log(`[PUSH] Nenhuma subscription ativa para userId=${userId} userType=${userType}`);
    return { delivered: false, attemptedCount: 0, successCount: 0 };
  }

  console.log(`[PUSH] Enviando para ${subs.length} subscription(s) — userId=${userId} userType=${userType}`);

  // Envia para todas em paralelo e atualiza lastUsedAt nas que tiveram sucesso
  const results = await Promise.all(
    subs.map(sub => sendPush(sub, payload))
  );

  const successCount = results.filter(Boolean).length;

  // Atualiza lastUsedAt nas subscriptions que foram entregues com sucesso
  const successfulSubIds = subs
    .filter((_, i) => results[i])
    .map(s => s.id);

  if (successfulSubIds.length > 0) {
    try {
      await Promise.all(
        successfulSubIds.map(subId =>
          db.update(pushSubscriptions)
            .set({ lastUsedAt: new Date() })
            .where(eq(pushSubscriptions.id, subId))
        )
      );
    } catch (updateErr: any) {
      // Falha no update de lastUsedAt não é crítica — só loga
      console.warn("[PUSH] Erro ao atualizar lastUsedAt:", updateErr?.message);
    }
  }

  const delivered = successCount > 0;
  console.log(`[PUSH] Resultado: ${successCount}/${subs.length} entregues — userId=${userId}`);

  return { delivered, attemptedCount: subs.length, successCount };
}
