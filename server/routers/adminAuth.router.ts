/**
 * adminAuth.router.ts
 *
 * Este arquivo define as rotas (endpoints) de autenticação do painel admin.
 * No tRPC, cada "procedure" equivale a um endpoint de API.
 * "mutation" é usado para operações que MODIFICAM dados (como login, logout, trocar senha).
 * "query" seria usado para operações que apenas LEEM dados.
 */

// Importa todas as funções do banco de dados (ex: buscar admin, salvar token de reset, etc.)
import * as db from "../db";

// Função que monta as opções do cookie de sessão (ex: seguro, httpOnly, etc.)
import { getSessionCookieOptions } from "../_core/cookies";

// "publicProcedure" = endpoint acessível sem autenticação | "router" = agrupa os endpoints
import { adminLocalProcedure, publicProcedure, router } from "../_core/trpc";

// Zod é uma biblioteca de validação de dados — garante que os dados recebidos são do tipo certo
import { z } from "zod";

// TRPCError é a forma padrão de lançar erros dentro do tRPC com um código HTTP correspondente
import { TRPCError } from "@trpc/server";

// Módulo nativo do Node.js para gerar bytes aleatórios (usado no token de reset de senha)
import crypto from "crypto";

// Funções auxiliares de autenticação: verificar credenciais, gerar hash e comparar senhas
import { authenticateAdmin, hashPassword, verifyPassword } from "../adminAuth";

// Armazena tokens de reset de senha em memória: token → { adminId, expiresAt }
// Simples e funcional para sistema single-instance. Tokens são perdidos ao reiniciar o servidor.
const passwordResetTokens = new Map<string, { adminId: number; expiresAt: Date }>();

