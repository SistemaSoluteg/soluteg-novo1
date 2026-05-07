/**
 * server/routers/pushSubscriptions.ts
 *
 * Router tRPC para gerenciamento de subscriptions de Web Push.
 *
 * Procedures:
 *   getVapidPublicKey  → publicProcedure: chave pública VAPID para o frontend se inscrever
 *   subscribe          → protectedClientProcedure ou protectedTechnicianProcedure
 *   unsubscribe        → protectedClientProcedure ou protectedTechnicianProcedure
 *   listMine           → lista as subscriptions ativas do usuário logado
 *
 * SEGURANÇA:
 *   userId e userType NUNCA vêm do input — sempre do ctx.clientId / ctx.technicianId.
 *   Qualquer tentativa de informar userId no corpo da requisição é ignorada.
 */

import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { router, publicProcedure, protectedClientProcedure, protectedTechnicianProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { pushSubscriptions } from "../../drizzle/schema";

// ─── Router ───────────────────────────────────────────────────────────────────

export const pushSubscriptionsRouter = router({

  /**
   * Retorna a chave pública VAPID para o frontend criar a subscription no navegador.
   * É publicProcedure pois o frontend precisa da chave ANTES de fazer login
   * (embora na prática o usuário já esteja logado quando ativa notificações).
   */
  getVapidPublicKey: publicProcedure.query(() => {
    const key = process.env.VAPID_PUBLIC_KEY;
    if (!key) {
      console.warn("[PUSH] getVapidPublicKey chamado sem VAPID_PUBLIC_KEY configurado");
    }
    return { vapidPublicKey: key ?? null };
  }),

  // ── Portal do Cliente ──────────────────────────────────────────────────────

  /**
   * Registra ou atualiza a subscription push do cliente logado.
   * Usa upsert pelo endpoint — se o endpoint já existe para este cliente, só atualiza.
   */
  subscribeClient: protectedClientProcedure
    .input(z.object({
      endpoint:  z.string().url("Endpoint inválido"),
      keys: z.object({
        p256dh: z.string().min(1),
        auth:   z.string().min(1),
      }),
      userAgent: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // ctx.clientId vem do JWT — nunca do input
      const userId   = ctx.clientId;
      const userType = "client" as const;

      const db = await getDb();
      if (!db) throw new Error("Banco indisponível");

      // Verifica se já existe subscription com este endpoint para este cliente
      const existing = await db
        .select({ id: pushSubscriptions.id })
        .from(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.userId,   userId),
            eq(pushSubscriptions.userType, userType),
            eq(pushSubscriptions.endpoint, input.endpoint)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        // Atualiza: reativa se estava inativa + atualiza chaves e lastUsedAt
        await db
          .update(pushSubscriptions)
          .set({
            p256dh:    input.keys.p256dh,
            auth:      input.keys.auth,
            userAgent: input.userAgent ?? null,
            active:    1,
            lastUsedAt: new Date(),
          })
          .where(eq(pushSubscriptions.id, existing[0].id));

        console.log(`[PUSH] Subscription cliente atualizada — clientId=${userId}`);
        return { success: true, action: "updated" as const };
      }

      // Insere nova subscription
      await db.insert(pushSubscriptions).values({
        userId,
        userType,
        endpoint:  input.endpoint,
        p256dh:    input.keys.p256dh,
        auth:      input.keys.auth,
        userAgent: input.userAgent ?? null,
        active:    1,
      });

      console.log(`[PUSH] Nova subscription cliente registrada — clientId=${userId}`);
      return { success: true, action: "created" as const };
    }),

  /**
   * Desativa a subscription push do cliente logado para um endpoint específico.
   * Marca active=0 em vez de deletar para manter o histórico.
   */
  unsubscribeClient: protectedClientProcedure
    .input(z.object({ endpoint: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Banco indisponível");

      await db
        .update(pushSubscriptions)
        .set({ active: 0 })
        .where(
          and(
            eq(pushSubscriptions.userId,   ctx.clientId),
            eq(pushSubscriptions.userType, "client"),
            eq(pushSubscriptions.endpoint, input.endpoint)
          )
        );

      console.log(`[PUSH] Subscription cliente desativada — clientId=${ctx.clientId}`);
      return { success: true };
    }),

  /**
   * Lista subscriptions ativas do cliente logado.
   * Usado na tela de configurações para mostrar dispositivos registrados.
   */
  listMineClient: protectedClientProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];

    return db
      .select({
        id:        pushSubscriptions.id,
        userAgent: pushSubscriptions.userAgent,
        lastUsedAt: pushSubscriptions.lastUsedAt,
        createdAt: pushSubscriptions.createdAt,
      })
      .from(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.userId,   ctx.clientId),
          eq(pushSubscriptions.userType, "client"),
          eq(pushSubscriptions.active,   1)
        )
      );
  }),

  // ── Portal do Técnico ──────────────────────────────────────────────────────

  /**
   * Registra ou atualiza a subscription push do técnico logado.
   */
  subscribeTechnician: protectedTechnicianProcedure
    .input(z.object({
      endpoint:  z.string().url("Endpoint inválido"),
      keys: z.object({
        p256dh: z.string().min(1),
        auth:   z.string().min(1),
      }),
      userAgent: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // ctx.technicianId vem do JWT — nunca do input
      const userId   = ctx.technicianId;
      const userType = "technician" as const;

      const db = await getDb();
      if (!db) throw new Error("Banco indisponível");

      const existing = await db
        .select({ id: pushSubscriptions.id })
        .from(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.userId,   userId),
            eq(pushSubscriptions.userType, userType),
            eq(pushSubscriptions.endpoint, input.endpoint)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(pushSubscriptions)
          .set({
            p256dh:    input.keys.p256dh,
            auth:      input.keys.auth,
            userAgent: input.userAgent ?? null,
            active:    1,
            lastUsedAt: new Date(),
          })
          .where(eq(pushSubscriptions.id, existing[0].id));

        console.log(`[PUSH] Subscription técnico atualizada — technicianId=${userId}`);
        return { success: true, action: "updated" as const };
      }

      await db.insert(pushSubscriptions).values({
        userId,
        userType,
        endpoint:  input.endpoint,
        p256dh:    input.keys.p256dh,
        auth:      input.keys.auth,
        userAgent: input.userAgent ?? null,
        active:    1,
      });

      console.log(`[PUSH] Nova subscription técnico registrada — technicianId=${userId}`);
      return { success: true, action: "created" as const };
    }),

  /**
   * Desativa a subscription push do técnico logado para um endpoint específico.
   */
  unsubscribeTechnician: protectedTechnicianProcedure
    .input(z.object({ endpoint: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Banco indisponível");

      await db
        .update(pushSubscriptions)
        .set({ active: 0 })
        .where(
          and(
            eq(pushSubscriptions.userId,   ctx.technicianId),
            eq(pushSubscriptions.userType, "technician"),
            eq(pushSubscriptions.endpoint, input.endpoint)
          )
        );

      console.log(`[PUSH] Subscription técnico desativada — technicianId=${ctx.technicianId}`);
      return { success: true };
    }),

  /**
   * Lista subscriptions ativas do técnico logado.
   */
  listMineTechnician: protectedTechnicianProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];

    return db
      .select({
        id:        pushSubscriptions.id,
        userAgent: pushSubscriptions.userAgent,
        lastUsedAt: pushSubscriptions.lastUsedAt,
        createdAt: pushSubscriptions.createdAt,
      })
      .from(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.userId,   ctx.technicianId),
          eq(pushSubscriptions.userType, "technician"),
          eq(pushSubscriptions.active,   1)
        )
      );
  }),
});
