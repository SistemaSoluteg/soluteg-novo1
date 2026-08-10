import { adminLocalProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { hashPassword } from "../adminAuth";
import * as technicianDb from "../technicianDb";

export const techniciansRouter = router({
  list: adminLocalProcedure
    .query(async ({ ctx }) => {
      return await technicianDb.getTechniciansByTenant(ctx.tenantId);
    }),

  getById: adminLocalProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const t = await technicianDb.getTechnicianById(input.id, ctx.tenantId);
      if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "Técnico não encontrado" });
      const { password: _pw, ...rest } = t;
      return rest;
    }),

  create: adminLocalProcedure
    .input(z.object({
      name:           z.string().min(1),
      email:          z.string().email().optional().or(z.literal("")),
      username:       z.string().min(3),
      password:       z.string().min(6),
      cpf:            z.string().optional(),
      phone:          z.string().optional(),
      specialization: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const existing = await technicianDb.getTechnicianByUsername(input.username);
      if (existing) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Nome de usuário já está em uso" });
      }
      const hashedPw = await hashPassword(input.password);
      await technicianDb.createTechnician(
        {
          adminId:        ctx.adminId,
          name:           input.name,
          email:          input.email || null,
          username:       input.username,
          password:       hashedPw,
          cpf:            input.cpf || null,
          phone:          input.phone || null,
          specialization: input.specialization || null,
          active:         1,
        },
        ctx.tenantId,
      );
      return { success: true, message: "Técnico criado com sucesso" };
    }),

  update: adminLocalProcedure
    .input(z.object({
      id:             z.number(),
      name:           z.string().optional(),
      email:          z.union([z.string().email(), z.literal("")]).optional(),
      cpf:            z.string().optional(),
      phone:          z.string().optional(),
      specialization: z.string().optional(),
      active:         z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      await technicianDb.updateTechnician(id, data, ctx.tenantId);
      return { success: true, message: "Técnico atualizado com sucesso" };
    }),

  updatePassword: adminLocalProcedure
    .input(z.object({ id: z.number(), newPassword: z.string().min(6) }))
    .mutation(async ({ input, ctx }) => {
      const hashedPw = await hashPassword(input.newPassword);
      await technicianDb.updateTechnicianPassword(input.id, hashedPw, ctx.tenantId);
      return { success: true, message: "Senha atualizada com sucesso" };
    }),

  delete: adminLocalProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await technicianDb.deleteTechnician(input.id, ctx.tenantId);
      return { success: true, message: "Técnico removido com sucesso" };
    }),
});
