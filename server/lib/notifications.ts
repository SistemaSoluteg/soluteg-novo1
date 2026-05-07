/**
 * server/lib/notifications.ts
 *
 * Hub central de notificações do sistema Soluteg.
 *
 * ESTRATÉGIA DE ROTEAMENTO:
 *   - Admin: sempre WhatsApp (sem PWA nesta fase)
 *   - Cliente/Técnico com channel='auto': tenta Push primeiro → fallback WhatsApp
 *   - channel='whatsapp-only': WhatsApp direto (ex: OS concluída com PDF)
 *   - channel='push-only': só push, sem fallback
 *
 * Todas as tentativas são registradas em notificationLogs para debug.
 * Prefixo de log: [NOTIFY]
 */

import { getDb } from "../db";
import { notificationLogs } from "../../drizzle/schema";
import { sendPushToUser, type PushPayload } from "./webPush";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

/**
 * Payload completo de uma notificação.
 * Os campos `title`, `body` e `url` são usados tanto no push quanto como
 * referência para montar a mensagem WhatsApp (via `whatsappMessage`).
 */
export type NotificationPayload = {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  /** Rota interna para navegar ao clicar na notificação (ex: /technician/orders/42) */
  url?: string;
  /** Agrupa notificações do mesmo recurso no celular (ex: "order-42") */
  tag?: string;
  /** true = a notificação fica visível até o usuário interagir (use em alarmes críticos) */
  requireInteraction?: boolean;
  /** Texto pronto para WhatsApp — se omitido, usa `title + "\n" + body` */
  whatsappMessage?: string;
  /** URL do PDF/anexo para envio via WhatsApp (ex: OS concluída) */
  attachmentUrl?: string;
};

/** Opções que definem quem recebe e por qual canal */
export type NotificationOptions = {
  userId: number;
  userType: "client" | "technician" | "admin";
  /** Tipo do evento para o log (alarm, order_new, order_updated, order_completed, budget_new, etc.) */
  notificationType: string;
  /**
   * auto         = tenta push, cai para WhatsApp se falhar ou sem subscription
   * whatsapp-only = WhatsApp direto (ex: OS concluída com PDF — canal obrigatório)
   * push-only    = só push, sem fallback (raro)
   */
  channel: "auto" | "whatsapp-only" | "push-only";
  /** Número do WhatsApp no formato E.164 (ex: "5513991234567") — obrigatório para canal auto/whatsapp-only */
  whatsappPhone?: string;
};

/** Resultado do envio */
export type NotifyResult = {
  delivered: boolean;
  channelUsed: "push" | "whatsapp" | "email" | "none";
  error?: string;
};

// ─── Função principal ─────────────────────────────────────────────────────────

/**
 * Envia uma notificação usando a estratégia de canal correta e registra o log.
 *
 * Não lança exceção — em caso de falha total, loga o erro e retorna { delivered: false }.
 * O chamador pode checar o resultado, mas não precisa tratar exceção.
 */
export async function notify(
  payload: NotificationPayload,
  options: NotificationOptions
): Promise<NotifyResult> {
  const { userId, userType, notificationType, channel, whatsappPhone } = options;

  console.log(`[NOTIFY] Iniciando — userId=${userId} userType=${userType} type=${notificationType} channel=${channel}`);

  // Admin e whatsapp-only vão direto para WhatsApp
  if (userType === "admin" || channel === "whatsapp-only") {
    return sendViaWhatsapp(payload, options, notificationType);
  }

  // push-only: só push, sem fallback
  if (channel === "push-only") {
    return sendViaPush(payload, options, notificationType, false);
  }

  // auto: tenta push → fallback WhatsApp se não entregar
  const pushResult = await sendViaPush(payload, options, notificationType, true);
  if (pushResult.delivered) {
    return pushResult;
  }

  // Fallback: push não entregou → tenta WhatsApp
  console.log(`[NOTIFY] Push não entregou — acionando fallback WhatsApp para userId=${userId}`);

  if (!whatsappPhone) {
    console.warn(`[NOTIFY] Fallback WhatsApp ignorado — whatsappPhone não fornecido para userId=${userId}`);
    return pushResult; // retorna o resultado do push (falho)
  }

  return sendViaWhatsapp(payload, options, notificationType);
}

// ─── Envio via push ───────────────────────────────────────────────────────────

