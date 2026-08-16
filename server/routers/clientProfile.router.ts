import * as db from "../db";
import { adminLocalProcedure, protectedClientProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { hashPassword, comparePassword } from "../adminAuth";

export const clientProfileRouter = router({
  getProfile: protectedClientProcedure
    .query(async ({ ctx }) => {
      const client = await db.getClientById(ctx.clientId);
      if (!client) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Cliente nao encontrado" });
      }
      return {
        id: client.id,
        name: client.name,
        email: client.email,
        phone: client.phone,
        cnpjCpf: client.cnpjCpf,
        address: client.address,
        syndicName: client.syndicName,
        profilePhoto: client.profilePhoto,
        username: client.username,
      };
    }),

  // Atualizar foto de qualquer cliente — somente admin (ex: página EditClient).
  // clientId deve ser informado no input pois o admin está editando outro usuário.
  uploadPhoto: adminLocalProcedure
    .input(z.object({
      clientId: z.number(),
      imageBase64: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Guarda de posse (Método B): admin só pode alterar foto de cliente do próprio tenant.
      // Sem isso, admin do tenant A sobrescreve foto e clobra o storage client_photo_${id} do tenant B.
      const alvo = await db.getClientById(input.clientId);
      if (!alvo || alvo.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado" });
      }
      const { storagePut } = await import("../storage");
      const base64Data = input.imageBase64.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      if (buffer.length > 5 * 1024 * 1024) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Imagem muito grande. Máximo 5MB." });
      }
      const mimeMatch = input.imageBase64.match(/^data:(image\/[\w+]+);base64,/);
      const contentType = mimeMatch ? mimeMatch[1] : "image/jpeg";
      const { url } = await storagePut(`client_photo_${input.clientId}`, buffer, contentType, "client_photos");
      await db.updateClient(input.clientId, { profilePhoto: url } as any);
      return { success: true, photoUrl: url };
    }),

  // Atualizar a própria foto — cliente autenticado. clientId vem do JWT (ctx), não do input.
  uploadMyPhoto: protectedClientProcedure
    .input(z.object({ imageBase64: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { storagePut } = await import("../storage");
      const base64Data = input.imageBase64.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      if (buffer.length > 5 * 1024 * 1024) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Imagem muito grande. Máximo 5MB." });
      }
      const mimeMatch = input.imageBase64.match(/^data:(image\/[\w+]+);base64,/);
      const contentType = mimeMatch ? mimeMatch[1] : "image/jpeg";
      const { url } = await storagePut(`client_photo_${ctx.clientId}`, buffer, contentType, "client_photos");
      await db.updateClient(ctx.clientId, { profilePhoto: url } as any);
      return { success: true, photoUrl: url };
    }),

  updateProfile: protectedClientProcedure
    .input(z.object({
      name: z.string().min(1).optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      syndicName: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await db.updateClient(ctx.clientId, input);
      return { success: true, message: "Perfil atualizado com sucesso" };
    }),

  changePassword: protectedClientProcedure
    .input(z.object({
      currentPassword: z.string(),
      newPassword: z.string().min(6),
    }))
    .mutation(async ({ input, ctx }) => {
      const client = await db.getClientById(ctx.clientId);
      if (!client) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Cliente nao encontrado" });
      }
      const isPasswordValid = await comparePassword(input.currentPassword, client.password);
      if (!isPasswordValid) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Senha atual invalida" });
      }
      const hashedPassword = await hashPassword(input.newPassword);
      await db.updateClientPassword(ctx.clientId, hashedPassword);
      return { success: true, message: "Senha alterada com sucesso" };
    }),
});
