import * as db from "../db";
import { sendWhatsappAlert, sendWhatsappAlertWithPDF, sendWhatsappToNumberWithPDF } from "../whatsapp";
import { adminLocalProcedure, protectedClientProcedure, publicProcedure, router } from "../_core/trpc";
import { withTenant } from "../_core/tenant";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { notify } from "../lib/notifications";


export const budgetsRouter = router({
  // ISOLADO: lista por tenant (regra 5.3 — adminId nunca vem do input).
  list: adminLocalProcedure
    .input(z.object({
      clientId: z.number().optional(),
      status: z.enum(["pendente", "finalizado", "aprovado", "reprovado"]).optional(),
      search: z.string().optional(),
      page: z.number().default(1),
      limit: z.number().default(10),
      sortBy: z.string().default("createdAt"),
      sortOrder: z.enum(["asc", "desc"]).default("desc"),
    }))
    .query(async ({ input, ctx }) => {
      const budgetsDb = await import("../budgetsDb");
      return await budgetsDb.listBudgets({ ...input, tenantId: ctx.tenantId });
    }),

  getById: adminLocalProcedure // ISOLADO COM GUARDA
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const budgetsDb = await import("../budgetsDb");
      const budget = await budgetsDb.getBudgetById(input.id);
      if (!budget || budget.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Orçamento não encontrado" });
      }
      return budget;
    }),

  // GLOBAL POR DESIGN: página pública de aprovação (/orcamento/:token), sem admin logado
  // e sem ctx.tenantId. O token opaco (64 hex chars, crypto.randomBytes) é a credencial —
  // NÃO adicionar guarda de tenantId aqui, quebraria a aprovação em produção.
  getByToken: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const budgetsDb = await import("../budgetsDb");
      return await budgetsDb.getBudgetByToken(input.token);
    }),

  // Criar orçamento — somente admin autenticado. adminId vem do JWT, não do input.
  create: adminLocalProcedure
    .input(z.object({
      clientId: z.number(),
      serviceType: z.enum(["instalacao", "manutencao", "corretiva", "preventiva", "rotina", "emergencial"]),
      priority: z.enum(["normal", "alta", "critica"]).default("normal"),
      title: z.string().min(1),
      description: z.string().optional(),
      scope: z.string().optional(),
      validityDays: z.number().default(30),
      laborValue: z.number().optional(),
      internalNotes: z.string().optional(),
      clientNotes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const budgetsDb = await import("../budgetsDb");

      // GUARDA: o cliente do orçamento precisa pertencer ao tenant do admin logado.
      // ANTES: sem checagem — dava pra criar orçamento no tenant 1 referenciando
      // clientId de outro tenant, vazando nome/telefone desse cliente no PDF e no Zap.
      const cliente = await db.getClientById(input.clientId);
      if (!cliente || cliente.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado" });
      }

      const result = await budgetsDb.createBudget(
        withTenant(ctx, { ...input, adminId: ctx.adminId }) as any
      );

      const nomeCliente = cliente?.name || `ID ${input.clientId}`;
      const adminUrl = `https://app.soluteg.com.br/gestor/orcamentos/${result.id}`;
      const msg =
        `📝 *NOVO ORÇAMENTO - JNC SOLUTEG*\n\n` +
        `🏢 *Cliente:* ${nomeCliente}\n` +
        `🔧 *Serviço:* ${input.title}\n` +
        `📋 *Número:* ${result.budgetNumber}\n\n` +
        `🔗 *Acessar:* ${adminUrl}`;
      sendWhatsappAlert(msg).catch(e => console.error("Erro Zap orçamento:", e));

      return { success: true, ...result };
    }),

  update: adminLocalProcedure
    .input(z.object({
      id: z.number(),
      serviceType: z.enum(["instalacao", "manutencao", "corretiva", "preventiva", "rotina", "emergencial"]).optional(),
      priority: z.enum(["normal", "alta", "critica"]).optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      scope: z.string().optional(),
      validityDays: z.number().optional(),
      laborValue: z.number().optional(),
      totalValue: z.number().optional(),
      internalNotes: z.string().optional(),
      clientNotes: z.string().optional(),
      saveSnapshot: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      // changedBy vem do JWT (ctx.adminId), não do frontend (MED-04)
      const budgetsDb = await import("../budgetsDb");
      const { id, saveSnapshot, ...data } = input;

      // GUARDA: orçamento precisa pertencer ao tenant do admin logado.
      const existing = await budgetsDb.getBudgetById(id);
      if (!existing || existing.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Orçamento não encontrado" });
      }

      await budgetsDb.updateBudget(id, data as any, String(ctx.adminId), saveSnapshot);
      return { success: true, message: "Orçamento atualizado com sucesso" };
    }),

  saveItems: adminLocalProcedure
    .input(z.object({
      budgetId: z.number(),
      items: z.array(z.object({
        description: z.string().min(1),
        quantity: z.number(),
        unit: z.string(),
        unitPrice: z.number(),
        totalPrice: z.number(),
        orderIndex: z.number(),
      })),
    }))
    .mutation(async ({ input, ctx }) => {
      const budgetsDb = await import("../budgetsDb");

      // GUARDA: orçamento (pai dos itens) precisa pertencer ao tenant do admin logado.
      const budget = await budgetsDb.getBudgetById(input.budgetId);
      if (!budget || budget.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Orçamento não encontrado" });
      }

      await budgetsDb.upsertBudgetItems(input.budgetId, ctx.tenantId, input.items);
      const itemsTotal = await budgetsDb.getTotalItemsValue(input.budgetId);
      // Mão de obra agora é um item na lista — totalValue = soma dos itens diretamente
      await budgetsDb.updateBudget(input.budgetId, { totalValue: itemsTotal }, "system");
      return { success: true, message: "Itens salvos com sucesso" };
    }),

  // Listar itens — somente admin. Use getItemsByToken para acesso público (página de aprovação).
  getItems: adminLocalProcedure
    .input(z.object({ budgetId: z.number() }))
    .query(async ({ input, ctx }) => {
      const budgetsDb = await import("../budgetsDb");

      // GUARDA: orçamento (pai dos itens) precisa pertencer ao tenant do admin logado.
      const budget = await budgetsDb.getBudgetById(input.budgetId);
      if (!budget || budget.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Orçamento não encontrado" });
      }

      return await budgetsDb.getBudgetItems(input.budgetId);
    }),

  // GLOBAL POR DESIGN: página pública de aprovação, token opaco é a credencial (ver getByToken).
  getItemsByToken: publicProcedure
    .input(z.object({ token: z.string().min(10) }))
    .query(async ({ input }) => {
      const budgetsDb = await import("../budgetsDb");
      const budget = await budgetsDb.getBudgetByToken(input.token);
      if (!budget) throw new TRPCError({ code: "NOT_FOUND", message: "Orçamento não encontrado" });
      return await budgetsDb.getBudgetItems(budget.id);
    }),

  finalize: adminLocalProcedure
    .input(z.object({
      id: z.number(),
      technicianName: z.string().min(1),
      technicianSignature: z.string().min(1),
      technicianDocument: z.string().optional(),
      validityDays: z.number().default(30),
    }))
    .mutation(async ({ input, ctx }) => {
      const budgetsDb = await import("../budgetsDb");
      const { id, technicianName, technicianSignature, technicianDocument, validityDays } = input;

      // GUARDA: orçamento precisa pertencer ao tenant do admin logado.
      const existing = await budgetsDb.getBudgetById(id);
      if (!existing || existing.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Orçamento não encontrado" });
      }

      // changedBy vem do JWT (ctx.adminId), não do frontend — antes vinha de input.adminId.
      const result = await budgetsDb.finalizeBudget(id, technicianName, technicianSignature, technicianDocument, validityDays, String(ctx.adminId));

      const budget = await budgetsDb.getBudgetById(id);
      if (budget) {
        const cliente = await db.getClientById(budget.clientId);
        if (cliente) {
          const approvalUrl = `https://app.soluteg.com.br/orcamento/${result.token}`;
          const valor = `R$ ${((budget.totalValue ?? 0) / 100).toFixed(2).replace('.', ',')}`;
          const validade = result.validUntil.toLocaleDateString('pt-BR');

          // Notifica via Push (se PWA instalado) com fallback WhatsApp
          notify(
            {
              title: "Orçamento disponível para aprovação",
              body: `${budget.budgetNumber} — ${budget.title} — ${valor}`,
              url: `/orcamento/${result.token}`,
              tag: `budget-${id}`,
              whatsappMessage:
                `📋 *JNC Soluteg – Orçamento Disponível*\n\n` +
                `Olá, ${cliente.name}!\n\n` +
                `Seu orçamento *${budget.budgetNumber}* está pronto para análise.\n` +
                `🔧 Serviço: ${budget.title}\n` +
                `💰 Valor total: ${valor}\n` +
                `📅 Válido até: ${validade}\n\n` +
                `👉 *Acesse para aprovar ou reprovar:*\n${approvalUrl}`,
            },
            {
              userId: budget.clientId,
              userType: "client",
              notificationType: "budget_new",
              channel: "auto",
              whatsappPhone: cliente.phone ?? undefined,
            }
          ).catch(e => console.error("[NOTIFY] Erro ao notificar cliente sobre orçamento:", e));
        }
      }

      return { success: true, token: result.token, validUntil: result.validUntil };
    }),

  // GLOBAL POR DESIGN: aprovar orçamento via token opaco (do link enviado ao cliente),
  // não ID sequencial. changedByType sempre "client". Sem ctx.tenantId (não há admin
  // logado) — o tenantId da OS gerada vem do próprio `budget.tenantId` carregado pelo token.
  approve: publicProcedure
    .input(z.object({
      token: z.string().min(10),           // token do link de aprovação (/orcamento/:token)
      clientSignature: z.string().min(1),
      clientSignatureName: z.string().min(1),
      approvedBy: z.string(),
      createOs: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const budgetsDb = await import("../budgetsDb");
      const budget = await budgetsDb.getBudgetByToken(input.token);
      if (!budget) throw new TRPCError({ code: "NOT_FOUND", message: "Orçamento não encontrado" });
      if (budget.status !== "finalizado") throw new TRPCError({ code: "BAD_REQUEST", message: "Orçamento não está disponível para aprovação" });
      await budgetsDb.approveBudget(budget.id, input.clientSignature, input.clientSignatureName, input.approvedBy, "client");

      // Reusar o `budget` já carregado pelo token — não precisamos buscar novamente
      let osId: number | null = null;
      if (input.createOs) {
        // publicProcedure: não há ctx.tenantId (aprovação via link, sem admin logado).
        // O tenantId só pode vir do próprio orçamento — se não vier, não cria OS órfã.
        if (!budget.tenantId) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Orçamento sem tenant definido — não é possível gerar a OS" });
        }
        const workOrdersDb = await import("../workOrdersDb");
        const b = budget as any;
        const osResult = await workOrdersDb.createWorkOrder({
          tenantId: budget.tenantId,
          adminId: b.adminId,
          clientId: b.clientId,
          type: b.serviceType,
          priority: b.priority,
          title: budget.title,
          description: `${budget.description ?? ''}\n\n[Gerado a partir do Orçamento ${budget.budgetNumber}]`.trim(),
          status: "aberta",
          estimatedValue: budget.totalValue != null ? budget.totalValue / 100 : undefined,
          internalNotes: `Orçamento de origem: ${budget.budgetNumber}`,
        } as any);
        osId = osResult.id;
        await budgetsDb.linkGeneratedOs(budget.id, osId);

        // Copiar fotos do orçamento como anexos "before" da OS
        const auxDb = await import("../workOrdersAuxDb");
        const budgetPhotos = await budgetsDb.getBudgetAttachments(budget.id);
        for (const photo of budgetPhotos) {
          await auxDb.createAttachment({
            workOrderId: osId,
            fileName:    photo.fileName,
            fileKey:     photo.fileKey,
            fileUrl:     photo.fileUrl,
            fileType:    photo.fileType ?? undefined,
            fileSize:    photo.fileSize ?? undefined,
            category:    "before",
            description: photo.caption ?? undefined,
            uploadedBy:  photo.uploadedBy ?? undefined,
          } as any);
        }

        const adminUrl = `https://app.soluteg.com.br/gestor/work-orders/${osId}`;
        const msg =
          `✅ *ORÇAMENTO APROVADO – OS GERADA*\n\n` +
          `📋 Orçamento: ${budget.budgetNumber}\n` +
          `🏢 Cliente: ${budget.clientName ?? ''}\n` +
          `🔗 OS Gerada: ${adminUrl}`;
        sendWhatsappAlert(msg).catch(e => console.error("Erro Zap OS gerada:", e));
      }

      return { success: true, osId };
    }),

  // GLOBAL POR DESIGN: reprovar orçamento via token opaco. changedByType sempre "client".
  reject: publicProcedure
    .input(z.object({
      token: z.string().min(10),
      rejectionReason: z.string().min(1),
      rejectedBy: z.string(),
    }))
    .mutation(async ({ input }) => {
      const budgetsDb = await import("../budgetsDb");
      const budget = await budgetsDb.getBudgetByToken(input.token);
      if (!budget) throw new TRPCError({ code: "NOT_FOUND", message: "Orçamento não encontrado" });
      if (budget.status !== "finalizado") throw new TRPCError({ code: "BAD_REQUEST", message: "Orçamento não está disponível para reprovação" });
      await budgetsDb.rejectBudget(budget.id, input.rejectionReason, input.rejectedBy, "client");
      return { success: true, message: "Orçamento reprovado" };
    }),

  // Reprovar orçamento pelo painel admin — usa ID direto (adminLocalProcedure).
  // O "reject" público usa token opaco; este é exclusivo para ação interna do admin.
  rejectByAdmin: adminLocalProcedure
    .input(z.object({
      id: z.number(),
      rejectionReason: z.string().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const budgetsDb = await import("../budgetsDb");
      const budget = await budgetsDb.getBudgetById(input.id);
      // GUARDA: já checava existência; agora também checa tenant.
      if (!budget || budget.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Orçamento não encontrado" });
      }
      await budgetsDb.rejectBudget(budget.id, input.rejectionReason, `admin-${ctx.adminId}`, "admin");
      return { success: true, message: "Orçamento reprovado" };
    }),

  getHistory: adminLocalProcedure
    .input(z.object({ budgetId: z.number() }))
    .query(async ({ input, ctx }) => {
      const budgetsDb = await import("../budgetsDb");

      // GUARDA: orçamento (pai do histórico) precisa pertencer ao tenant do admin logado.
      const budget = await budgetsDb.getBudgetById(input.budgetId);
      if (!budget || budget.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Orçamento não encontrado" });
      }

      return await budgetsDb.getBudgetHistory(input.budgetId);
    }),

  // ISOLADO: métricas por tenant (regra 5.3 — adminId nunca vem do input;
  // antes vazava métricas cross-tenant pra qualquer admin que soubesse o adminId de outro).
  getMetrics: adminLocalProcedure
    .query(async ({ ctx }) => {
      const budgetsDb = await import("../budgetsDb");
      return await budgetsDb.getBudgetMetrics(ctx.tenantId);
    }),

  delete: adminLocalProcedure // ISOLADO COM GUARDA
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const budgetsDb = await import("../budgetsDb");

      // GUARDA: ANTES não havia checagem nenhuma — qualquer admin logado deletava
      // qualquer orçamento por ID, de qualquer tenant (IDOR).
      const budget = await budgetsDb.getBudgetById(input.id);
      if (!budget || budget.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Orçamento não encontrado" });
      }

      await budgetsDb.deleteBudget(input.id);
      return { success: true, message: "Orçamento deletado com sucesso" };
    }),

  // Exportar PDF \u2014 somente admin. Use exportPDFByToken para a p\u00E1gina p\u00FAblica de aprova\u00E7\u00E3o.
  exportPDF: adminLocalProcedure // ISOLADO COM GUARDA
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const budgetsDb = await import("../budgetsDb");

      // GUARDA: checar posse ANTES de gerar o PDF (antes, o PDF era gerado
      // direto pelo ID sem checagem nenhuma).
      const budget = await budgetsDb.getBudgetById(input.id);
      if (!budget || budget.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Or\u00E7amento n\u00E3o encontrado" });
      }

      const pdfGen = await import("../pdfGenerator");
      const pdfBuffer = await pdfGen.generateBudgetPDF(input.id);
      const num = budget?.budgetNumber || `ORC-${input.id}`;
      const clientSlug = budget?.clientName
        ? budget.clientName.trim().replace(/[^\w\u00C0-\u00FF]/g, '_').replace(/_+/g, '_').substring(0, 40)
        : 'cliente';
      return {
        success: true,
        pdf: pdfBuffer.toString('base64'),
        filename: `${num}_${clientSlug}.pdf`,
      };
    }),

  // Exportar PDF via token \u2014 usado na p\u00E1gina p\u00FAblica de aprova\u00E7\u00E3o (/orcamento/:token)
  // GLOBAL POR DESIGN: página pública de aprovação, token opaco é a credencial (ver getByToken).
  exportPDFByToken: publicProcedure
    .input(z.object({ token: z.string().min(10) }))
    .mutation(async ({ input }) => {
      const budgetsDb = await import("../budgetsDb");
      const budget = await budgetsDb.getBudgetByToken(input.token);
      if (!budget) throw new TRPCError({ code: "NOT_FOUND", message: "Or\u00E7amento n\u00E3o encontrado" });
      const pdfGen = await import("../pdfGenerator");
      const pdfBuffer = await pdfGen.generateBudgetPDF(budget.id);
      const clientSlug = budget.clientName
        ? budget.clientName.trim().replace(/[^\w\u00C0-\u00FF]/g, '_').replace(/_+/g, '_').substring(0, 40)
        : 'cliente';
      return {
        success: true,
        pdf: pdfBuffer.toString('base64'),
        filename: `${budget.budgetNumber}_${clientSlug}.pdf`,
      };
    }),

  generateOs: adminLocalProcedure // ISOLADO COM GUARDA (já existia antes do resto do router)
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const budgetsDb = await import("../budgetsDb");
      const budget = await budgetsDb.getBudgetById(input.id);
      if (!budget || budget.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Orçamento não encontrado" });
      }
      if (budget.status !== "aprovado") throw new TRPCError({ code: "BAD_REQUEST", message: "Orçamento precisa estar aprovado" });

      const workOrdersDb = await import("../workOrdersDb");
      if (budget.generatedOsId) {
        const existingOs = await workOrdersDb.getWorkOrderById(budget.generatedOsId);
        if (existingOs) throw new TRPCError({ code: "BAD_REQUEST", message: "OS já foi gerada para este orçamento" });
      }
      const osResult = await workOrdersDb.createWorkOrder({
        tenantId: ctx.tenantId,
        adminId: budget.adminId,
        clientId: budget.clientId,
        type: budget.serviceType as any,
        priority: budget.priority as any,
        title: budget.title,
        description: `${budget.description ?? ''}\n\n[Gerado a partir do Orçamento ${budget.budgetNumber}]`.trim(),
        status: "aberta",
        estimatedValue: budget.totalValue != null ? budget.totalValue / 100 : undefined,
        internalNotes: `Orçamento de origem: ${budget.budgetNumber}`,
      } as any);

      await budgetsDb.linkGeneratedOs(input.id, osResult.id);

      // Copiar fotos do orçamento como anexos "before" da OS
      const auxDb = await import("../workOrdersAuxDb");
      const budgetPhotos = await budgetsDb.getBudgetAttachments(input.id);
      for (const photo of budgetPhotos) {
        await auxDb.createAttachment({
          workOrderId: osResult.id,
          fileName:    photo.fileName,
          fileKey:     photo.fileKey,
          fileUrl:     photo.fileUrl,
          fileType:    photo.fileType ?? undefined,
          fileSize:    photo.fileSize ?? undefined,
          category:    "before",
          description: photo.caption ?? undefined,
          uploadedBy:  photo.uploadedBy ?? undefined,
        } as any);
      }

      return { success: true, osId: osResult.id };
    }),

  shareToPortal: adminLocalProcedure // ISOLADO COM GUARDA
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const budgetsDb = await import("../budgetsDb");

      // GUARDA: ANTES não havia checagem nenhuma — qualquer admin logado compartilhava
      // qualquer orçamento por ID no portal, de qualquer tenant (IDOR).
      const budget = await budgetsDb.getBudgetById(input.id);
      if (!budget || budget.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Orçamento não encontrado" });
      }

      await budgetsDb.updateBudget(input.id, { sharedWithPortal: 1 }, "admin");
      return { success: true };
    }),

  // Orçamentos visíveis no portal do cliente — usa ctx.clientId do JWT, sem ID no input.
  // Já era seguro (um cliente pertence a um único tenant); tenantId passado defensivamente.
  getForPortal: protectedClientProcedure
    .query(async ({ ctx }) => {
      const budgetsDb = await import("../budgetsDb");
      return await budgetsDb.listBudgets({
        tenantId: ctx.tenantId,
        clientId: ctx.clientId,
        sortBy: "createdAt",
        sortOrder: "desc",
        limit: 50,
      });
    }),

  sendWhatsappBudget: adminLocalProcedure // ISOLADO COM GUARDA
    .input(z.object({
      id: z.number(),
      target: z.enum(["admin", "client"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const budgetsDb = await import("../budgetsDb");
      const budget = await budgetsDb.getBudgetById(input.id);
      if (!budget || budget.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Orçamento não encontrado" });
      }

      const pdfGen = await import("../pdfGenerator");
      const pdfBuffer = await pdfGen.generateBudgetPDF(input.id);
      const clientSlug = budget.clientName
        ? budget.clientName.trim().replace(/[^\w\u00C0-\u00FF]/g, '_').replace(/_+/g, '_').substring(0, 40)
        : 'cliente';
      const filename = `${budget.budgetNumber}_${clientSlug}.pdf`;
      const valorFmt = ((budget.totalValue ?? 0) / 100).toFixed(2).replace('.', ',');

      if (input.target === "client") {
        if (!budget.clientPhone) throw new TRPCError({ code: "BAD_REQUEST", message: "Cliente sem telefone cadastrado" });
        const approvalUrl = budget.approvalToken
          ? `https://app.soluteg.com.br/orcamento/${budget.approvalToken}`
          : null;
        const msg =
          `📄 *Orçamento ${budget.budgetNumber}*\n\n` +
          `Olá, ${budget.clientName ?? 'cliente'}! Segue em anexo o orçamento referente ao serviço:\n` +
          `🔧 *${budget.title}*\n\n` +
          `💰 *Valor Total:* R$ ${valorFmt}\n` +
          (budget.validUntil ? `📅 *Válido até:* ${new Date(budget.validUntil).toLocaleDateString('pt-BR')}\n` : '') +
          (approvalUrl ? `\n👉 *Aprovar/Reprovar:* ${approvalUrl}` : '');
        await sendWhatsappToNumberWithPDF(budget.clientPhone, msg, pdfBuffer, filename);
      } else {
        const msg =
          `📄 *ORÇAMENTO ${budget.budgetNumber}*\n\n` +
          `🏢 *Cliente:* ${budget.clientName ?? ''}\n` +
          `🔧 *Serviço:* ${budget.title}\n` +
          `💰 *Valor Total:* R$ ${valorFmt}\n` +
          `📋 *Status:* ${budget.status}`;
        await sendWhatsappAlertWithPDF(msg, pdfBuffer, filename);
      }

      return { success: true };
    }),

  // ==================== ATTACHMENTS ====================
  attachments: router({
    list: adminLocalProcedure // ISOLADO COM GUARDA
      .input(z.object({ budgetId: z.number() }))
      .query(async ({ input, ctx }) => {
        const budgetsDb = await import("../budgetsDb");

        // GUARDA: orçamento (pai dos anexos) precisa pertencer ao tenant do admin logado.
        const budget = await budgetsDb.getBudgetById(input.budgetId);
        if (!budget || budget.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Orçamento não encontrado" });
        }

        return await budgetsDb.getBudgetAttachments(input.budgetId);
      }),

    // GLOBAL POR DESIGN: página pública de aprovação, token opaco é a credencial (ver getByToken).
    // "Pública: usada na página de aprovação — exige token válido para evitar enumeração por ID"
    listByToken: publicProcedure
      .input(z.object({ token: z.string().min(10) }))
      .query(async ({ input }) => {
        const budgetsDb = await import("../budgetsDb");
        const budget = await budgetsDb.getBudgetByToken(input.token);
        if (!budget) throw new TRPCError({ code: "NOT_FOUND", message: "Orçamento não encontrado" });
        return await budgetsDb.getBudgetAttachments(budget.id);
      }),

    create: adminLocalProcedure // ISOLADO COM GUARDA
      .input(z.object({
        budgetId:   z.number(),
        fileName:   z.string().min(1),
        fileKey:    z.string().min(1),
        fileUrl:    z.string().min(1),
        fileType:   z.string().optional(),
        fileSize:   z.number().optional(),
        caption:    z.string().optional(),
        uploadedBy: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const budgetsDb = await import("../budgetsDb");

        // GUARDA: orçamento (pai do anexo) precisa pertencer ao tenant do admin logado.
        const budget = await budgetsDb.getBudgetById(input.budgetId);
        if (!budget || budget.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Orçamento não encontrado" });
        }

        // carimba tenantId no anexo (evita novos NULLs antes da 3.7.1f)
        await budgetsDb.createBudgetAttachment({ ...input, tenantId: ctx.tenantId } as any);
        return { success: true };
      }),

    /*
     * GUARDA MULTI-ETAPA (o anexo só chega com o próprio `id`, sem budgetId no input):
     * 1. busca o anexo para achar o budgetId dono;
     * 2. busca o orçamento para checar o tenantId.
     * ANTES: sem nenhuma checagem de posse — qualquer admin logado podia editar/remover
     * anexo de qualquer orçamento, de qualquer tenant, só sabendo o ID.
     */
    updateCaption: adminLocalProcedure
      .input(z.object({
        id:      z.number(),
        caption: z.string(),
      }))
      .mutation(async ({ input, ctx }) => {
        const budgetsDb = await import("../budgetsDb");

        const attachment = await budgetsDb.getBudgetAttachmentById(input.id);
        if (!attachment) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Anexo não encontrado" });
        }
        const budget = await budgetsDb.getBudgetById(attachment.budgetId);
        if (!budget || budget.tenantId !== ctx.tenantId) {
          // NOT_FOUND (não FORBIDDEN) para não vazar a existência do anexo em outro tenant.
          throw new TRPCError({ code: "NOT_FOUND", message: "Anexo não encontrado" });
        }

        await budgetsDb.updateBudgetAttachmentCaption(input.id, input.caption);
        return { success: true };
      }),

    delete: adminLocalProcedure // GUARDA MULTI-ETAPA — ver comentário em updateCaption
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const budgetsDb = await import("../budgetsDb");

        const attachment = await budgetsDb.getBudgetAttachmentById(input.id);
        if (!attachment) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Anexo não encontrado" });
        }
        const budget = await budgetsDb.getBudgetById(attachment.budgetId);
        if (!budget || budget.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Anexo não encontrado" });
        }

        await budgetsDb.deleteBudgetAttachment(input.id);
        return { success: true };
      }),
  }),
});
