import * as db from "../db";
import { adminLocalProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

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
});
