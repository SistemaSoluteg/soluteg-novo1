import * as db from "../db";
import { adminLocalProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

// NOTA: duplicata funcional de adminProfile.adminDocuments (mesmos 3 endpoints,
// mesmas funções de db.ts). Nenhum dos dois parece ser chamado pelo frontend hoje
// (grep em src/ não achou uso de trpc.adminDocuments.* nem trpc.adminProfile.adminDocuments.*).
// Candidato à faxina — não removido agora para não misturar escopo com o isolamento.
export const adminDocumentsRouter = router({
  // ISOLADO: lista por tenant (regra 5.3 — adminId nunca vem do input).
  list: adminLocalProcedure
    .query(async ({ ctx }) => {
      return await db.getDocumentsByTenant(ctx.tenantId);
    }),

  update: adminLocalProcedure // ISOLADO COM GUARDA
    .input(z.object({
      id: z.number(),
      title: z.string().min(1),
      description: z.string().optional(),
      documentType: z.enum(["vistoria", "visita", "nota_fiscal", "servico", "relatorio_servico", "relatorio_visita"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, title, description, documentType } = input;
      const doc = await db.getDocumentById(id);
      if (!doc || doc.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado" });
      }
      await db.updateDocument(id, title, description || "", documentType);
      return { success: true, message: "Documento atualizado com sucesso" };
    }),

  delete: adminLocalProcedure // ISOLADO COM GUARDA
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const doc = await db.getDocumentById(input.id);
      if (!doc || doc.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado" });
      }
      await db.deleteDocument(input.id);
      return { success: true, message: "Documento deletado com sucesso" };
    }),
});