export const adminAuthRouter = router({

  // ──────────────────────────────────────────────
  // ME — retorna dados do admin autenticado via cookie
  // ──────────────────────────────────────────────
  me: adminLocalProcedure.query(async ({ ctx }) => {
    const admin = await db.getAdminById(ctx.adminId);
    if (!admin) throw new TRPCError({ code: "UNAUTHORIZED", message: "Admin não encontrado" });
    const { password: _pw, ...rest } = admin;
    return rest;
  }),

  // ──────────────────────────────────────────────
  // LOGIN
  // Recebe usuário e senha, verifica as credenciais e salva um cookie de sessão no navegador.
  // ──────────────────────────────────────────────
  login: publicProcedure
    .input(z.object({
      username: z.string().min(1), // nome de usuário obrigatório
      password: z.string().min(1), // senha obrigatória
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        // Chama a função que verifica usuário e senha no banco e retorna um token JWT
        const result = await authenticateAdmin(input.username, input.password);

        // Obtém as configurações do cookie (segurança, domínio, etc.) com base na requisição
        const cookieOptions = getSessionCookieOptions(ctx.req);

        // Define o cookie "admin_token" com maxAge explícito (7 dias em ms).
        // Sem maxAge o cookie seria do tipo "session" e seria apagado pelo browser
        // em hibernação, crash de aba ou GC agressivo — causando logout espontâneo no PDV.
        ctx.res.cookie('admin_token', result.token, {
          ...cookieOptions,
          maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        return result;
      } catch (error) {
        // Se as credenciais estiverem erradas, lança um erro 401 (não autorizado)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: error instanceof Error ? error.message : "Login failed",
        });
      }
    }),

  // ──────────────────────────────────────────────
  // LOGOUT
  // Remove o cookie de sessão do navegador, efetivamente deslogando o admin.
  // ──────────────────────────────────────────────
  logout: publicProcedure.mutation(({ ctx }) => {
    const cookieOptions = getSessionCookieOptions(ctx.req);

    // "maxAge: -1" força o navegador a apagar o cookie imediatamente
    ctx.res.clearCookie('admin_token', { ...cookieOptions, maxAge: -1 });

    return { success: true };
  }),

  // ──────────────────────────────────────────────
  // SOLICITAR RESET DE SENHA
  // O admin informa o e-mail e o sistema gera um token temporário para redefinição.
  // Resposta sempre genérica — não revela se o e-mail existe no sistema (evita user enumeration).
  // ──────────────────────────────────────────────
  requestReset: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ input }) => {
      const admin = await db.getAdminByEmail(input.email);

      // Mesmo que o e-mail não exista, retornamos a mesma mensagem genérica.
      // Isso evita que um atacante descubra quais e-mails estão cadastrados no sistema.
      if (!admin) {
        return { success: true, message: "Se o e-mail estiver cadastrado, você receberá o link de reset." };
      }

      // Gera um token aleatório de 32 bytes (64 caracteres hex) — difícil de adivinhar
      const resetToken = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // expira em 1 hora

      // Armazena o token em memória — mapeado para o e-mail e a expiração
      // (Na versão atual não há tabela de resets no banco; token é perdido ao reiniciar o servidor)
      passwordResetTokens.set(resetToken, { adminId: admin.id, expiresAt });

      console.log(`[Reset de senha] Token gerado para ${input.email}: ${resetToken}`);

      return { success: true, message: "Se o e-mail estiver cadastrado, você receberá o link de reset." };
    }),

  // ──────────────────────────────────────────────
  // REDEFINIR SENHA
  // Recebe o token de reset e a nova senha. Valida o token antes de atualizar.
  // ──────────────────────────────────────────────
  resetPassword: publicProcedure
    .input(z.object({
      token: z.string().min(64),   // token gerado em requestReset (64 chars hex)
      password: z.string().min(6), // nova senha com mínimo de 6 caracteres
    }))
    .mutation(async ({ input }) => {
      const entry = passwordResetTokens.get(input.token);

      // Rejeitar se o token não existe ou já expirou
      if (!entry || entry.expiresAt < new Date()) {
        passwordResetTokens.delete(input.token); // limpar token expirado se existir
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Token inválido ou expirado" });
      }

      const hashedPassword = await hashPassword(input.password);

      // Atualiza a senha do admin correto (determinado pelo token, não fixo no ID 1)
      await db.updateAdminPassword(entry.adminId, hashedPassword);

      // Remove o token após uso — não pode ser reutilizado
      passwordResetTokens.delete(input.token);

      return { success: true, message: "Senha redefinida com sucesso" };
    }),

  // ──────────────────────────────────────────────
  // TROCAR SENHA (estando logado)
  // O admin informa a senha atual e a nova senha. Valida a atual antes de trocar.
  // ──────────────────────────────────────────────
  changePassword: adminLocalProcedure
    .input(z.object({
      currentPassword: z.string().min(6),
      newPassword: z.string().min(6),
    }))
    .mutation(async ({ input, ctx }) => {
      const admin = await db.getAdminById(ctx.adminId);

      if (!admin) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Admin nao encontrado" });
      }

      const isBcryptHash = admin.password.startsWith("$2b$") || admin.password.startsWith("$2a$");
      const isValid = isBcryptHash
        ? await verifyPassword(input.currentPassword, admin.password)
        : input.currentPassword === admin.password;

      if (!isValid) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Senha atual incorreta" });
      }

      const hashedPassword = await hashPassword(input.newPassword);
      await db.updateAdminPassword(ctx.adminId, hashedPassword);

      return { success: true, message: "Senha alterada com sucesso" };
    }),

  // ──────────────────────────────────────────────
  // ATUALIZAR LABEL CUSTOMIZADO
  // Permite ao admin definir um apelido/rótulo personalizado para sua conta.
  // ──────────────────────────────────────────────
  updateCustomLabel: adminLocalProcedure
    .input(z.object({
      customLabel: z.string().min(1).max(255),
    }))
    .mutation(async ({ input, ctx }) => {
      await db.updateAdminCustomLabel(ctx.adminId, input.customLabel);
      return { success: true, message: "Label customizado atualizado com sucesso" };
    }),
});
