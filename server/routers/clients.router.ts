import * as db from "../db";
import { adminLocalProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createMonthlyOsForClient } from "../monthlyOsJob";
import { hashPassword } from "../adminAuth";

export const clientsRouter = router({
  // Lista clientes do admin autenticado — adminId vem do JWT (ctx), não do input.
  list: adminLocalProcedure
    .input(z.object({
      search: z.string().optional(), // filtro de busca (usado no frontend, não na query SQL)
    }).optional())
    .query(async ({ ctx }) => {
      return await db.getClientsByAdminId(ctx.adminId);
    }),

  // Cria novo cliente vinculado ao admin autenticado — adminId vem do JWT (ctx).
  create: adminLocalProcedure
    .input(z.object({
      name: z.string().min(1),
      email: z.string().email().optional().or(z.literal("")),
      username: z.string().max(100).optional().or(z.literal("")),
      password: z.string().optional().or(z.literal("")),
      cnpjCpf: z.string().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      syndicName: z.string().optional(),
      type: z.enum(["com_portal", "sem_portal"]).default("com_portal"),
    }))
    .mutation(async ({ input, ctx }) => {
      const { password, username, type, ...clientData } = input;

      if (type === "com_portal") {
        if (!username || username.length < 3) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Nome de usuário é obrigatório para clientes com portal (mínimo 3 caracteres)" });
        }
        if (!password || password.length < 6) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Senha é obrigatória para clientes com portal (mínimo 6 caracteres)" });
        }
      }

      const finalUsername = (type === "sem_portal" && (!username || !username.trim()))
        ? `_sp_${ctx.adminId}_${Date.now()}`
        : username!;

      // crypto.randomBytes é mais seguro que Math.random() para geração de senhas aleatórias
      const { randomBytes } = await import("crypto");
      const finalPassword = (type === "sem_portal" && (!password || !password.trim()))
        ? randomBytes(16).toString("hex")
        : password!;

      const hashedPassword = await hashPassword(finalPassword);

      await db.createClient({
        ...clientData,
        adminId: ctx.adminId,
        username: finalUsername,
        type,
        email: clientData.email || null,
        password: hashedPassword,
        active: 1,
      });

      return { success: true, message: "Cliente criado com sucesso" };
    }),

  update: adminLocalProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      email: z.union([z.string().email(), z.literal("")]).optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      cnpjCpf: z.string().optional(),
      syndicName: z.string().optional(),
      profilePhoto: z.string().optional(),
      type: z.enum(["com_portal", "sem_portal"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...updateData } = input;
      try {
        await db.updateClient(id, updateData);
        return { success: true, message: "Cliente atualizado com sucesso" };
      } catch (error) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: error instanceof Error ? error.message : "Erro ao atualizar cliente",
        });
      }
    }),

  updatePassword: adminLocalProcedure
    .input(z.object({
      id: z.number(),
      newPassword: z.string().min(6),
    }))
    .mutation(async ({ input }) => {
      try {
        const hashedPassword = await hashPassword(input.newPassword);
        await db.updateClientPassword(input.id, hashedPassword);
        return { success: true, message: "Senha atualizada com sucesso" };
      } catch (error) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: error instanceof Error ? error.message : "Erro ao atualizar senha",
        });
      }
    }),

  delete: adminLocalProcedure
    .input(z.object({
      id: z.number().optional(),
      clientId: z.number().optional(),
      adminId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = input.id ?? input.clientId;
      if (!id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "ID do cliente não informado" });
      }
      await db.deleteClient(id);
      return { success: true, message: "Cliente deletado com sucesso" };
    }),

  getById: adminLocalProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return await db.getClientById(input.id);
    }),

  getByUsername: adminLocalProcedure
    .input(z.object({ username: z.string() }))
    .query(async ({ input }) => {
      return await db.getClientByUsername(input.username);
    }),

  // Envio em massa de mensagens WhatsApp — adminId vem do JWT (ctx), não do input.
  broadcastMessage: adminLocalProcedure
    .input(z.object({
      message: z.string().min(1),
      targetType: z.enum(["all", "com_portal", "sem_portal", "selected"]),
      clientIds: z.array(z.number()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const allClients = await db.getClientsByAdminId(ctx.adminId);

      let targets = allClients;
      if (input.targetType === "com_portal") {
        targets = allClients.filter(c => c.type === "com_portal");
      } else if (input.targetType === "sem_portal") {
        targets = allClients.filter(c => c.type === "sem_portal");
      } else if (input.targetType === "selected") {
        const ids = new Set(input.clientIds ?? []);
        targets = allClients.filter(c => ids.has(c.id));
      }

      const { sendWhatsappToNumber } = await import("../whatsapp");

      // Substitui variáveis {{campo}} pelos dados reais do cliente antes de enviar
      const replaceVars = (msg: string, c: typeof targets[number]) =>
        msg
          .replace(/\{\{nome\}\}/g,     c.name       || "")
          .replace(/\{\{usuario\}\}/g,  c.username   || "")
          .replace(/\{\{telefone\}\}/g, c.phone      || "")
          .replace(/\{\{email\}\}/g,    c.email      || "")
          .replace(/\{\{endereco\}\}/g, c.address    || "")
          .replace(/\{\{sindico\}\}/g,  (c as any).syndicName || "")
          .replace(/\{\{cnpj\}\}/g,     c.cnpjCpf    || "");

      const results: Array<{ id: number; name: string; phone: string; status: "sent" | "failed" | "skipped"; reason?: string }> = [];

      for (const client of targets) {
        if (!client.phone) {
          results.push({ id: client.id, name: client.name, phone: "", status: "skipped", reason: "Sem telefone cadastrado" });
          continue;
        }
        try {
          const finalMessage = replaceVars(input.message, client);
          await sendWhatsappToNumber(client.phone, finalMessage);
          results.push({ id: client.id, name: client.name, phone: client.phone, status: "sent" });
        } catch (err: any) {
          results.push({ id: client.id, name: client.name, phone: client.phone, status: "failed", reason: err?.message ?? "Erro desconhecido" });
        }
      }

      const sent = results.filter(r => r.status === "sent").length;
      const failed = results.filter(r => r.status === "failed").length;
      const skipped = results.filter(r => r.status === "skipped").length;

      return { total: targets.length, sent, failed, skipped, results };
    }),

  // ── Equipamentos do cliente ──────────────────────────────────
  equipment: router({

    /** Lista os equipamentos cadastrados para um cliente. */
    list: adminLocalProcedure
      .input(z.object({ clientId: z.number() }))
      .query(async ({ input, ctx }) => {
        // Garante que o cliente pertence ao admin autenticado
        const client = await db.getClientById(input.clientId);
        if (!client || client.adminId !== ctx.adminId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado" });
        }
        return await db.getClientEquipment(input.clientId);
      }),

    /**
     * Adiciona um equipamento ao cliente.
     * Após salvar, dispara a geração da OS mensal do mês corrente
     * (pula silenciosamente se a OS já existir).
     */
    add: adminLocalProcedure
      .input(z.object({
        clientId:    z.number(),
        type:        z.enum(["bomba", "gerador"]),
        description: z.string().min(1).max(255),
      }))
      .mutation(async ({ input, ctx }) => {
        const client = await db.getClientById(input.clientId);
        if (!client || client.adminId !== ctx.adminId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado" });
        }

        const id = await db.addClientEquipment({
          clientId:    input.clientId,
          type:        input.type,
          description: input.description,
        });

        // Tenta criar OS do mês corrente (idempotente — pula se já existe)
        const osResult = await createMonthlyOsForClient(ctx.adminId, input.clientId);

        return { id, monthlyOs: osResult };
      }),

    /** Remove um equipamento. */
    remove: adminLocalProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.removeClientEquipment(input.id);
        return { success: true };
      }),
  }),
});
