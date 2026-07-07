import * as db from "../db";
import { adminLocalProcedure, protectedClientProcedure, publicProcedure, router } from "../_core/trpc";
import { z } from "zod";

export const documentsRouter = router({
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

  listAll: adminLocalProcedure
    .input(z.object({
      search: z.string().optional(),
      clientId: z.number().optional(),
      documentType: z.enum(["relatorio_servico", "relatorio_visita", "nota_fiscal", "outro", "all"]).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      return await db.getAllDocumentsWithFilters({ ...input, adminId: ctx.adminId });
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
      await db.createClientDocument({ ...input, adminId: ctx.adminId });
      return { success: true, message: "Documento enviado com sucesso" };
    }),

  delete: adminLocalProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteClientDocument(input.id);
      return { success: true, message: "Documento deletado com sucesso" };
    }),

  getById: adminLocalProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return await db.getDocumentById(input.id);
    }),
});
