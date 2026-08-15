import * as db from "../db";
import { adminLocalProcedure, protectedClientProcedure, publicProcedure, router } from "../_core/trpc";
import { withTenant } from "../_core/tenant";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

export const documentsRouter = router({
  // Escopado pelo cliente logado (ctx.clientId) — um cliente pertence a um único
  // tenant, então já é seguro por construção. Sem guarda extra necessária.
  list: protectedClientProcedure
    .input(z.object({
      search: z.string().optional(),
      documentType: z.enum(["vistoria", "visita", "nota_fiscal", "servico", "relatorio_servico", "relatorio_visita", "all"]).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      return await db.getDocumentsByClientIdWithFilters({ ...input, clientId: ctx.clientId });
    }),

  // ISOLADO: lista por tenant (regra 5.3 — adminId nunca vem do input).
  listAll: adminLocalProcedure
    .input(z.object({
      search: z.string().optional(),
      clientId: z.number().optional(),
      documentType: z.enum(["relatorio_servico", "relatorio_visita", "nota_fiscal", "outro", "all"]).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      return await db.getAllDocumentsWithFilters({ ...input, tenantId: ctx.tenantId });
    }),

  create: adminLocalProcedure
    .input(z.object({
      clientId: z.number(),
      title: z.string().min(1),
      description: z.string().optional(),
      documentType: z.enum(["vistoria", "visita", "nota_fiscal", "servico", "relatorio_servico", "relatorio_visita"]),
      fileUrl: z.string().url(),
      fileKey: z.string(),
      fileSize: z.number().optional(),
      mimeType: z.string().optional(),
      month: z.number().min(1).max(12).optional(),
      year: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // GUARDA: o cliente do documento precisa pertencer ao tenant do admin logado.
      // ANTES: sem checagem — dava pra anexar documento a um clientId de outro tenant.
      const cliente = await db.getClientById(input.clientId);
      if (!cliente || cliente.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado" });
      }

      await db.createClientDocument(
        withTenant(ctx, { ...input, adminId: ctx.adminId }) as any
      );
      return { success: true, message: "Documento enviado com sucesso" };
    }),

  delete: adminLocalProcedure // ISOLADO COM GUARDA
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const doc = await db.getDocumentById(input.id);
      if (!doc || doc.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado" });
      }
      await db.deleteClientDocument(input.id);
      return { success: true, message: "Documento deletado com sucesso" };
    }),

  getById: adminLocalProcedure // ISOLADO COM GUARDA
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const doc = await db.getDocumentById(input.id);
      if (!doc || doc.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado" });
      }
      return doc;
    }),
});
