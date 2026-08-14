import { protectedTechnicianProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as technicianDb from "../technicianDb";
import * as workOrdersDb from "../workOrdersDb";

export const technicianPortalRouter = router({
  // Verifica se o técnico está autenticado e retorna dados básicos.
  // Usado pelo TechnicianLogin para auto-redirecionar ao portal se já logado.
  me: protectedTechnicianProcedure.query(async ({ ctx }) => {
    const tech = await technicianDb.getTechnicianById(ctx.technicianId);
    if (!tech) throw new TRPCError({ code: "NOT_FOUND", message: "Técnico não encontrado" });
    return { id: tech.id, name: tech.name };
  }),

  getMyWorkOrders: protectedTechnicianProcedure
    .query(async ({ ctx }) => {
      return await technicianDb.getWorkOrdersByTechnicianId(ctx.technicianId);
    }),

  getWorkOrderById: protectedTechnicianProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      return await technicianDb.getWorkOrderByIdForTechnician(input.id, ctx.technicianId);
    }),

  updateStatus: protectedTechnicianProcedure
    .input(z.object({
      workOrderId:  z.number(),
      newStatus:    z.enum(["em_andamento", "pausada", "concluida"]),
      notes:        z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const os = await technicianDb.getWorkOrderByIdForTechnician(input.workOrderId, ctx.technicianId);
      if (!os) {
        throw new TRPCError({ code: "NOT_FOUND", message: "OS não encontrada ou acesso negado" });
      }

      // Só pode concluir se já assinou
      if (input.newStatus === "concluida") {
        const full = await workOrdersDb.getWorkOrderById(input.workOrderId);
        if (!full?.technicianSignature) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "É necessário assinar a OS antes de finalizá-la.",
          });
        }
      }

      const updateData: Record<string, unknown> = { status: input.newStatus };
      if (input.newStatus === "em_andamento") updateData.startedAt = new Date();
      if (input.newStatus === "concluida")    updateData.completedAt = new Date();
      if (input.newStatus === "pausada")      updateData.pausedAt = new Date();

      await workOrdersDb.updateWorkOrder(input.workOrderId, updateData as any);

      await workOrdersDb.addWorkOrderHistory({
        workOrderId:    input.workOrderId,
        changedBy:      `technician-${ctx.technicianId}`,
        changedByType:  "technician",
        previousStatus: os.status,
        newStatus:      input.newStatus,
        notes:          input.notes,
      });

      return { success: true };
    }),

  saveSignature: protectedTechnicianProcedure
    .input(z.object({
      workOrderId: z.number(),
      signature:   z.string().min(10),
    }))
    .mutation(async ({ input, ctx }) => {
      const os = await technicianDb.getWorkOrderByIdForTechnician(input.workOrderId, ctx.technicianId);
      if (!os) {
        throw new TRPCError({ code: "NOT_FOUND", message: "OS não encontrada ou acesso negado" });
      }
      if (os.status !== "em_andamento" && os.status !== "pausada") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A OS precisa estar em andamento para assinar." });
      }
      await workOrdersDb.saveTechnicianSignature(input.workOrderId, ctx.technicianId, input.signature);
      return { success: true };
    }),

  saveClientSignature: protectedTechnicianProcedure
    .input(z.object({
      workOrderId:     z.number(),
      clientSignature: z.string().min(10),
      clientName:      z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const os = await technicianDb.getWorkOrderByIdForTechnician(input.workOrderId, ctx.technicianId);
      if (!os) {
        throw new TRPCError({ code: "NOT_FOUND", message: "OS não encontrada ou acesso negado" });
      }
      if (os.status !== "em_andamento" && os.status !== "pausada") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A OS precisa estar em andamento para registrar assinatura do cliente." });
      }
      await workOrdersDb.updateWorkOrder(input.workOrderId, {
        clientSignature: input.clientSignature,
        clientName: input.clientName || undefined,
      } as any);
      return { success: true };
    }),

  sendPdfToClient: protectedTechnicianProcedure
    .input(z.object({ workOrderId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const os = await technicianDb.getWorkOrderByIdForTechnician(input.workOrderId, ctx.technicianId);
      if (!os) throw new TRPCError({ code: "NOT_FOUND", message: "OS não encontrada ou acesso negado" });

      const dbModule = await import("../db");
      const cliente = await dbModule.getClientById(os.clientId);
      if (!cliente?.phone) throw new TRPCError({ code: "BAD_REQUEST", message: "Cliente sem telefone cadastrado" });

      const saudacao = cliente.syndicName ? `Olá, ${cliente.syndicName}!` : `Olá!`;
      const portalLinha = cliente.type === "com_portal"
        ? `\n🔗 *Acesse seu portal:*\nhttps://app.soluteg.com.br/client/portal`
        : "";
      const msg =
        `${saudacao}\n\n` +
        `📋 *${os.osNumber}* - ${os.title}\n\n` +
        `🏢 Condomínio: ${os.clientName || cliente.name}\n` +
        `📌 Status: ${os.status}` +
        portalLinha;

      const pdfGen = await import("../pdfGenerator");
      const pdfBuffer = await pdfGen.generateWorkOrderPDF(input.workOrderId);
      const osNum = os.osNumber || `OS-${input.workOrderId}`;
      const clientSlug = (os.clientName || cliente.name)
        .trim().replace(/[^\w\u00C0-\u00FF]/g, '_').replace(/_+/g, '_').substring(0, 40);

      const { sendWhatsappToNumberWithPDF } = await import("../whatsapp");
      await sendWhatsappToNumberWithPDF(cliente.phone, msg, pdfBuffer, `${osNum}_${clientSlug}.pdf`);
      return { success: true };
    }),

  sendPdfToAdmin: protectedTechnicianProcedure
    .input(z.object({ workOrderId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const os = await technicianDb.getWorkOrderByIdForTechnician(input.workOrderId, ctx.technicianId);
      if (!os) throw new TRPCError({ code: "NOT_FOUND", message: "OS não encontrada ou acesso negado" });

      const portalUrl = `https://app.soluteg.com.br/gestor/work-orders/${input.workOrderId}`;
      const msg =
        `📋 *${os.osNumber}* - ${os.title}\n\n` +
        `🏢 Cliente: ${os.clientName}\n` +
        `📌 Tipo: ${os.type?.toUpperCase()} | Status: ${os.status}\n\n` +
        `🔗 *Ver no painel:*\n${portalUrl}`;

      const pdfGen = await import("../pdfGenerator");
      const pdfBuffer = await pdfGen.generateWorkOrderPDF(input.workOrderId);
      const osNum = os.osNumber || `OS-${input.workOrderId}`;
      const clientSlug = os.clientName
        ? os.clientName.trim().replace(/[^\w\u00C0-\u00FF]/g, '_').replace(/_+/g, '_').substring(0, 40)
        : 'cliente';

      const { sendWhatsappAlertWithPDF } = await import("../whatsapp");
      sendWhatsappAlertWithPDF(msg, pdfBuffer, `${osNum}_${clientSlug}.pdf`)
        .catch(e => console.error("Erro no Zap JNC:", e));
      return { success: true };
    }),

  exportPDF: protectedTechnicianProcedure
    .input(z.object({ workOrderId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const os = await technicianDb.getWorkOrderByIdForTechnician(input.workOrderId, ctx.technicianId);
      if (!os) throw new TRPCError({ code: "NOT_FOUND", message: "OS não encontrada ou acesso negado" });

      const pdfGen = await import("../pdfGenerator");
      const pdfBuffer = await pdfGen.generateWorkOrderPDF(input.workOrderId);
      const osNum = os.osNumber || `OS-${input.workOrderId}`;
      const clientSlug = os.clientName
        ? os.clientName.trim().replace(/[^\w\u00C0-\u00FF]/g, '_').replace(/_+/g, '_').substring(0, 40)
        : 'cliente';

      return {
        success: true,
        pdf: pdfBuffer.toString('base64'),
        filename: `${osNum}_${clientSlug}.pdf`,
      };
    }),

  shareToClientPortal: protectedTechnicianProcedure
    .input(z.object({ workOrderId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const os = await technicianDb.getWorkOrderByIdForTechnician(input.workOrderId, ctx.technicianId);
      if (!os) throw new TRPCError({ code: "NOT_FOUND", message: "OS não encontrada ou acesso negado" });

      const dbModule = await import("../db");
      const cliente = await dbModule.getClientById(os.clientId);
      if (cliente?.type === "sem_portal") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Este cliente não possui portal. Use o envio por WhatsApp." });
      }

      let portalTab: string;
      if (os.type === "rotina") {
        portalTab = "vistoria";
      } else if (os.type === "emergencial") {
        portalTab = "visita";
      } else if (["instalacao", "manutencao", "corretiva", "preventiva"].includes(os.type) && os.status === "concluida") {
        portalTab = "servico";
      } else {
        portalTab = "visita";
      }

      const workOrdersDb = await import("../workOrdersDb");
      await workOrdersDb.shareWorkOrderToPortal(input.workOrderId, portalTab);

      if (cliente?.phone) {
        const portalUrl = `https://app.soluteg.com.br/client/portal`;
        const tabLabel: Record<string, string> = { vistoria: "Vistoria", visita: "Visita", servico: "Serviços" };
        const saudacao = cliente.syndicName ? `Olá, ${cliente.syndicName}!` : `Olá!`;
        const msg =
          `📋 *JNC Soluteg – Portal do Cliente*\n\n` +
          `${saudacao}\n\n` +
          `A *${os.osNumber}* foi disponibilizada na aba *${tabLabel[portalTab] || portalTab}* do seu portal.\n\n` +
          `🔗 Acesse: ${portalUrl}\n` +
          `👤 Login: ${cliente.username}\n` +
          `🔑 Senha: (sua senha cadastrada)\n\n` +
          `Em caso de dúvidas, entre em contato conosco.`;
        const { sendWhatsappToNumber } = await import("../whatsapp");
        sendWhatsappToNumber(cliente.phone, msg).catch(e => console.error("Erro Zap portal:", e));
      }

      return { success: true };
    }),

  // ==================== TASKS ====================
  tasks: router({
    list: protectedTechnicianProcedure
      .input(z.object({ workOrderId: z.number() }))
      .query(async ({ input, ctx }) => {
        const os = await technicianDb.getWorkOrderByIdForTechnician(input.workOrderId, ctx.technicianId);
        if (!os) throw new TRPCError({ code: "NOT_FOUND", message: "OS não encontrada ou acesso negado" });
        const auxDb = await import("../workOrdersAuxDb");
        return await auxDb.getTasksByWorkOrderId(input.workOrderId);
      }),

    toggle: protectedTechnicianProcedure
      .input(z.object({
        workOrderId:  z.number(),
        taskId:       z.number(),
        isCompleted:  z.boolean(),
      }))
      .mutation(async ({ input, ctx }) => {
        const os = await technicianDb.getWorkOrderByIdForTechnician(input.workOrderId, ctx.technicianId);
        if (!os) throw new TRPCError({ code: "NOT_FOUND", message: "OS não encontrada ou acesso negado" });
        if (os.status !== "em_andamento" && os.status !== "pausada") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A OS precisa estar em andamento para marcar tarefas." });
        }
        const technician = await technicianDb.getTechnicianById(ctx.technicianId);
        const auxDb = await import("../workOrdersAuxDb");
        await auxDb.toggleTaskCompletion(
          input.taskId,
          input.isCompleted,
          technician?.name || `Técnico ${ctx.technicianId}`,
        );
        return { success: true };
      }),
  }),

  // ==================== COMMENTS ====================
  comments: router({
    list: protectedTechnicianProcedure
      .input(z.object({ workOrderId: z.number() }))
      .query(async ({ input, ctx }) => {
        const os = await technicianDb.getWorkOrderByIdForTechnician(input.workOrderId, ctx.technicianId);
        if (!os) throw new TRPCError({ code: "NOT_FOUND", message: "OS não encontrada ou acesso negado" });
        const auxDb = await import("../workOrdersAuxDb");
        return await auxDb.getCommentsByWorkOrderId(input.workOrderId, true);
      }),

    create: protectedTechnicianProcedure
      .input(z.object({
        workOrderId: z.number(),
        comment:     z.string().min(1),
        // false = visível ao cliente (isInternal=0); true = apenas interno (isInternal=1)
        isInternal:  z.boolean().default(true),
      }))
      .mutation(async ({ input, ctx }) => {
        const os = await technicianDb.getWorkOrderByIdForTechnician(input.workOrderId, ctx.technicianId);
        if (!os) throw new TRPCError({ code: "NOT_FOUND", message: "OS não encontrada ou acesso negado" });
        if (os.status !== "em_andamento" && os.status !== "pausada") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A OS precisa estar em andamento para adicionar comentários." });
        }
        const auxDb = await import("../workOrdersAuxDb");
        await auxDb.createComment({
          workOrderId: input.workOrderId,
          userId:      `tecnico-${ctx.technicianId}`,
          userType:    "admin",
          comment:     input.comment,
          isInternal:  input.isInternal ? 1 : 0,
        });
        return { success: true };
      }),
  }),

  // ==================== ATTACHMENTS ====================
  attachments: router({
    list: protectedTechnicianProcedure
      .input(z.object({ workOrderId: z.number() }))
      .query(async ({ input, ctx }) => {
        const os = await technicianDb.getWorkOrderByIdForTechnician(input.workOrderId, ctx.technicianId);
        if (!os) throw new TRPCError({ code: "NOT_FOUND", message: "OS não encontrada ou acesso negado" });
        const auxDb = await import("../workOrdersAuxDb");
        return await auxDb.getAttachmentsByWorkOrderId(input.workOrderId);
      }),

    create: protectedTechnicianProcedure
      .input(z.object({
        workOrderId: z.number(),
        fileName:    z.string().min(1),
        fileKey:     z.string().min(1),
        fileUrl:     z.string().min(1),
        fileType:    z.string().optional(),
        fileSize:    z.number().optional(),
        caption:     z.string().optional(),
        category:    z.enum(["before", "during", "after", "document", "other"]).default("during"),
      }))
      .mutation(async ({ input, ctx }) => {
        const os = await technicianDb.getWorkOrderByIdForTechnician(input.workOrderId, ctx.technicianId);
        if (!os) throw new TRPCError({ code: "NOT_FOUND", message: "OS não encontrada ou acesso negado" });
        if (os.status !== "em_andamento" && os.status !== "pausada") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A OS precisa estar em andamento para adicionar anexos." });
        }
        const auxDb = await import("../workOrdersAuxDb");
        // A coluna no banco é 'description', não 'caption' — mapeamos aqui para não depender
        // de spread que ignoraria campos desconhecidos no Drizzle.
        await auxDb.createAttachment({
          workOrderId: input.workOrderId,
          fileName:    input.fileName,
          fileKey:     input.fileKey,
          fileUrl:     input.fileUrl,
          fileType:    input.fileType,
          fileSize:    input.fileSize,
          category:    input.category,
          description: input.caption,   // caption do frontend → description no banco
          uploadedBy:  `tecnico-${ctx.technicianId}`,
        });
        return { success: true };
      }),

    // Editar a legenda (descrição) de uma foto já enviada
    updateCaption: protectedTechnicianProcedure
      .input(z.object({
        workOrderId:  z.number(),
        attachmentId: z.number(),
        caption:      z.string(),
      }))
      .mutation(async ({ input, ctx }) => {
        // Verifica que a OS pertence ao técnico
        const os = await technicianDb.getWorkOrderByIdForTechnician(input.workOrderId, ctx.technicianId);
        if (!os) throw new TRPCError({ code: "NOT_FOUND", message: "OS não encontrada ou acesso negado" });
        if (os.status !== "em_andamento" && os.status !== "pausada") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A OS precisa estar em andamento para editar legendas." });
        }
        const auxDb = await import("../workOrdersAuxDb");
        // Busca o anexo para confirmar que ele pertence a esta OS
        const attachments = await auxDb.getAttachmentsByWorkOrderId(input.workOrderId);
        const attachment = attachments.find((a: any) => a.id === input.attachmentId);
        if (!attachment) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Foto não encontrada nesta OS" });
        }
        // description é a coluna real no banco (o frontend chama de caption)
        await auxDb.updateAttachment(input.attachmentId, { description: input.caption });
        return { success: true };
      }),
  }),

  // ==================== CHECKLISTS ====================
  checklists: router({
    // Lista templates disponíveis (apenas estrutura, sem dados de negócio)
    listTemplates: protectedTechnicianProcedure
      .query(async () => {
        const checklistDb = await import("../checklistsDb");
        return await checklistDb.getAllTemplates();
      }),

    // Lista checklists da OS — verifica ownership via technicianId
    listByWorkOrder: protectedTechnicianProcedure
      .input(z.object({ workOrderId: z.number() }))
      .query(async ({ input, ctx }) => {
        const os = await technicianDb.getWorkOrderByIdForTechnician(input.workOrderId, ctx.technicianId);
        if (!os) throw new TRPCError({ code: "NOT_FOUND", message: "OS não encontrada ou acesso negado" });
        const checklistDb = await import("../checklistsDb");
        return await checklistDb.getChecklistsByWorkOrderId(input.workOrderId);
      }),

    // Salva respostas — verifica que o checklist pertence a uma OS do técnico
    updateResponses: protectedTechnicianProcedure
      .input(z.object({
        checklistId: z.number(),
        workOrderId: z.number(),
        responses:   z.record(z.string(), z.unknown()),
        isComplete:  z.boolean(),
      }))
      .mutation(async ({ input, ctx }) => {
        const os = await technicianDb.getWorkOrderByIdForTechnician(input.workOrderId, ctx.technicianId);
        if (!os) throw new TRPCError({ code: "NOT_FOUND", message: "OS não encontrada ou acesso negado" });
        if (os.status !== "em_andamento" && os.status !== "pausada") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A OS precisa estar em andamento para preencher checklists." });
        }
        // Verifica que o checklistId pertence de fato a esta OS
        const checklistDb = await import("../checklistsDb");
        const instance = await checklistDb.getChecklistInstanceById(input.checklistId);
        if (!instance) throw new TRPCError({ code: "NOT_FOUND", message: "Checklist não encontrado" });
        // Busca a inspectionTask para confirmar que pertence à OS correta
        const task = await checklistDb.getInspectionTaskById(instance.inspectionTaskId);
        if (!task || task.workOrderId !== input.workOrderId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Checklist não pertence a esta OS" });
        }
        await checklistDb.updateChecklistResponses(input.checklistId, input.responses, input.isComplete);
        return { success: true };
      }),

    // Adiciona um novo checklist à OS — cria a inspectionTask automaticamente se não existir
    addChecklist: protectedTechnicianProcedure
      .input(z.object({
        workOrderId:  z.number(),
        templateId:   z.number().int().positive(),
        customTitle:  z.string().min(1).max(255),
        brand:        z.string().max(100).optional(),
        power:        z.string().max(50).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const os = await technicianDb.getWorkOrderByIdForTechnician(input.workOrderId, ctx.technicianId);
        if (!os) throw new TRPCError({ code: "NOT_FOUND", message: "OS não encontrada ou acesso negado" });
        if (os.status !== "em_andamento" && os.status !== "pausada") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A OS precisa estar em andamento para adicionar checklists." });
        }
        const checklistDb = await import("../checklistsDb");
        const template = await checklistDb.getTemplateById(input.templateId);
        if (!template) throw new TRPCError({ code: "NOT_FOUND", message: "Template não encontrado" });

        // Reutiliza a primeira inspectionTask existente ou cria uma nova
        // Posse já validada acima (getWorkOrderByIdForTechnician) — aqui só carimba o tenantId.
        const tasks = await checklistDb.getInspectionTasksByWorkOrder(input.workOrderId);
        const taskId = tasks.length > 0
          ? tasks[0].id
          : await checklistDb.createInspectionTask({ tenantId: ctx.tenantId, workOrderId: input.workOrderId, title: "Checklists de Equipamentos" });

        const instanceId = await checklistDb.createChecklistInstance({
          tenantId:         ctx.tenantId,
          inspectionTaskId: taskId,
          templateId:       input.templateId,
          customTitle:      input.customTitle,
          brand:            input.brand,
          power:            input.power,
        });

        return { id: instanceId };
      }),

    // Remove um checklist da OS — verifica ownership antes de deletar
    deleteChecklist: protectedTechnicianProcedure
      .input(z.object({
        checklistId: z.number(),
        workOrderId: z.number(),
      }))
      .mutation(async ({ input, ctx }) => {
        const os = await technicianDb.getWorkOrderByIdForTechnician(input.workOrderId, ctx.technicianId);
        if (!os) throw new TRPCError({ code: "NOT_FOUND", message: "OS não encontrada ou acesso negado" });
        const checklistDb = await import("../checklistsDb");
        const instance = await checklistDb.getChecklistInstanceById(input.checklistId);
        if (!instance) throw new TRPCError({ code: "NOT_FOUND", message: "Checklist não encontrado" });
        const task = await checklistDb.getInspectionTaskById(instance.inspectionTaskId);
        if (!task || task.workOrderId !== input.workOrderId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Checklist não pertence a esta OS" });
        }
        await checklistDb.deleteChecklistInstance(input.checklistId);
        return { success: true };
      }),

    // Gera sugestão de conclusão com IA — verifica que o checklist pertence ao técnico
    suggestConclusion: protectedTechnicianProcedure
      .input(z.object({
        checklistId: z.number(),
        workOrderId: z.number(),
      }))
      .mutation(async ({ input, ctx }) => {
        const os = await technicianDb.getWorkOrderByIdForTechnician(input.workOrderId, ctx.technicianId);
        if (!os) throw new TRPCError({ code: "NOT_FOUND", message: "OS não encontrada ou acesso negado" });
        const checklistDb = await import("../checklistsDb");
        const instance = await checklistDb.getChecklistInstanceById(input.checklistId);
        if (!instance) throw new TRPCError({ code: "NOT_FOUND", message: "Checklist não encontrado" });
        const task = await checklistDb.getInspectionTaskById(instance.inspectionTaskId);
        if (!task || task.workOrderId !== input.workOrderId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Checklist não pertence a esta OS" });
        }
        const { sugerirConclusaoChecklist } = await import("../iaChecklists");
        return await sugerirConclusaoChecklist(input.checklistId);
      }),
  }),
});
