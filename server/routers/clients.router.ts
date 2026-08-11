import * as db from "../db";
import { adminLocalProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { addEquipmentToMonthlyOs } from "../monthlyOsJob";
import { hashPassword } from "../adminAuth";
import { withTenant } from "../_core/tenant";

export const clientsRouter = router({
  // 3.7.2 — ISOLADO: lista por tenant (fronteira correta), não por adminId.
  list: adminLocalProcedure
    .input(z.object({
      search: z.string().optional(), // filtro de busca (usado no frontend, não na query SQL)
    }).optional())
    .query(async ({ ctx }) => {
      return await db.getClientsByTenant(ctx.tenantId);
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

      // withTenant carimba tenantId a partir do ctx (fail-closed) — não aceita
      // tenantId vindo do input.
      await db.createClient(
        withTenant(ctx, {
          ...clientData,
          adminId: ctx.adminId,
          username: finalUsername,
          type,
          email: clientData.email || null,
          password: hashedPassword,
          active: 1,
        })
      );

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
    .mutation(async ({ input, ctx }) => {
      const { id, ...updateData } = input;

      // GUARDA: cliente precisa pertencer ao tenant do admin logado.
      const existing = await db.getClientById(id);
      if (!existing || existing.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado" });
      }

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
    .mutation(async ({ input, ctx }) => {
      // GUARDA: cliente precisa pertencer ao tenant do admin logado.
      const existing = await db.getClientById(input.id);
      if (!existing || existing.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado" });
      }

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
    .mutation(async ({ input, ctx }) => {
      const id = input.id ?? input.clientId;
      if (!id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "ID do cliente não informado" });
      }

      // GUARDA: cliente precisa pertencer ao tenant do admin logado.
      const existing = await db.getClientById(id);
      if (!existing || existing.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado" });
      }

      await db.deleteClient(id);
      return { success: true, message: "Cliente deletado com sucesso" };
    }),

  // ISOLADO COM GUARDA
  getById: adminLocalProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const client = await db.getClientById(input.id);
      if (!client || client.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado" });
      }
      return client;
    }),

  // ISOLADO COM GUARDA (getClientByUsername continua global para suportar o login)
  getByUsername: adminLocalProcedure
    .input(z.object({ username: z.string() }))
    .query(async ({ input, ctx }) => {
      const client = await db.getClientByUsername(input.username);
      if (!client || client.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado" });
      }
      return client;
    }),

  // 3.7.2 — ISOLADO: mensagem em massa só alcança clientes do tenant.
  broadcastMessage: adminLocalProcedure
    .input(z.object({
      message: z.string().min(1),
      targetType: z.enum(["all", "com_portal", "sem_portal", "selected"]),
      clientIds: z.array(z.number()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const allClients = await db.getClientsByTenant(ctx.tenantId);

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
        // GUARDA: cliente precisa pertencer ao tenant do admin logado (fronteira correta).
        const client = await db.getClientById(input.clientId);
        if (!client || client.tenantId !== ctx.tenantId) {
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
        // GUARDA: cliente precisa pertencer ao tenant do admin logado (fronteira correta).
        const client = await db.getClientById(input.clientId);
        if (!client || client.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado" });
        }

        const id = await db.addClientEquipment({
          clientId:    input.clientId,
          type:        input.type,
          description: input.description,
        });

        // Busca ou cria a OS do mês e adiciona checklist para este equipamento
        const osResult = await addEquipmentToMonthlyOs(ctx.adminId, input.clientId, {
          type:        input.type,
          description: input.description,
        });

        return { id, monthlyOs: osResult };
      }),

    /**
     * Remove um equipamento.
     * GUARDA MULTI-ETAPA (client_equipment não tem tenantId próprio):
     * 1. busca o equipamento para achar o clientId dono;
     * 2. busca o cliente para checar o tenantId.
     * ANTES: sem nenhuma checagem de posse — qualquer admin logado podia
     * remover equipamento de qualquer cliente, de qualquer tenant, só
     * sabendo o ID. Corrigido aqui junto com o isolamento.
     */
    remove: adminLocalProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const equipment = await db.getClientEquipmentById(input.id);
        if (!equipment) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Equipamento não encontrado" });
        }

        const client = await db.getClientById(equipment.clientId);
        if (!client || client.tenantId !== ctx.tenantId) {
          // NOT_FOUND (não FORBIDDEN) para não vazar a existência do equipamento em outro tenant.
          throw new TRPCError({ code: "NOT_FOUND", message: "Equipamento não encontrado" });
        }

        await db.removeClientEquipment(input.id);
        return { success: true };
      }),
  }),
});