async function sendViaPush(
  payload: NotificationPayload,
  options: NotificationOptions,
  notificationType: string,
  isAttemptOnly: boolean  // true = pode falhar silenciosamente para o fallback funcionar
): Promise<NotifyResult> {
  const { userId, userType } = options;

  const pushPayload: PushPayload = {
    title:               payload.title,
    body:                payload.body,
    icon:                payload.icon  ?? "/icon-192.png",
    badge:               payload.badge ?? "/badge-72.png",
    url:                 payload.url,
    tag:                 payload.tag,
    requireInteraction:  payload.requireInteraction,
  };

  try {
    const result = await sendPushToUser(userId, userType as "client" | "technician", pushPayload);

    // Se não há subscriptions ativas, não é erro — apenas não há como entregar via push
    if (result.attemptedCount === 0) {
      console.log(`[NOTIFY] Sem subscriptions push para userId=${userId} — ${isAttemptOnly ? "tentando fallback" : "ignorando"}`);
      return { delivered: false, channelUsed: "none" };
    }

    const success = result.delivered;
    await saveLog({
      userId, userType, notificationType,
      channel:      "push",
      success:      success ? 1 : 0,
      errorMessage: success ? null : "Todas as subscriptions falharam",
      payload,
    });

    return {
      delivered:   success,
      channelUsed: "push",
      error:       success ? undefined : "Todas as subscriptions falharam",
    };
  } catch (err: any) {
    console.error(`[NOTIFY] Erro inesperado no push para userId=${userId}:`, err?.message);
    return { delivered: false, channelUsed: "push", error: err?.message };
  }
}

// ─── Envio via WhatsApp ───────────────────────────────────────────────────────

async function sendViaWhatsapp(
  payload: NotificationPayload,
  options: NotificationOptions,
  notificationType: string
): Promise<NotifyResult> {
  const { userId, userType, whatsappPhone } = options;

  if (!whatsappPhone) {
    console.warn(`[NOTIFY] WhatsApp ignorado — sem número para userId=${userId}`);
    await saveLog({
      userId, userType, notificationType,
      channel:      "whatsapp",
      success:      0,
      errorMessage: "Número WhatsApp não fornecido",
      payload,
    });
    return { delivered: false, channelUsed: "whatsapp", error: "Número WhatsApp não fornecido" };
  }

  const message = payload.whatsappMessage ?? `${payload.title}\n${payload.body}`;

  try {
    const { sendWhatsappToNumber } = await import("../whatsapp");
    await sendWhatsappToNumber(whatsappPhone, message);

    console.log(`[NOTIFY] WhatsApp entregue para ${whatsappPhone} — userId=${userId}`);
    await saveLog({
      userId, userType, notificationType,
      channel:  "whatsapp",
      success:  1,
      payload,
    });

    return { delivered: true, channelUsed: "whatsapp" };
  } catch (err: any) {
    console.error(`[NOTIFY] Erro no WhatsApp para ${whatsappPhone}:`, err?.message);
    await saveLog({
      userId, userType, notificationType,
      channel:      "whatsapp",
      success:      0,
      errorMessage: err?.message,
      payload,
    });
    return { delivered: false, channelUsed: "whatsapp", error: err?.message };
  }
}

// ─── Persistência do log ──────────────────────────────────────────────────────

async function saveLog(params: {
  userId: number;
  userType: "client" | "technician" | "admin";
  notificationType: string;
  channel: "push" | "whatsapp" | "email";
  success: 0 | 1;
  errorMessage?: string | null;
  payload: NotificationPayload;
}): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    await db.insert(notificationLogs).values({
      userId:           params.userId,
      userType:         params.userType,
      notificationType: params.notificationType,
      channel:          params.channel,
      success:          params.success,
      errorMessage:     params.errorMessage ?? null,
      // Salva o payload sem o whatsappMessage longo (economiza espaço)
      payload: {
        title:              params.payload.title,
        body:               params.payload.body,
        url:                params.payload.url,
        tag:                params.payload.tag,
        requireInteraction: params.payload.requireInteraction,
      },
    });
  } catch (logErr: any) {
    // Nunca deixar falha no log quebrar o fluxo principal
    console.error("[NOTIFY] Erro ao salvar log de notificação:", logErr?.message);
  }
}
