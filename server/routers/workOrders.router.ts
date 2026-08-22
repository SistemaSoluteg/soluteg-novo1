import * as db from "../db";
import { sendWhatsappAlert } from "../whatsapp";
import { adminLocalProcedure, protectedClientProcedure, router } from "../_core/trpc";
import { withTenant } from "../_core/tenant";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { notify } from "../lib/notifications";

export const workOrdersRouter = router({
  list: adminLocalProcedure
    .input(z.object({
      clientId: z.number().optional(),
      type: z.enum(["rotina", "emergencial", "instalacao", "manutencao", "corretiva", "preventiva"]).optional(),
      status: z.string().optional(),
      priority: z.string().optional(),
      search: z.string().optional(),
      page: z.number().default(1),
      limit: z.number().default(10),
      sortBy: z.string().default("createdAt"),
      sortOrder: z.enum(["asc", "desc"]).default("desc"),
    })) // ISOLADO
    .query(async ({ input, ctx }) => {
      const workOrdersDb = await import("../workOrdersDb");
      return await workOrdersDb.listWorkOrders({
        ...input,
        tenantId: ctx.tenantId,
      });
    }),

  getById: adminLocalProcedure // ISOLADO COM GUARDA
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const workOrdersDb = await import("../workOrdersDb");
      const wo = await workOrdersDb.getWorkOrderById(input.id);
      if (!wo || wo.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ordem de Serviço não encontrada" });
      }
      return wo;
    }),

  create: adminLocalProcedure
    .input(z.object({
      clientId: z.number(),
      type: z.enum(["rotina", "emergencial", "instalacao", "manutencao", "corretiva", "preventiva"]),
      priority: z.enum(["normal", "alta", "critica"]).default("normal"),
      title: z.string().min(1),
      description: z.string().optional(),
      serviceType: z.string().optional(),
      scheduledDate: z.string().optional(),
      estimatedHours: z.number().optional(),
      estimatedValue: z.number().optional(),
      isRecurring: z.number().optional().default(0),
      recurrenceType: z.enum(["mensal_fixo", "mensal_inicio"]).optional(),
      recurrenceDay: z.number().optional(),
      technicianId: z.number().nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const workOrdersDb = await import("../workOrdersDb");

      // GUARDA: o cliente precisa pertencer ao tenant do admin logado.
      // ANTES: sem checagem — dava pra criar OS no tenant 1 referenciando clientId
      // de outro tenant, vazando nome/telefone/endereço desse cliente no PDF e no Zap.
      const cliente = await db.getClientById(input.clientId);
      if (!cliente || cliente.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado" });
      }

      // GUARDA: se um técnico foi informado, precisa pertencer ao mesmo tenant.
      let tech: any;
      if (input.technicianId) {
        const technicianDb = await import("../technicianDb");
        tech = await technicianDb.getTechnicianById(input.technicianId, ctx.tenantId);
        if (!tech) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Técnico não encontrado" });
        }
      }

      const dataToCreate = withTenant(ctx, {
        ...input,
        adminId: ctx.adminId,
        scheduledDate: input.scheduledDate ? new Date(input.scheduledDate) : undefined,
      });

      // O tipo `any` é necessário aqui porque `withTenant` adiciona `tenantId` que
      // a função `createWorkOrder` não espera explicitamente, mas o Drizzle
      // o insere corretamente no banco de dados.
      const result = await workOrdersDb.createWorkOrder(dataToCreate as any) as any;
      const osId = result?.insertId || result?.id || (Array.isArray(result) ? result[0] : result);

      console.log(`--- DEBUG JNC: OS criada com ID ${osId} ---`);

      const nomeCliente = cliente.name || `ID ${input.clientId}`;
      const portalUrl = `https://app.soluteg.com.br/gestor/work-orders/${osId}`;

      const msg =
        `🚨 *NOVA OS - PORTAL JNC SOLUTEG* 🚨\n\n` +
        `🛠️ *Serviço:* ${input.title}\n` +
        `🏢 *Condomínio:* ${nomeCliente}\n` +
        `📅 *Tipo:* ${input.type.toUpperCase()}\n` +
        `⚡ *Prioridade:* ${input.priority.toUpperCase()}\n\n` +
        `🔗 *Acesse os detalhes aqui:* \n${portalUrl}`;

      sendWhatsappAlert(msg).catch(e => console.error("Erro no Zap JNC:", e));

      // Notifica o técnico se foi atribuído na criação (já validado pela guarda acima)
      if (input.technicianId) {
        notify(
          {
            title: "Nova OS atribuída",
            body: `${input.title} — ${nomeCliente}`,
            url: `/technician/work-orders/${osId}`,
            tag: `order-${osId}`,
            whatsappMessage:
              `🛠️ *Nova OS atribuída*\n\n` +
              `OS: ${osId}\n` +
              `Serviço: ${input.title}\n` +
              `Cliente: ${nomeCliente}\n` +
              `Acesse: https://app.soluteg.com.br/technician/work-orders/${osId}`,
          },
          {
            userId: input.technicianId,
            userType: "technician",
            notificationType: "order_new",
            channel: "auto",
            whatsappPhone: tech?.phone ?? undefined,
          }
        ).catch(e => console.error("[NOTIFY] Erro ao notificar técnico na criação:", e));
      }

      return { success: true, message: "OS criada com sucesso", id: osId, osNumber: result?.osNumber };
    }),

  update: adminLocalProcedure
    .input(z.object({
      id: z.number(),
      title: z.string().optional(),
      description: z.string().optional(),
      serviceType: z.string().optional(),
      status: z.enum([
        "aberta",
        "aguardando_aprovacao",
        "aprovada",
        "rejeitada",
        "em_andamento",
        "concluida",
        "aguardando_pagamento",
        "cancelada"
      ]).optional(),
      priority: z.enum(["normal", "alta", "critica"]).optional(),
      scheduledDate: z.string().optional(),
      startedAt: z.date().optional(),
      completedAt: z.date().optional(),
      estimatedHours: z.number().optional(),
      actualHours: z.number().optional(),
      estimatedValue: z.number().optional(),
      finalValue: z.number().optional(),
      internalNotes: z.string().optional(),
      clientNotes: z.string().optional(),
      cancellationReason: z.string().optional(),
      technicianId: z.number().nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const workOrdersDb = await import("../workOrdersDb");

      // GUARDA: OS precisa pertencer ao tenant do admin logado.
      const existing = await workOrdersDb.getWorkOrderById(input.id);
      if (!existing || existing.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ordem de Serviço não encontrada" });
      }

      // GUARDA: se um technicianId foi informado (não-nulo), precisa pertencer ao mesmo tenant.
      if (input.technicianId) {
        const technicianDb = await import("../technicianDb");
        const tech = await technicianDb.getTechnicianById(input.technicianId, ctx.tenantId);
        if (!tech) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Técnico não encontrado" });
        }
      }

      const { id, ...data } = input;
      const convertedData = {
        ...data,
        scheduledDate: data.scheduledDate ? new Date(data.scheduledDate) : undefined,
      };
      await workOrdersDb.updateWorkOrder(id, convertedData as any);

      // Notifica o técnico sobre a alteração (se a OS tiver técnico atribuído)
      // A busca aqui é segura pois a guarda já foi feita.
      const osAtualizada = await workOrdersDb.getWorkOrderById(id);
      if (osAtualizada?.technicianId) {
        const technicianDb = await import("../technicianDb");
        const tech = await technicianDb.getTechnicianById(osAtualizada.technicianId);
        notify(
          {
            title: "OS atualizada",
            body: `${osAtualizada.title} — ${osAtualizada.clientName ?? ""}`,
            url: `/technician/work-orders/${id}`,
            tag: `order-${id}`,
            whatsappMessage:
              `📋 *OS atualizada*\n\n` +
              `Serviço: ${osAtualizada.title}\n` +
              `Cliente: ${osAtualizada.clientName ?? ""}\n` +
              `Acesse: https://app.soluteg.com.br/technician/work-orders/${id}`,
          },
          {
            userId: osAtualizada.technicianId,
            userType: "technician",
            notificationType: "order_updated",
            channel: "auto",
            whatsappPhone: tech?.phone ?? undefined,
          }
        ).catch(e => console.error("[NOTIFY] Erro ao notificar técnico na atualização:", e));
      }

      return { success: true, message: "OS atualizada com sucesso" };
    }),

  updateStatus: adminLocalProcedure
    .input(z.object({
      id: z.number(),
      newStatus: z.string(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const workOrdersDb = await import("../workOrdersDb");

      // GUARDA: OS precisa pertencer ao tenant do admin logado.
      const existing = await workOrdersDb.getWorkOrderById(input.id);
      if (!existing || existing.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ordem de Serviço não encontrada" });
      }

      // changedBy e changedByType vêm do JWT, não do frontend
      await workOrdersDb.updateWorkOrderStatus(
        input.id,
        input.newStatus,
        `admin-${ctx.adminId}`,
        "admin",
        input.notes
      );
      return { success: true, message: "Status atualizado com sucesso" };
    }),

  getHistory: adminLocalProcedure
    .input(z.object({ workOrderId: z.number() }))
    .query(async ({ input, ctx }) => {
      const workOrdersDb = await import("../workOrdersDb");

      // GUARDA: OS precisa pertencer ao tenant do admin logado.
      const existing = await workOrdersDb.getWorkOrderById(input.workOrderId);
      if (!existing || existing.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Histórico não encontrado" });
      }

      return await workOrdersDb.getWorkOrderHistory(input.workOrderId);
    }),

  assignTechnician: adminLocalProcedure
    .input(z.object({
      workOrderId: z.number(),
      technicianId: z.number().nullable(),
    }))
    .mutation(async ({ input, ctx }) => {
      const workOrdersDb = await import("../workOrdersDb");

      // GUARDA: OS precisa pertencer ao tenant do admin logado.
      const existing = await workOrdersDb.getWorkOrderById(input.workOrderId);
      if (!existing || existing.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ordem de Serviço não encontrada" });
      }

      // GUARDA: se um técnico foi informado (não-nulo), precisa pertencer ao mesmo tenant.
      // technicianId pode vir null pra desatribuir — nesse caso não valida, só passa adiante.
      let tech: any;
      if (input.technicianId) {
        const technicianDb = await import("../technicianDb");
        tech = await technicianDb.getTechnicianById(input.technicianId, ctx.tenantId);
        if (!tech) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Técnico não encontrado" });
        }
      }

      await workOrdersDb.assignTechnicianToWorkOrder(input.workOrderId, input.technicianId);

      // Notifica o técnico recém-atribuído (se algum foi passado, já validado pela guarda acima)
      if (input.technicianId) {
        const os = await workOrdersDb.getWorkOrderById(input.workOrderId);

        if (os) {
          notify(
            {
              title: "Nova OS atribuída a você",
              body: `${os.title} — ${os.clientName ?? ""}`,
              url: `/technician/work-orders/${input.workOrderId}`,
              tag: `order-${input.workOrderId}`,
              requireInteraction: true,
              whatsappMessage:
                `🛠️ *Nova OS atribuída*\n\n` +
                `Olá, ${tech?.name ?? "Técnico"}!\n\n` +
                `OS: ${os.osNumber}\n` +
                `Serviço: ${os.title}\n` +
                `Cliente: ${os.clientName ?? ""}\n\n` +
                `Acesse: https://app.soluteg.com.br/technician/work-orders/${input.workOrderId}`,
            },
            {
              userId: input.technicianId,
              userType: "technician",
              notificationType: "order_new",
              channel: "auto",
              whatsappPhone: tech?.phone ?? undefined,
            }
          ).catch(e => console.error("[NOTIFY] Erro ao notificar técnico na atribuição:", e));
        }
      }

      return { success: true };
    }),

  delete: adminLocalProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const workOrdersDb = await import("../workOrdersDb");

      // GUARDA: OS precisa pertencer ao tenant do admin logado.
      const existing = await workOrdersDb.getWorkOrderById(input.id);
      if (!existing || existing.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ordem de Serviço não encontrada" });
      }

      await workOrdersDb.deleteWorkOrder(input.id);
      return { success: true, message: "OS deletada com sucesso" };
    }),

  deleteBatch: adminLocalProcedure
    .input(z.object({ ids: z.array(z.number()).min(1).max(100) }))
    .mutation(async ({ input, ctx }) => {
      const workOrdersDb = await import("../workOrdersDb");

      // GUARDA: Todas as OSs precisam pertencer ao tenant do admin logado.
      const checks = await Promise.all(input.ids.map(id => workOrdersDb.getWorkOrderById(id)));
      if (checks.some(wo => !wo || wo.tenantId !== ctx.tenantId)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Uma ou mais Ordens de Serviço não foram encontradas ou não pertencem ao seu tenant." });
      }

      await workOrdersDb.deleteMultipleWorkOrders(input.ids);
      return { success: true, message: `${input.ids.length} OS deletadas com sucesso` };
    }),

  complete: adminLocalProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const workOrdersDb = await import("../workOrdersDb");

      // GUARDA: OS precisa pertencer ao tenant do admin logado.
      const existing = await workOrdersDb.getWorkOrderById(input.id);
      if (!existing || existing.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ordem de Serviço não encontrada" });
      }

      await workOrdersDb.updateWorkOrder(input.id, {
        status: "concluida" as const,
        completedAt: new Date(),
      } as any);
      return { success: true, message: "OS concluída com sucesso" };
    }),

  saveSignatures: adminLocalProcedure
    .input(z.object({
      id: z.number(),
      collaboratorName: z.string().optional(),
      collaboratorSignature: z.string().optional(),
      clientName: z.string().optional(),
      clientSignature: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const workOrdersDb = await import("../workOrdersDb");

      // GUARDA: OS precisa pertencer ao tenant do admin logado.
      const existing = await workOrdersDb.getWorkOrderById(input.id);
      if (!existing || existing.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ordem de Serviço não encontrada" });
      }

      const { id, collaboratorName, collaboratorSignature, clientName, clientSignature } = input;
      const updateData: Partial<any> = {};
      if (collaboratorName)    updateData.collaboratorName    = collaboratorName;
      if (collaboratorSignature) updateData.collaboratorSignature = collaboratorSignature;
      if (clientName)          updateData.clientName          = clientName;
      if (clientSignature)     updateData.clientSignature     = clientSignature;
      if (Object.keys(updateData).length > 0) {
        await workOrdersDb.updateWorkOrder(id, updateData as any);
      }
      return { success: true };
    }),

  cancelRecurrence: adminLocalProcedure
    .input(z.object({
      id: z.number(),
      cancelFuture: z.boolean(),
    }))
    .mutation(async ({ input, ctx }) => {
      const workOrdersDb = await import("../workOrdersDb");

      // GUARDA: OS precisa pertencer ao tenant do admin logado.
      const existing = await workOrdersDb.getWorkOrderById(input.id);
      if (!existing || existing.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ordem de Serviço não encontrada" });
      }

      if (input.cancelFuture) {
        await workOrdersDb.updateWorkOrder(input.id, { recurrenceCanceled: 1 });
      }
      await workOrdersDb.updateWorkOrder(input.id, { status: "cancelada" as any });
      return { success: true, message: "Recorrência cancelada com sucesso" };
    }),

  // ==================== TASKS ====================
  tasks: router({
    list: adminLocalProcedure
      .input(z.object({ workOrderId: z.number() }))
      .query(async ({ input, ctx }) => {
        const auxDb = await import("../workOrdersAuxDb");

        // GUARDA: OS precisa pertencer ao tenant do admin logado.
        const workOrdersDb = await import("../workOrdersDb");
        const os = await workOrdersDb.getWorkOrderById(input.workOrderId);
        if (!os || os.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Ordem de Serviço não encontrada" });
        }

        return await auxDb.getTasksByWorkOrderId(input.workOrderId);
      }),

    create: adminLocalProcedure
      .input(z.object({
        workOrderId: z.number(),
        title: z.string().min(1),
        description: z.string().optional(),
        orderIndex: z.number().default(0),
      }))
      .mutation(async ({ input, ctx }) => {
        const auxDb = await import("../workOrdersAuxDb");

        // GUARDA: OS precisa pertencer ao tenant do admin logado.
        const workOrdersDb = await import("../workOrdersDb");
        const os = await workOrdersDb.getWorkOrderById(input.workOrderId);
        if (!os || os.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Ordem de Serviço não encontrada" });
        }

        // carimba tenantId (evita novos NULLs antes da 3.7.1f)
        await auxDb.createTask({ ...input, tenantId: ctx.tenantId });
        return { success: true, message: "Tarefa criada com sucesso" };
      }),

    update: adminLocalProcedure
      .input(z.object({
        id: z.number(),
        title: z.string().optional(),
        description: z.string().optional(),
        orderIndex: z.number().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const auxDb = await import("../workOrdersAuxDb");

        // GUARDA MULTI-ETAPA: a tarefa deve pertencer a uma OS do tenant.
        const task = await auxDb.getTaskById(input.id);
        if (!task) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tarefa não encontrada" });
        }
        const workOrdersDb = await import("../workOrdersDb");
        const os = await workOrdersDb.getWorkOrderById(task.workOrderId);
        if (!os || os.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tarefa não encontrada" });
        }

        const { id, ...updates } = input;
        await auxDb.updateTask(id, updates);
        return { success: true, message: "Tarefa atualizada com sucesso" };
      }),

    toggle: adminLocalProcedure
      .input(z.object({
        id: z.number(),
        isCompleted: z.boolean(),
        completedBy: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const auxDb = await import("../workOrdersAuxDb");

        // GUARDA MULTI-ETAPA: a tarefa deve pertencer a uma OS do tenant.
        const task = await auxDb.getTaskById(input.id);
        if (!task) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tarefa não encontrada" });
        }
        const workOrdersDb = await import("../workOrdersDb");
        const os = await workOrdersDb.getWorkOrderById(task.workOrderId);
        if (!os || os.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tarefa não encontrada" });
        }

        await auxDb.toggleTaskCompletion(input.id, input.isCompleted, input.completedBy);
        return { success: true, message: "Tarefa atualizada com sucesso" };
      }),

    setStatus: adminLocalProcedure
      .input(z.object({
        id: z.number(),
        status: z.number().min(0).max(2),
        completedBy: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const auxDb = await import("../workOrdersAuxDb");

        // GUARDA MULTI-ETAPA: a tarefa deve pertencer a uma OS do tenant.
        const task = await auxDb.getTaskById(input.id);
        if (!task) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tarefa não encontrada" });
        }
        const workOrdersDb = await import("../workOrdersDb");
        const os = await workOrdersDb.getWorkOrderById(task.workOrderId);
        if (!os || os.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tarefa não encontrada" });
        }

        await auxDb.setTaskStatus(input.id, input.status, input.completedBy);
        return { success: true };
      }),

    delete: adminLocalProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const auxDb = await import("../workOrdersAuxDb");

        // GUARDA MULTI-ETAPA: a tarefa deve pertencer a uma OS do tenant.
        const task = await auxDb.getTaskById(input.id);
        if (!task) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tarefa não encontrada" });
        }
        const workOrdersDb = await import("../workOrdersDb");
        const os = await workOrdersDb.getWorkOrderById(task.workOrderId);
        if (!os || os.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tarefa não encontrada" });
        }

        await auxDb.deleteTask(input.id);
        return { success: true, message: "Tarefa deletada com sucesso" };
      }),
  }),

  // ==================== MATERIALS ====================
  materials: router({
    list: adminLocalProcedure
      .input(z.object({ workOrderId: z.number() }))
      .query(async ({ input, ctx }) => {
        const auxDb = await import("../workOrdersAuxDb");

        // GUARDA: OS precisa pertencer ao tenant do admin logado.
        const workOrdersDb = await import("../workOrdersDb");
        const os = await workOrdersDb.getWorkOrderById(input.workOrderId);
        if (!os || os.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Ordem de Serviço não encontrada" });
        }

        return await auxDb.getMaterialsByWorkOrderId(input.workOrderId);
      }),

    create: adminLocalProcedure
      .input(z.object({
        workOrderId: z.number(),
        materialName: z.string().min(1),
        quantity: z.number().min(1),
        unit: z.string().optional(),
        unitCost: z.number().optional(),
        totalCost: z.number().optional(),
        addedBy: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const auxDb = await import("../workOrdersAuxDb");

        // GUARDA: OS precisa pertencer ao tenant do admin logado.
        const workOrdersDb = await import("../workOrdersDb");
        const os = await workOrdersDb.getWorkOrderById(input.workOrderId);
        if (!os || os.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Ordem de Serviço não encontrada" });
        }

        // carimba tenantId (evita novos NULLs antes da 3.7.1f)
        await auxDb.createMaterial({ ...input, tenantId: ctx.tenantId });
        return { success: true, message: "Material adicionado com sucesso" };
      }),

    update: adminLocalProcedure
      .input(z.object({
        id: z.number(),
        materialName: z.string().optional(),
        quantity: z.number().optional(),
        unit: z.string().optional(),
        unitCost: z.number().optional(),
        totalCost: z.number().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const auxDb = await import("../workOrdersAuxDb");

        // GUARDA MULTI-ETAPA: o material deve pertencer a uma OS do tenant.
        const material = await auxDb.getMaterialById(input.id);
        if (!material) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Material não encontrado" });
        }
        const workOrdersDb = await import("../workOrdersDb");
        const os = await workOrdersDb.getWorkOrderById(material.workOrderId);
        if (!os || os.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Material não encontrado" });
        }

        const { id, ...updates } = input;
        await auxDb.updateMaterial(id, updates);
        return { success: true, message: "Material atualizado com sucesso" };
      }),

    delete: adminLocalProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const auxDb = await import("../workOrdersAuxDb");

        // GUARDA MULTI-ETAPA: o material deve pertencer a uma OS do tenant.
        const material = await auxDb.getMaterialById(input.id);
        if (!material) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Material não encontrado" });
        }
        const workOrdersDb = await import("../workOrdersDb");
        const os = await workOrdersDb.getWorkOrderById(material.workOrderId);
        if (!os || os.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Material não encontrado" });
        }

        await auxDb.deleteMaterial(input.id);
        return { success: true, message: "Material deletado com sucesso" };
      }),

    getTotalCost: adminLocalProcedure
      .input(z.object({ workOrderId: z.number() }))
      .query(async ({ input, ctx }) => {
        const auxDb = await import("../workOrdersAuxDb");

        // GUARDA: OS precisa pertencer ao tenant do admin logado.
        const workOrdersDb = await import("../workOrdersDb");
        const os = await workOrdersDb.getWorkOrderById(input.workOrderId);
        if (!os || os.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Ordem de Serviço não encontrada" });
        }

        return await auxDb.getTotalMaterialsCost(input.workOrderId);
      }),
  }),

  // ==================== ATTACHMENTS ====================
  attachments: router({
    list: adminLocalProcedure
      .input(z.object({
        workOrderId: z.number(),
        category: z.enum(["before", "during", "after", "document", "other"]).optional(),
      }))
      .query(async ({ input, ctx }) => {
        const auxDb = await import("../workOrdersAuxDb");

        // GUARDA: OS precisa pertencer ao tenant do admin logado.
        const workOrdersDb = await import("../workOrdersDb");
        const os = await workOrdersDb.getWorkOrderById(input.workOrderId);
        if (!os || os.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Ordem de Serviço não encontrada" });
        }

        if (input.category) {
          return await auxDb.getAttachmentsByCategory(input.workOrderId, input.category);
        }
        return await auxDb.getAttachmentsByWorkOrderId(input.workOrderId);
      }),

    create: adminLocalProcedure
      .input(z.object({
        workOrderId: z.number(),
        fileName: z.string().min(1),
        fileKey: z.string().min(1),
        fileUrl: z.string().min(1),
        fileType: z.string().optional(),
        fileSize: z.number().optional(),
        category: z.enum(["before", "during", "after", "document", "other"]).default("other"),
        uploadedBy: z.string().optional(),
        description: z.string().optional(), // legenda/caption da foto
      }))
      .mutation(async ({ input, ctx }) => {
        const auxDb = await import("../workOrdersAuxDb");

        // GUARDA: OS precisa pertencer ao tenant do admin logado.
        const workOrdersDb = await import("../workOrdersDb");
        const os = await workOrdersDb.getWorkOrderById(input.workOrderId);
        if (!os || os.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Ordem de Serviço não encontrada" });
        }

        // carimba tenantId (evita novos NULLs antes da 3.7.1f)
        await auxDb.createAttachment({ ...input, tenantId: ctx.tenantId });
        return { success: true, message: "Anexo adicionado com sucesso" };
      }),

    update: adminLocalProcedure
      .input(z.object({
        id: z.number(),
        description: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const auxDb = await import("../workOrdersAuxDb");

        // GUARDA MULTI-ETAPA: o anexo deve pertencer a uma OS do tenant.
        const attachment = await auxDb.getAttachmentById(input.id);
        if (!attachment) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Anexo não encontrado" });
        }
        const workOrdersDb = await import("../workOrdersDb");
        const os = await workOrdersDb.getWorkOrderById(attachment.workOrderId);
        if (!os || os.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Anexo não encontrado" });
        }

        const { id, description } = input;
        await auxDb.updateAttachment(id, { description });
        return { success: true, message: "Legenda atualizada com sucesso" };
      }),

    delete: adminLocalProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const auxDb = await import("../workOrdersAuxDb");

        // GUARDA MULTI-ETAPA: o anexo deve pertencer a uma OS do tenant.
        const attachment = await auxDb.getAttachmentById(input.id);
        if (!attachment) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Anexo não encontrado" });
        }
        const workOrdersDb = await import("../workOrdersDb");
        const os = await workOrdersDb.getWorkOrderById(attachment.workOrderId);
        if (!os || os.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Anexo não encontrado" });
        }

        await auxDb.deleteAttachment(input.id);
        return { success: true, message: "Anexo deletado com sucesso" };
      }),
  }),

  // ==================== COMMENTS ====================
  comments: router({
    list: adminLocalProcedure
      .input(z.object({
        workOrderId: z.number(),
        includeInternal: z.boolean().default(true),
      }))
      .query(async ({ input, ctx }) => {
        const auxDb = await import("../workOrdersAuxDb");

        // GUARDA: OS precisa pertencer ao tenant do admin logado.
        const workOrdersDb = await import("../workOrdersDb");
        const os = await workOrdersDb.getWorkOrderById(input.workOrderId);
        if (!os || os.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Ordem de Serviço não encontrada" });
        }

        return await auxDb.getCommentsByWorkOrderId(input.workOrderId, input.includeInternal);
      }),

    create: adminLocalProcedure
      .input(z.object({
        workOrderId: z.number(),
        userId: z.string().min(1),
        userType: z.enum(["admin", "client"]),
        comment: z.string().min(1),
        isInternal: z.number().default(1),
      }))
      .mutation(async ({ input, ctx }) => {
        const auxDb = await import("../workOrdersAuxDb");

        // GUARDA: OS precisa pertencer ao tenant do admin logado.
        const workOrdersDb = await import("../workOrdersDb");
        const os = await workOrdersDb.getWorkOrderById(input.workOrderId);
        if (!os || os.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Ordem de Serviço não encontrada" });
        }

        // carimba tenantId (evita novos NULLs antes da 3.7.1f)
        await auxDb.createComment({ ...input, tenantId: ctx.tenantId });
        return { success: true, message: "Comentário adicionado com sucesso" };
      }),

    delete: adminLocalProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const auxDb = await import("../workOrdersAuxDb");

        // GUARDA MULTI-ETAPA: o comentário deve pertencer a uma OS do tenant.
        const comment = await auxDb.getCommentById(input.id);
        if (!comment) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Comentário não encontrado" });
        }
        const workOrdersDb = await import("../workOrdersDb");
        const os = await workOrdersDb.getWorkOrderById(comment.workOrderId);
        if (!os || os.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Comentário não encontrado" });
        }

        await auxDb.deleteComment(input.id);
        return { success: true, message: "Comentário deletado com sucesso" };
      }),

    // Sugestão de comentário para o cliente via IA (analisa OS + comentários internos + checklists)
    suggestForClient: adminLocalProcedure
      .input(z.object({ workOrderId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const { sugerirComentarioCliente } = await import("../iaWorkOrders");

        // GUARDA: OS precisa pertencer ao tenant do admin logado.
        const workOrdersDb = await import("../workOrdersDb");
        const os = await workOrdersDb.getWorkOrderById(input.workOrderId);
        if (!os || os.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Ordem de Serviço não encontrada" });
        }

        return await sugerirComentarioCliente(input.workOrderId);
      }),
  }),

  // ==================== RECURRENCE ====================
  recurrence: router({
    process: adminLocalProcedure.mutation(async () => {
      // Este endpoint processa TODAS as recorrências de TODOS os tenants.
      // É um job de sistema, não é escopado por tenant.
      const recurrence = await import("../workOrdersRecurrence");
      return await recurrence.processRecurringWorkOrders();
    }),

    cancel: adminLocalProcedure
      .input(z.object({
        workOrderId: z.number(),
        cancelFutureOnly: z.boolean().optional().default(false),
      }))
      .mutation(async ({ input, ctx }) => {
        // GUARDA: OS precisa pertencer ao tenant do admin logado.
        const workOrdersDb = await import("../workOrdersDb");
        const os = await workOrdersDb.getWorkOrderById(input.workOrderId);
        if (!os || os.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Ordem de Serviço não encontrada" });
        }

        const recurrence = await import("../workOrdersRecurrence");
        return await recurrence.cancelRecurrence(input.workOrderId, input.cancelFutureOnly);
      }),

    reactivate: adminLocalProcedure
      .input(z.object({ workOrderId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        // GUARDA: OS precisa pertencer ao tenant do admin logado.
        const workOrdersDb = await import("../workOrdersDb");
        const os = await workOrdersDb.getWorkOrderById(input.workOrderId);
        if (!os || os.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Ordem de Serviço não encontrada" });
        }

        const recurrence = await import("../workOrdersRecurrence");
        return await recurrence.reactivateRecurrence(input.workOrderId);
      }),

    getNextDate: adminLocalProcedure
      .input(z.object({ workOrderId: z.number() }))
      .query(async ({ input, ctx }) => {
        // GUARDA: OS precisa pertencer ao tenant do admin logado.
        const workOrdersDb = await import("../workOrdersDb");
        const os = await workOrdersDb.getWorkOrderById(input.workOrderId);
        if (!os || os.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Ordem de Serviço não encontrada" });
        }

        const recurrence = await import("../workOrdersRecurrence");
        return await recurrence.getNextRecurrenceDate(input.workOrderId);
      }),

    getInstances: adminLocalProcedure
      .input(z.object({ parentWorkOrderId: z.number() }))
      .query(async ({ input, ctx }) => {
        // GUARDA: OS precisa pertencer ao tenant do admin logado.
        const workOrdersDb = await import("../workOrdersDb");
        const os = await workOrdersDb.getWorkOrderById(input.parentWorkOrderId);
        if (!os || os.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Ordem de Serviço não encontrada" });
        }

        const recurrence = await import("../workOrdersRecurrence");
        return await recurrence.getRecurrenceInstances(input.parentWorkOrderId);
      }),
  }),

  // ==================== METRICS ====================
  // Isolado por tenant (hardening pré-cutover) — todas as agregações filtram
  // por ctx.tenantId, que vem do servidor (JWT do admin), nunca do input.
  metrics: router({
    getStats: adminLocalProcedure.query(async ({ ctx }) => {
      const metrics = await import("../workOrdersMetrics");
      return await metrics.getWorkOrderStats(ctx.tenantId);
    }),
    getByStatus: adminLocalProcedure.query(async ({ ctx }) => {
      const metrics = await import("../workOrdersMetrics");
      return await metrics.getWorkOrdersByStatus(ctx.tenantId);
    }),
    getByType: adminLocalProcedure.query(async ({ ctx }) => {
      const metrics = await import("../workOrdersMetrics");
      return await metrics.getWorkOrdersByType(ctx.tenantId);
    }),
    getAverageCompletionTime: adminLocalProcedure.query(async ({ ctx }) => {
      const metrics = await import("../workOrdersMetrics");
      return await metrics.getAverageCompletionTime(ctx.tenantId);
    }),

    getFinancialStats: adminLocalProcedure.query(async ({ ctx }) => {
      const metrics = await import("../workOrdersMetrics");
      return await metrics.getFinancialStats(ctx.tenantId);
    }),
    getByMonth: adminLocalProcedure.query(async ({ ctx }) => {
      const metrics = await import("../workOrdersMetrics");
      return await metrics.getWorkOrdersByMonth(ctx.tenantId);
    }),
    getCompletionRate: adminLocalProcedure.query(async ({ ctx }) => {
      const metrics = await import("../workOrdersMetrics");
      return await metrics.getCompletionRate(ctx.tenantId);
    }),
    getDelayed: adminLocalProcedure.query(async ({ ctx }) => {
      const metrics = await import("../workOrdersMetrics");
      return await metrics.getDelayedWorkOrders(ctx.tenantId);
    }),
    getTopClients: adminLocalProcedure.query(async ({ ctx }) => {
      const metrics = await import("../workOrdersMetrics");
      return await metrics.getTopClientsByWorkOrders(ctx.tenantId);
    }),
    getMaterialsCostByWorkOrder: adminLocalProcedure.query(async ({ ctx }) => {
      const metrics = await import("../workOrdersMetrics");
      return await metrics.getMaterialsCostByWorkOrder(ctx.tenantId);
    }),
  }),

  // ==================== PDF EXPORT ====================
  exportPDF: adminLocalProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      // GUARDA: OS precisa pertencer ao tenant do admin logado.
      const workOrdersDb = await import("../workOrdersDb");
      const wo = await workOrdersDb.getWorkOrderById(input.id);
      if (!wo || wo.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ordem de Serviço não encontrada" });
      }

      const pdfGen = await import("../pdfGenerator");
      const pdfBuffer = await pdfGen.generateWorkOrderPDF(input.id);

      const osNum = wo?.osNumber || `OS-${input.id}`;
      const clientSlug = wo?.clientName
        ? wo.clientName.trim().replace(/[^\w\u00C0-\u00FF]/g, '_').replace(/_+/g, '_').substring(0, 40)
        : 'cliente';
      return {
        success: true,
        pdf: pdfBuffer.toString('base64'),
        filename: `${osNum}_${clientSlug}.pdf`
      };
    }),

  exportPDFForPortal: protectedClientProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const workOrdersDb = await import("../workOrdersDb");
      const shared = await workOrdersDb.getSharedWorkOrdersForPortal(ctx.clientId);
      const isShared = (shared as any[]).some((wo: any) => wo.id === input.id);
      if (!isShared) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado." });
      }
      const pdfGen = await import("../pdfGenerator");
      const pdfBuffer = await pdfGen.generateWorkOrderPDF(input.id);
      const wo = await workOrdersDb.getWorkOrderById(input.id);
      const osNum = wo?.osNumber || `OS-${input.id}`;
      const clientSlug = wo?.clientName
        ? wo.clientName.trim().replace(/[^\w\u00C0-\u00FF]/g, '_').replace(/_+/g, '_').substring(0, 40)
        : 'cliente';
      return {
        success: true,
        pdf: pdfBuffer.toString('base64'),
        filename: `${osNum}_${clientSlug}.pdf`
      };
    }),

  exportBatch: adminLocalProcedure
    .input(z.object({ ids: z.array(z.number()).max(50) }))
    .mutation(async ({ input, ctx }) => {
      const JSZip = (await import('jszip')).default;
      const pdfGen = await import("../pdfGenerator");
      const zip = new JSZip();
      const workOrdersDb = await import("../workOrdersDb");

      // GUARDA: Todas as OSs precisam pertencer ao tenant do admin logado.
      const checks = await Promise.all(input.ids.map(id => workOrdersDb.getWorkOrderById(id)));
      if (checks.some(wo => !wo || wo.tenantId !== ctx.tenantId)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Uma ou mais Ordens de Serviço não foram encontradas ou não pertencem ao seu tenant." });
      }

      // A busca por ID dentro do loop agora é segura pois a posse de todos os IDs foi verificada.
      for (const id of input.ids) {
        try {
          const pdfBuffer = await pdfGen.generateWorkOrderPDF(id);
          const wo = await workOrdersDb.getWorkOrderById(id);
          const osNum = wo?.osNumber || `OS-${id}`;
          const clientSlug = wo?.clientName
            ? wo.clientName.trim().replace(/[^\w\u00C0-\u00FF]/g, '_').replace(/_+/g, '_').substring(0, 40)
            : 'cliente';
          zip.file(`${osNum}_${clientSlug}.pdf`, pdfBuffer);
        } catch (error) {
          console.error(`Erro ao gerar PDF da OS ${id}:`, error);
        }
      }

      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
      const timestamp = new Date().toISOString().split('T')[0];

      return {
        success: true,
        zipBase64: zipBuffer.toString('base64'),
        filename: `ordens-servico-${timestamp}.zip`
      };
    }),

  // ==================== PORTAL / WHATSAPP SHARING ====================
  getSharedForPortal: protectedClientProcedure
    .query(async ({ ctx }) => {
      const workOrdersDb = await import("../workOrdersDb");
      return await workOrdersDb.getSharedWorkOrdersForPortal(ctx.clientId);
    }),

  sendToClientWhatsapp: adminLocalProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const workOrdersDb = await import("../workOrdersDb");

      // GUARDA: OS precisa pertencer ao tenant do admin logado.
      const wo = await workOrdersDb.getWorkOrderById(input.id);
      if (!wo || wo.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ordem de Serviço não encontrada" });
      }

      if (!wo) throw new Error("OS não encontrada");

      const cliente = await db.getClientById(wo.clientId);
      if (!cliente?.phone) throw new Error("Cliente sem telefone cadastrado");

      const saudacao = cliente.syndicName ? `Olá, ${cliente.syndicName}!` : `Olá!`;
      const portalLinha = cliente.type === "com_portal"
        ? `\n🔗 *Acesse seu portal:*\nhttps://app.soluteg.com.br/client/portal`
        : "";

      const msg =
        `${saudacao}\n\n` +
        `📋 *${wo.osNumber}* - ${wo.title}\n\n` +
        `🏢 Condomínio: ${wo.clientName || cliente.name}\n` +
        `📌 Status: ${wo.status}` +
        portalLinha;

      const pdfGen = await import("../pdfGenerator");
      const pdfBuffer = await pdfGen.generateWorkOrderPDF(input.id);
      const osNum = wo.osNumber || `OS-${input.id}`;
      const clientSlug = (wo.clientName || cliente.name)
        .trim().replace(/[^\w\u00C0-\u00FF]/g, '_').replace(/_+/g, '_').substring(0, 40);
      const filename = `${osNum}_${clientSlug}.pdf`;

      const { sendWhatsappToNumberWithPDF } = await import("../whatsapp");
      await sendWhatsappToNumberWithPDF(cliente.phone, msg, pdfBuffer, filename);
      return { success: true };
    }),

  sendToAdminWhatsapp: adminLocalProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const workOrdersDb = await import("../workOrdersDb");

      // GUARDA: OS precisa pertencer ao tenant do admin logado.
      const wo = await workOrdersDb.getWorkOrderById(input.id);
      if (!wo || wo.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ordem de Serviço não encontrada" });
      }

      if (!wo) throw new Error("OS não encontrada");

      const portalUrl = `https://app.soluteg.com.br/gestor/work-orders/${input.id}`;
      const msg =
        `📋 *${wo.osNumber}* - ${wo.title}\n\n` +
        `🏢 Cliente: ${wo.clientName}\n` +
        `📌 Tipo: ${wo.type?.toUpperCase()} | Status: ${wo.status}\n\n` +
        `🔗 *Ver no painel:*\n${portalUrl}`;

      const pdfGen = await import("../pdfGenerator");
      const pdfBuffer = await pdfGen.generateWorkOrderPDF(input.id);
      const osNum = wo.osNumber || `OS-${input.id}`;
      const clientSlug = wo.clientName
        ? wo.clientName.trim().replace(/[^\w\u00C0-\u00FF]/g, '_').replace(/_+/g, '_').substring(0, 40)
        : 'cliente';
      const filename = `${osNum}_${clientSlug}.pdf`;

      const { sendWhatsappAlertWithPDF } = await import("../whatsapp");
      sendWhatsappAlertWithPDF(msg, pdfBuffer, filename).catch(e => console.error("Erro no Zap JNC:", e));
      return { success: true };
    }),

  shareToClientPortal: adminLocalProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const workOrdersDb = await import("../workOrdersDb");

      // GUARDA: OS precisa pertencer ao tenant do admin logado.
      const wo = await workOrdersDb.getWorkOrderById(input.id);
      if (!wo || wo.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ordem de Serviço não encontrada" });
      }
      if (!wo) throw new Error("OS não encontrada");

      let portalTab: string;
      if (wo.type === "rotina") {
        portalTab = "vistoria";
      } else if (wo.type === "emergencial") {
        portalTab = "visita";
      } else if (["instalacao", "manutencao", "corretiva", "preventiva"].includes(wo.type) && wo.status === "concluida") {
        portalTab = "servico";
      } else {
        portalTab = "visita";
      }

      const clientePortal = await db.getClientById(wo.clientId);
      if (clientePortal?.type === "sem_portal") {
        throw new Error("Este cliente não possui portal. Use a opção de envio por WhatsApp.");
      }

      await workOrdersDb.shareWorkOrderToPortal(input.id, portalTab);

      const cliente = clientePortal;
      if (cliente) {
        const portalUrl = `https://app.soluteg.com.br/client/portal`;
        const tabLabel: Record<string, string> = {
          vistoria: "Vistoria",
          visita: "Visita",
          servico: "Serviços",
          orcamentos: "Orçamentos",
        };
        const saudacaoPortal = cliente.syndicName ? `Olá, ${cliente.syndicName}!` : `Olá!`;

        // Notificação via Push (se PWA instalado) com fallback WhatsApp
        notify(
          {
            title: "Nova atualização no seu portal",
            body: `${wo.osNumber} disponível na aba ${tabLabel[portalTab] || portalTab}`,
            url: `/client/portal`,
            tag: `order-${input.id}`,
            whatsappMessage:
              `📋 *JNC Soluteg – Portal do Cliente*\n\n` +
              `${saudacaoPortal}\n\n` +
              `A *${wo.osNumber}* foi disponibilizada na aba *${tabLabel[portalTab] || portalTab}* do seu portal.\n\n` +
              `🔗 Acesse: ${portalUrl}\n` +
              `👤 Login: ${cliente.username}\n` +
              `🔑 Senha: (sua senha cadastrada)\n\n` +
              `Em caso de dúvidas, entre em contato conosco.`,
          },
          {
            userId: wo.clientId,
            userType: "client",
            notificationType: "order_new",
            channel: "auto",
            whatsappPhone: cliente.phone ?? undefined,
          }
        ).catch(e => console.error("[NOTIFY] Erro ao notificar cliente no portal:", e));
      }

      return { success: true, portalTab };
    }),
});
