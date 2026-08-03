import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);

// Middleware para autenticação do admin local (email/senha + JWT cookie)
export const adminLocalProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.adminId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
    }

    const adminId = ctx.adminId as number;

    return next({
      ctx: {
        ...ctx,
        adminId,
      },
    });
  }),
);

// Middleware para autenticação do cliente (JWT cookie client_token)
export const protectedClientProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.clientId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Acesso negado. Faça login no portal do cliente." });
    }

    const clientId = ctx.clientId as number;

    return next({
      ctx: {
        ...ctx,
        clientId,
      },
    });
  }),
);

// Middleware para autenticação do técnico (JWT cookie technician_token)
export const protectedTechnicianProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.technicianId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Acesso negado. Faça login no portal do técnico." });
    }

    const technicianId = ctx.technicianId as number;

    return next({
      ctx: {
        ...ctx,
        technicianId,
      },
    });
  }),
);
