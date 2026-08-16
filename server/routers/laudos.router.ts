import { adminLocalProcedure, protectedTechnicianProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

// ── Helpers de isolamento por tenant (3.7.2, Método B) ────────────────────────
// Carrega o laudo e confirma que pertence ao tenant do chamador. Usado como
// guarda de posse em todo endpoint que recebe id/laudoId do input.
async function carregarLaudoDoTenant(laudoId: number, tenantId: number) {
  const ldb = await import("../laudosDb");
  const laudo = await ldb.getLaudoById(laudoId);
  if (!laudo || laudo.tenantId !== tenantId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Laudo não encontrado" });
  }
  return laudo;
}

// Valida FK clienteId vinda do input contra o tenant (evita referenciar PII de outro tenant).
async function assertClienteDoTenant(clienteId: number, tenantId: number) {
  const sdb = await import("../db");
  const cliente = await sdb.getClientById(clienteId);
  if (!cliente || cliente.tenantId !== tenantId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado" });
  }
}

// Valida FK tecnicoId vinda do input contra o tenant.
async function assertTecnicoDoTenant(tecnicoId: number, tenantId: number) {
  const tdb = await import("../technicianDb");
  const tecnico = await tdb.getTechnicianById(tecnicoId, tenantId);
  if (!tecnico) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Técnico não encontrado" });
  }
}

