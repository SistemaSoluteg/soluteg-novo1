import * as db from "../db";
import { adminLocalProcedure, publicProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

// NOTA: duplicata funcional de adminDocumentsRouter (mesmos 3 endpoints em comum,
// mais updateFile, mesmas funções de db.ts). Nenhum dos dois parece ser chamado pelo
// frontend hoje (grep em src/ não achou uso de trpc.adminProfile.adminDocuments.* nem
// trpc.adminDocuments.*). Candidato à faxina — não removido agora para não misturar
// escopo com o isolamento.
const adminDocumentsSubRouter = router({
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

  updateFile: adminLocalProcedure // ISOLADO COM GUARDA
    .input(z.object({
      id: z.number(),
      fileUrl: z.string().url(),
    }))
    .mutation(async ({ input, ctx }) => {
      const doc = await db.getDocumentById(input.id);
      if (!doc || doc.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado" });
      }
      await db.updateDocumentFile(input.id, input.fileUrl);
      return { success: true, message: "Arquivo atualizado com sucesso" };
    }),
});

export const adminProfileRouter = router({
  getProfile: adminLocalProcedure
    .query(async ({ ctx }) => {
      const admin = await db.getAdminById(ctx.adminId);
      if (!admin) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Admin nao encontrado" });
      }
      return {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        phone: admin.phone,
        profilePhoto: admin.profilePhoto,
      };
    }),

  updateProfile: adminLocalProcedure
    .input(z.object({
      name: z.string().min(1).optional(),
      phone: z.string().optional(),
      profilePhoto: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await db.updateAdminProfile(ctx.adminId, input);
      return { success: true, message: "Perfil atualizado com sucesso" };
    }),

  adminDocuments: adminDocumentsSubRouter,
});