export const laudosRouter = router({
  // ── Listar laudos (admin: todos do tenant; técnico: só os seus) ────────────
  list: adminLocalProcedure
    .input(z.object({
      tipo: z.string().optional(),
      status: z.string().optional(),
      clienteId: z.number().optional(),
      search: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const db = await import("../laudosDb");
      return await db.listLaudos({ ...input, tenantId: ctx.tenantId });
    }),

  listTecnico: protectedTechnicianProcedure
    .input(z.object({
      tipo: z.string().optional(),
      status: z.string().optional(),
      search: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const db = await import("../laudosDb");
      return await db.listLaudos({
        ...input,
        tenantId: ctx.tenantId,
        tecnicoId: ctx.technicianId,
      });
    }),

  // ── Buscar por ID ──────────────────────────────────────────────────────────
  getById: adminLocalProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      return await carregarLaudoDoTenant(input.id, ctx.tenantId);
    }),

  getByIdTecnico: protectedTechnicianProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const laudo = await carregarLaudoDoTenant(input.id, ctx.tenantId);
      const foiCriadorDoLaudo = laudo.criadoPor === ctx.technicianId;
      const tecnicoAtribuido = laudo.tecnicos?.some((t: any) => t.tecnicoId === ctx.technicianId);
      if (!foiCriadorDoLaudo && !tecnicoAtribuido) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
      }
      return laudo;
    }),

  // ── Criar laudo ────────────────────────────────────────────────────────────
  create: adminLocalProcedure
    .input(z.object({
      tipo: z.enum(["instalacao_eletrica", "inspecao_predial", "nr10_nr12", "grupo_gerador", "adequacoes"]),
      titulo: z.string().min(1),
      clienteId: z.number().optional(),
      osId: z.number().optional(),
      normasReferencia: z.array(z.object({
        codigo: z.string(),
        titulo: z.string(),
      })).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.clienteId != null) await assertClienteDoTenant(input.clienteId, ctx.tenantId);
      const db = await import("../laudosDb");
      const result = await db.createLaudo({
        ...input,
        tenantId: ctx.tenantId,
        criadoPor: ctx.adminId,
        criadoPorTipo: "admin",
      });
      return { success: true, ...result };
    }),

  createTecnico: protectedTechnicianProcedure
    .input(z.object({
      tipo: z.enum(["instalacao_eletrica", "inspecao_predial", "nr10_nr12", "grupo_gerador", "adequacoes"]),
      titulo: z.string().min(1),
      clienteId: z.number().optional(),
      osId: z.number().optional(),
      normasReferencia: z.array(z.object({
        codigo: z.string(),
        titulo: z.string(),
      })).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.clienteId != null) await assertClienteDoTenant(input.clienteId, ctx.tenantId);
      const db = await import("../laudosDb");
      const result = await db.createLaudo({
        ...input,
        tenantId: ctx.tenantId,
        criadoPor: ctx.technicianId,
        criadoPorTipo: "tecnico",
      });
      // Auto-atribui o técnico ao laudo que ele mesmo criou
      await db.atribuirTecnico({ tenantId: ctx.tenantId, laudoId: result.id, tecnicoId: ctx.technicianId });
      return { success: true, ...result };
    }),

  // ── Atualizar laudo ────────────────────────────────────────────────────────
  update: adminLocalProcedure
    .input(z.object({
      id: z.number(),
      tipo: z.enum(["instalacao_eletrica", "inspecao_predial", "nr10_nr12", "grupo_gerador", "adequacoes"]).optional(),
      titulo: z.string().optional(),
      clienteId: z.number().nullable().optional(),
      osId: z.number().nullable().optional(),
      objeto: z.string().optional(),
      metodologia: z.string().optional(),
      equipamentosUtilizados: z.string().optional(),
      condicoesLocal: z.string().optional(),
      constatacoes: z.array(z.object({
        item: z.string(),
        descricao: z.string(),
        status: z.enum(["conforme", "nao_conforme", "atencao"]),
        referenciaNormativa: z.string().optional(),
      })).optional(),
      conclusaoParecer: z.enum(["conforme", "nao_conforme", "parcialmente_conforme"]).nullable().optional(),
      conclusaoTexto: z.string().optional(),
      recomendacoes: z.string().optional(),
      normasReferencia: z.array(z.object({
        codigo: z.string(),
        titulo: z.string(),
      })).optional(),
      validadeMeses: z.number().optional(),
      dataInspecao: z.string().nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await carregarLaudoDoTenant(input.id, ctx.tenantId);
      if (input.clienteId != null) await assertClienteDoTenant(input.clienteId, ctx.tenantId);
      const { id, dataInspecao, ...rest } = input;
      const db = await import("../laudosDb");
      await db.updateLaudo(id, {
        ...rest,
        dataInspecao: dataInspecao ? new Date(dataInspecao) : (dataInspecao === null ? null : undefined),
      } as any);
      return { success: true };
    }),

  updateTecnico: protectedTechnicianProcedure
    .input(z.object({
      id: z.number(),
      tipo: z.enum(["instalacao_eletrica", "inspecao_predial", "nr10_nr12", "grupo_gerador", "adequacoes"]).optional(),
      titulo: z.string().optional(),
      clienteId: z.number().nullable().optional(),
      osId: z.number().nullable().optional(),
      objeto: z.string().optional(),
      metodologia: z.string().optional(),
      equipamentosUtilizados: z.string().optional(),
      condicoesLocal: z.string().optional(),
      constatacoes: z.array(z.object({
        item: z.string(),
        descricao: z.string(),
        status: z.enum(["conforme", "nao_conforme", "atencao"]),
        referenciaNormativa: z.string().optional(),
      })).optional(),
      conclusaoParecer: z.enum(["conforme", "nao_conforme", "parcialmente_conforme"]).nullable().optional(),
      conclusaoTexto: z.string().optional(),
      recomendacoes: z.string().optional(),
      normasReferencia: z.array(z.object({
        codigo: z.string(),
        titulo: z.string(),
      })).optional(),
      validadeMeses: z.number().optional(),
      dataInspecao: z.string().nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await import("../laudosDb");
      const laudo = await carregarLaudoDoTenant(input.id, ctx.tenantId);
      const foiCriadorDoLaudo = laudo.criadoPor === ctx.technicianId;
      const tecnicoAtribuido = laudo.tecnicos?.some((t: any) => t.tecnicoId === ctx.technicianId);
      if (!foiCriadorDoLaudo && !tecnicoAtribuido) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
      }
      if (laudo.status !== "rascunho") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Laudo finalizado não pode ser editado" });
      }
      if (input.clienteId != null) await assertClienteDoTenant(input.clienteId, ctx.tenantId);
      const { id, dataInspecao, ...rest } = input;
      await db.updateLaudo(id, {
        ...rest,
        dataInspecao: dataInspecao ? new Date(dataInspecao) : (dataInspecao === null ? null : undefined),
      } as any);
      return { success: true };
    }),

  // ── Deletar laudo (somente rascunho, somente admin) ───────────────────────
  delete: adminLocalProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const laudo = await carregarLaudoDoTenant(input.id, ctx.tenantId);
      if (laudo.status !== "rascunho") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Apenas laudos em rascunho podem ser excluídos" });
      }
      const db = await import("../laudosDb");
      await db.deleteLaudo(input.id);
      return { success: true };
    }),

  // ── Finalizar laudo ────────────────────────────────────────────────────────
  finalize: adminLocalProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await carregarLaudoDoTenant(input.id, ctx.tenantId);
      const db = await import("../laudosDb");
      await db.updateLaudo(input.id, { status: "finalizado" } as any);
      return { success: true };
    }),

  // ── Fotos ──────────────────────────────────────────────────────────────────
  addFoto: adminLocalProcedure
    .input(z.object({
      laudoId: z.number(),
      url: z.string(),
      legenda: z.string().optional(),
      comentario: z.string().optional(),
      classificacao: z.enum(["conforme", "nao_conforme", "atencao"]).optional(),
      ordem: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await carregarLaudoDoTenant(input.laudoId, ctx.tenantId);
      const db = await import("../laudosDb");
      await db.addLaudoFoto({ ...input, tenantId: ctx.tenantId });
      return { success: true };
    }),

  addFotoTecnico: protectedTechnicianProcedure
    .input(z.object({
      laudoId: z.number(),
      url: z.string(),
      legenda: z.string().optional(),
      comentario: z.string().optional(),
      classificacao: z.enum(["conforme", "nao_conforme", "atencao"]).optional(),
      ordem: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await import("../laudosDb");
      const laudo = await carregarLaudoDoTenant(input.laudoId, ctx.tenantId);
      const foiCriadorDoLaudo = laudo.criadoPor === ctx.technicianId;
      const tecnicoAtribuido = laudo.tecnicos?.some((t: any) => t.tecnicoId === ctx.technicianId);
      if (!foiCriadorDoLaudo && !tecnicoAtribuido) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
      }
      await db.addLaudoFoto({ ...input, tenantId: ctx.tenantId });
      return { success: true };
    }),

  updateFoto: adminLocalProcedure
    .input(z.object({
      id: z.number(),
      legenda: z.string().optional(),
      comentario: z.string().optional(),
      classificacao: z.enum(["conforme", "nao_conforme", "atencao"]).optional(),
      ordem: z.number().optional(),
      // Campos do editor avançado (Etapa 3)
      urlAnotada: z.string().url().optional(),
      urlRecorte: z.string().url().optional(),
      modoLayout: z.enum(["normal", "destaque", "destaque_duplo", "original_zoom", "anotada"]).optional(),
      anotacoesJson: z.string().max(200000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const db = await import("../laudosDb");
      const foto = await db.getLaudoFotoById(id);
      if (!foto) throw new TRPCError({ code: "NOT_FOUND", message: "Foto não encontrada" });
      await carregarLaudoDoTenant(foto.laudoId, ctx.tenantId);
      await db.updateLaudoFoto(id, data as any);
      return { success: true };
    }),

  updateFotoTecnico: protectedTechnicianProcedure
    .input(z.object({
      id: z.number(),
      legenda: z.string().optional(),
      comentario: z.string().optional(),
      classificacao: z.enum(["conforme", "nao_conforme", "atencao"]).optional(),
      ordem: z.number().optional(),
      // Campos do editor avançado (Etapa 3)
      urlAnotada: z.string().url().optional(),
      urlRecorte: z.string().url().optional(),
      modoLayout: z.enum(["normal", "destaque", "destaque_duplo", "original_zoom", "anotada"]).optional(),
      anotacoesJson: z.string().max(200000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const db = await import("../laudosDb");
      const foto = await db.getLaudoFotoById(id);
      if (!foto) throw new TRPCError({ code: "NOT_FOUND", message: "Foto não encontrada" });
      const laudo = await carregarLaudoDoTenant(foto.laudoId, ctx.tenantId);
      const foiCriadorDoLaudo = laudo.criadoPor === ctx.technicianId;
      const tecnicoAtribuido = laudo.tecnicos?.some((t: any) => t.tecnicoId === ctx.technicianId);
      if (!foiCriadorDoLaudo && !tecnicoAtribuido) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
      }
      await db.updateLaudoFoto(id, data as any);
      return { success: true };
    }),

  removeFoto: adminLocalProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await import("../laudosDb");
      const foto = await db.getLaudoFotoById(input.id);
      if (!foto) throw new TRPCError({ code: "NOT_FOUND", message: "Foto não encontrada" });
      await carregarLaudoDoTenant(foto.laudoId, ctx.tenantId);
      await db.removeLaudoFoto(input.id);
      return { success: true };
    }),

  // ── Medições ───────────────────────────────────────────────────────────────
  addMedicao: adminLocalProcedure
    .input(z.object({
      laudoId: z.number(),
      descricao: z.string().min(1),
      unidade: z.string().optional(),
      valorMedido: z.string().optional(),
      valorReferencia: z.string().optional(),
      resultado: z.enum(["aprovado", "reprovado"]).optional(),
      ordem: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await carregarLaudoDoTenant(input.laudoId, ctx.tenantId);
      const db = await import("../laudosDb");
      await db.addLaudoMedicao({ ...input, tenantId: ctx.tenantId });
      return { success: true };
    }),

  removeMedicao: adminLocalProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await import("../laudosDb");
      const medicao = await db.getLaudoMedicaoById(input.id);
      if (!medicao) throw new TRPCError({ code: "NOT_FOUND", message: "Medição não encontrada" });
      await carregarLaudoDoTenant(medicao.laudoId, ctx.tenantId);
      await db.removeLaudoMedicao(input.id);
      return { success: true };
    }),

  // ── Técnicos atribuídos ────────────────────────────────────────────────────
  atribuirTecnico: adminLocalProcedure
    .input(z.object({
      laudoId: z.number(),
      tecnicoId: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      await carregarLaudoDoTenant(input.laudoId, ctx.tenantId);
      await assertTecnicoDoTenant(input.tecnicoId, ctx.tenantId);
      const db = await import("../laudosDb");
      await db.atribuirTecnico({ tenantId: ctx.tenantId, laudoId: input.laudoId, tecnicoId: input.tecnicoId, atribuidoPor: ctx.adminId });
      return { success: true };
    }),

  removerTecnico: adminLocalProcedure
    .input(z.object({
      laudoId: z.number(),
      tecnicoId: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      await carregarLaudoDoTenant(input.laudoId, ctx.tenantId);
      const db = await import("../laudosDb");
      await db.removerTecnico(input.laudoId, input.tecnicoId);
      return { success: true };
    }),

  // ── Gerar PDF ──────────────────────────────────────────────────────────────
  generatePdf: adminLocalProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const laudo = await carregarLaudoDoTenant(input.id, ctx.tenantId);
      const { generateLaudoPDF } = await import("../pdfLaudo");
      const pdfBuffer = await generateLaudoPDF(input.id);
      return {
        success: true,
        pdf: pdfBuffer.toString("base64"),
        filename: `${laudo?.numero ?? `LAU-${input.id}`}.pdf`,
      };
    }),

  // ── Tipos de laudo dinâmicos ──────────────────────────────────────────────
  // GLOBAL POR DESIGN: laudoTipos é catálogo compartilhado (sem tenantId).

  // Admin: lista todos os tipos ativos ordenados por `ordem`
  "tiposLaudo.list": adminLocalProcedure
    .query(async () => {
      const db = await import("../laudosDb");
      return await db.listLaudoTipos();
    }),

  // Técnico: mesma listagem com protectedTechnicianProcedure
  "tiposLaudo.listTecnico": protectedTechnicianProcedure
    .query(async () => {
      const db = await import("../laudosDb");
      return await db.listLaudoTipos();
    }),

  // ── Biblioteca de normas ──────────────────────────────────────────────────
  // GLOBAL POR DESIGN: normasBiblioteca é catálogo compartilhado (sem tenantId).
  listNormasBiblioteca: adminLocalProcedure
    .input(z.object({ tipoLaudo: z.string().optional() }))
    .query(async ({ input }) => {
      const db = await import("../laudosDb");
      return await db.listNormasBiblioteca(input.tipoLaudo);
    }),

  listNormasBibliotecaTecnico: protectedTechnicianProcedure
    .input(z.object({ tipoLaudo: z.string().optional() }))
    .query(async ({ input }) => {
      const db = await import("../laudosDb");
      return await db.listNormasBiblioteca(input.tipoLaudo);
    }),

  // ── Trechos normativos (busca e listagem por norma) ───────────────────────
  // GLOBAL POR DESIGN: normaTrechos/normasBiblioteca são catálogo compartilhado.

  // Admin: busca trechos por palavra-chave em todas as normas
  "normasTrechos.search": adminLocalProcedure
    .input(z.object({
      busca: z.string().min(2),
      tipoLaudo: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const db = await import("../laudosDb");
      return await db.searchNormaTrechos(input);
    }),

  // Admin: lista todos os trechos de uma norma específica
  "normasTrechos.listByNorma": adminLocalProcedure
    .input(z.object({ normaId: z.number() }))
    .query(async ({ input }) => {
      const db = await import("../laudosDb");
      return await db.listNormaTrechos(input.normaId);
    }),

  // Técnico: mesmas queries com protectedTechnicianProcedure
  "normasTrechosTecnico.search": protectedTechnicianProcedure
    .input(z.object({
      busca: z.string().min(2),
      tipoLaudo: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const db = await import("../laudosDb");
      return await db.searchNormaTrechos(input);
    }),

  "normasTrechosTecnico.listByNorma": protectedTechnicianProcedure
    .input(z.object({ normaId: z.number() }))
    .query(async ({ input }) => {
      const db = await import("../laudosDb");
      return await db.listNormaTrechos(input.normaId);
    }),

  // ── Citações normativas do laudo ──────────────────────────────────────────

  // Admin: adiciona uma citação (da biblioteca ou manual)
  "citacoes.add": adminLocalProcedure
    .input(z.object({
      laudoId: z.number(),
      trechoId: z.number().optional(),
      normaCodigo: z.string().min(1),
      numeroItem: z.string().min(1),
      tituloItem: z.string().min(1),
      textoCitado: z.string().min(1),
      aplicacao: z.string().optional(),
      ordem: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await carregarLaudoDoTenant(input.laudoId, ctx.tenantId);
      const db = await import("../laudosDb");
      const nova = await db.addLaudoCitacao({ ...input, tenantId: ctx.tenantId });
      return { success: true, citacao: nova };
    }),

  // Admin: atualiza texto ou aplicação de uma citação
  "citacoes.update": adminLocalProcedure
    .input(z.object({
      id: z.number(),
      textoCitado: z.string().optional(),
      aplicacao: z.string().optional(),
      ordem: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const db = await import("../laudosDb");
      const citacao = await db.getLaudoCitacaoById(id);
      if (!citacao) throw new TRPCError({ code: "NOT_FOUND", message: "Citação não encontrada" });
      await carregarLaudoDoTenant(citacao.laudoId, ctx.tenantId);
      await db.updateLaudoCitacao(id, data);
      return { success: true };
    }),

  // Admin: remove uma citação
  "citacoes.remove": adminLocalProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await import("../laudosDb");
      const citacao = await db.getLaudoCitacaoById(input.id);
      if (!citacao) throw new TRPCError({ code: "NOT_FOUND", message: "Citação não encontrada" });
      await carregarLaudoDoTenant(citacao.laudoId, ctx.tenantId);
      await db.removeLaudoCitacao(input.id);
      return { success: true };
    }),

  // Técnico: mesmas mutations com ownership check do laudo
  "citacoesTecnico.add": protectedTechnicianProcedure
    .input(z.object({
      laudoId: z.number(),
      trechoId: z.number().optional(),
      normaCodigo: z.string().min(1),
      numeroItem: z.string().min(1),
      tituloItem: z.string().min(1),
      textoCitado: z.string().min(1),
      aplicacao: z.string().optional(),
      ordem: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await import("../laudosDb");
      const laudo = await carregarLaudoDoTenant(input.laudoId, ctx.tenantId);
      // criadoPorTipo garante que não confunde ID de admin com ID de técnico (tabelas independentes)
      const foiCriador = laudo.criadoPor === ctx.technicianId && laudo.criadoPorTipo === "tecnico";
      const atribuido = laudo.tecnicos?.some((t: any) => t.tecnicoId === ctx.technicianId);
      if (!foiCriador && !atribuido) throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
      const nova = await db.addLaudoCitacao({ ...input, tenantId: ctx.tenantId });
      return { success: true, citacao: nova };
    }),

  "citacoesTecnico.update": protectedTechnicianProcedure
    .input(z.object({
      id: z.number(),
      textoCitado: z.string().optional(),
      aplicacao: z.string().optional(),
      ordem: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const db = await import("../laudosDb");

      const citacao = await db.getLaudoCitacaoById(id);
      if (!citacao) throw new TRPCError({ code: "NOT_FOUND", message: "Citação não encontrada" });

      const laudo = await carregarLaudoDoTenant(citacao.laudoId, ctx.tenantId);

      // criadoPorTipo garante que não confunde ID de admin com ID de técnico (tabelas independentes)
      const foiCriador = laudo.criadoPor === ctx.technicianId && laudo.criadoPorTipo === "tecnico";
      const atribuido  = laudo.tecnicos?.some((t: any) => t.tecnicoId === ctx.technicianId);
      if (!foiCriador && !atribuido) throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });

      await db.updateLaudoCitacao(id, data);
      return { success: true };
    }),

  "citacoesTecnico.remove": protectedTechnicianProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await import("../laudosDb");

      const citacao = await db.getLaudoCitacaoById(input.id);
      if (!citacao) throw new TRPCError({ code: "NOT_FOUND", message: "Citação não encontrada" });

      const laudo = await carregarLaudoDoTenant(citacao.laudoId, ctx.tenantId);

      // criadoPorTipo garante que não confunde ID de admin com ID de técnico (tabelas independentes)
      const foiCriador = laudo.criadoPor === ctx.technicianId && laudo.criadoPorTipo === "tecnico";
      const atribuido  = laudo.tecnicos?.some((t: any) => t.tecnicoId === ctx.technicianId);
      if (!foiCriador && !atribuido) throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });

      await db.removeLaudoCitacao(input.id);
      return { success: true };
    }),

  // ── IA: sugerir normas aplicáveis ─────────────────────────────────────────

  // Admin: analisa o laudo e sugere trechos normativos relevantes via Claude API
  "ia.sugerirNormas": adminLocalProcedure
    .input(z.object({ laudoId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await carregarLaudoDoTenant(input.laudoId, ctx.tenantId);
      const ia = await import("../iaLaudos");
      const sugestoes = await ia.sugerirNormasIA(input.laudoId);
      return { success: true, sugestoes };
    }),

  // Admin: gera sugestão de conclusão, parecer e recomendações via Claude API
  "ia.sugerirConclusao": adminLocalProcedure
    .input(z.object({ laudoId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await carregarLaudoDoTenant(input.laudoId, ctx.tenantId);
      const ia = await import("../iaLaudos");
      const sugestao = await ia.sugerirConclusaoIA(input.laudoId);
      return { success: true, sugestao };
    }),

  // Técnico: mesmas procedures com verificação de acesso ao laudo
  "iaTecnico.sugerirNormas": protectedTechnicianProcedure
    .input(z.object({ laudoId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const laudo = await carregarLaudoDoTenant(input.laudoId, ctx.tenantId);
      // criadoPorTipo garante que não confunde ID de admin com ID de técnico (tabelas independentes)
      const foiCriador = laudo.criadoPor === ctx.technicianId && laudo.criadoPorTipo === "tecnico";
      const atribuido  = laudo.tecnicos?.some((t: any) => t.tecnicoId === ctx.technicianId);
      if (!foiCriador && !atribuido) throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
      const ia = await import("../iaLaudos");
      const sugestoes = await ia.sugerirNormasIA(input.laudoId);
      return { success: true, sugestoes };
    }),

  "iaTecnico.sugerirConclusao": protectedTechnicianProcedure
    .input(z.object({ laudoId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const laudo = await carregarLaudoDoTenant(input.laudoId, ctx.tenantId);
      // criadoPorTipo garante que não confunde ID de admin com ID de técnico (tabelas independentes)
      const foiCriador = laudo.criadoPor === ctx.technicianId && laudo.criadoPorTipo === "tecnico";
      const atribuido  = laudo.tecnicos?.some((t: any) => t.tecnicoId === ctx.technicianId);
      if (!foiCriador && !atribuido) throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
      const ia = await import("../iaLaudos");
      const sugestao = await ia.sugerirConclusaoIA(input.laudoId);
      return { success: true, sugestao };
    }),

  // ── Envio por WhatsApp ─────────────────────────────────────────────────────

  // Admin: gera PDF do laudo e envia via WhatsApp para o número informado
  enviarWhatsapp: adminLocalProcedure
    .input(z.object({
      laudoId: z.number(),
      telefone: z.string().min(8),
      mensagem: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const laudo = await carregarLaudoDoTenant(input.laudoId, ctx.tenantId);
      if (laudo.status !== "finalizado") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Apenas laudos finalizados podem ser enviados" });
      }

      const { generateLaudoPDF } = await import("../pdfLaudo");
      const db = await import("../laudosDb");
      const wa = await import("../whatsapp");

      // Gera o PDF em memória (Buffer)
      const pdfBuffer = await generateLaudoPDF(input.laudoId);
      const filename  = `${laudo.numero ?? `LAU-${input.laudoId}`}.pdf`;

      const mensagem = input.mensagem?.trim() ||
        `Olá! Segue o laudo técnico *${laudo.numero}* — ${laudo.titulo}.\nEm caso de dúvidas, entre em contato conosco.`;

      // Envia via WhatsApp (usa a função existente que suporta PDF)
      await wa.sendWhatsappToNumberWithPDF(input.telefone, mensagem, pdfBuffer, filename);

      // Atualiza status para "enviado"
      await db.updateLaudo(input.laudoId, { status: "enviado" } as any);

      return { success: true };
    }),

  // ── Configurações do Técnico (por tenant) ─────────────────────────────────
  getTecnico: adminLocalProcedure
    .query(async ({ ctx }) => {
      const db = await import("../laudosDb");
      return await db.getConfiguracoesTecnico(ctx.tenantId);
    }),

  updateTecnicoConfig: adminLocalProcedure
    .input(z.object({
      nomeCompleto: z.string().optional(),
      registroCrt: z.string().optional(),
      especialidade: z.string().optional(),
      empresa: z.string().optional(),
      cidade: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await import("../laudosDb");
      await db.upsertConfiguracoesTecnico(ctx.tenantId, input);
      return { success: true };
    }),
});
