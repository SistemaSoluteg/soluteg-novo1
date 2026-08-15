/**
 * checklists.router.ts
 *
 * Endpoints para gerenciamento de checklists das Ordens de Serviço.
 * Todos os endpoints exigem autenticação de admin (adminLocalProcedure).
 *
 * Estrutura:
 *   - templates.*      → modelos de checklist reutilizáveis (ex: "Checklist Bomba de Recalque")
 *   - inspectionTasks.*→ tarefas de inspeção ligadas a uma OS (agrupa instâncias de checklist)
 *   - instances.*      → instâncias preenchidas de um template para uma tarefa específica
 *
 * ISOLAMENTO (3.7.2, router 5/N): inspectionTasks e checklistInstances têm tenantId
 * e usam Método B (guarda no router, comparando com ctx.tenantId). checklistTemplates
 * NÃO tem tenantId — é catálogo global (ver bloco "templates" abaixo).
 */

import { adminLocalProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

export const checklistsRouter = router({

  // ──────────────────────────────────────────────
  // TEMPLATES — modelos de checklist cadastrados no sistema
  // GLOBAL POR DESIGN: checklistTemplates não tem coluna tenantId — é catálogo
  // compartilhado entre todos os tenants (ex: "bomba", "gerador"). NÃO adicionar
  // guarda de tenant aqui.
  // ──────────────────────────────────────────────
  templates: router({

    // Lista todos os templates disponíveis
    list: adminLocalProcedure.query(async () => {
      const checklistDb = await import("../checklistsDb");
      return await checklistDb.getAllTemplates();
    }),

    // Busca um template específico pelo ID numérico
    getById: adminLocalProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const checklistDb = await import("../checklistsDb");
        return await checklistDb.getTemplateById(input.id);
      }),

    // Busca um template pelo slug (identificador textual, ex: "bomba-recalque")
    getBySlug: adminLocalProcedure
      .input(z.object({ slug: z.string() }))
      .query(async ({ input }) => {
        const checklistDb = await import("../checklistsDb");
        return await checklistDb.getTemplateBySlug(input.slug);
      }),
  }),

  // ──────────────────────────────────────────────
  // INSPECTION TASKS — tarefas de inspeção ligadas a uma OS
  // Cada tarefa pode ter múltiplas instâncias de checklist preenchidas
  // ──────────────────────────────────────────────
  inspectionTasks: router({

    // Lista todas as tarefas de inspeção de uma OS específica
    listByWorkOrder: adminLocalProcedure // ISOLADO COM GUARDA
      .input(z.object({ workOrderId: z.number() }))
      .query(async ({ input, ctx }) => {
        const workOrdersDb = await import("../workOrdersDb");
        const checklistDb = await import("../checklistsDb");

        // GUARDA: a OS (dona das tarefas) precisa pertencer ao tenant do admin logado.
        const os = await workOrdersDb.getWorkOrderById(input.workOrderId);
        if (!os || os.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "OS não encontrada" });
        }

        return await checklistDb.getInspectionTasksByWorkOrder(input.workOrderId);
      }),

    // Busca uma tarefa pelo ID
    getById: adminLocalProcedure // ISOLADO COM GUARDA
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        const checklistDb = await import("../checklistsDb");
        const task = await checklistDb.getInspectionTaskById(input.id);
        if (!task || task.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tarefa de inspeção não encontrada" });
        }
        return task;
      }),

    // Busca tarefa com todos os detalhes (instâncias de checklist incluídas)
    getFull: adminLocalProcedure // ISOLADO COM GUARDA
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        const checklistDb = await import("../checklistsDb");
        const task = await checklistDb.getInspectionTaskById(input.id);
        if (!task || task.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tarefa de inspeção não encontrada" });
        }
        return await checklistDb.getFullInspectionTask(input.id);
      }),

    // Cria uma nova tarefa de inspeção para uma OS
    create: adminLocalProcedure // ISOLADO COM GUARDA
      .input(z.object({
        workOrderId: z.number(),
        title: z.string().min(1),
        description: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const workOrdersDb = await import("../workOrdersDb");
        const checklistDb = await import("../checklistsDb");

        // GUARDA: a OS (dona da tarefa) precisa pertencer ao tenant do admin logado.
        const os = await workOrdersDb.getWorkOrderById(input.workOrderId);
        if (!os || os.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "OS não encontrada" });
        }

        const id = await checklistDb.createInspectionTask({ ...input, tenantId: ctx.tenantId });
        return { success: true, id, message: "Tarefa de inspeção criada com sucesso" };
      }),

    // Atualiza o status de andamento de uma tarefa (pendente / em_andamento / concluida)
    updateStatus: adminLocalProcedure // ISOLADO COM GUARDA
      .input(z.object({
        id: z.number(),
        status: z.enum(["pendente", "em_andamento", "concluida"]),
      }))
      .mutation(async ({ input, ctx }) => {
        const checklistDb = await import("../checklistsDb");

        const task = await checklistDb.getInspectionTaskById(input.id);
        if (!task || task.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tarefa de inspeção não encontrada" });
        }

        await checklistDb.updateInspectionTaskStatus(input.id, input.status);
        return { success: true, message: "Status atualizado com sucesso" };
      }),

    // Remove uma tarefa de inspeção (e suas instâncias de checklist)
    delete: adminLocalProcedure // ISOLADO COM GUARDA
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const checklistDb = await import("../checklistsDb");

        const task = await checklistDb.getInspectionTaskById(input.id);
        if (!task || task.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tarefa de inspeção não encontrada" });
        }

        await checklistDb.deleteInspectionTask(input.id);
        return { success: true, message: "Tarefa deletada com sucesso" };
      }),

    // Verifica se uma tarefa pode ser concluída (todos checklists preenchidos)
    canComplete: adminLocalProcedure
      .input(z.object({ id: z.number() }))
      .query(async () => {
        return true;
      }),
  }),

  // ──────────────────────────────────────────────
  // INSTANCES — instâncias preenchidas de um template
  // Cada instância representa um equipamento específico sendo inspecionado
  // (ex: "Bomba de Recalque P1 — andar 5")
  // ──────────────────────────────────────────────
  instances: router({

    // Lista instâncias de uma tarefa de inspeção específica
    listByTask: adminLocalProcedure // ISOLADO COM GUARDA
      .input(z.object({ inspectionTaskId: z.number() }))
      .query(async ({ input, ctx }) => {
        const checklistDb = await import("../checklistsDb");

        // GUARDA: a tarefa pai precisa pertencer ao tenant do admin logado.
        const task = await checklistDb.getInspectionTaskById(input.inspectionTaskId);
        if (!task || task.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tarefa de inspeção não encontrada" });
        }

        return await checklistDb.getChecklistsByInspectionTask(input.inspectionTaskId);
      }),

    // Lista instâncias de todos os checklists de uma OS (usado no portal do técnico)
    listByWorkOrder: adminLocalProcedure // ISOLADO COM GUARDA
      .input(z.object({ workOrderId: z.number() }))
      .query(async ({ input, ctx }) => {
        const workOrdersDb = await import("../workOrdersDb");
        const checklistDb = await import("../checklistsDb");

        // GUARDA: a OS precisa pertencer ao tenant do admin logado.
        const os = await workOrdersDb.getWorkOrderById(input.workOrderId);
        if (!os || os.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "OS não encontrada" });
        }

        return await checklistDb.getChecklistsByWorkOrderId(input.workOrderId);
      }),

    // Busca uma instância pelo ID
    getById: adminLocalProcedure // ISOLADO COM GUARDA
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        const checklistDb = await import("../checklistsDb");
        const instance = await checklistDb.getChecklistInstanceById(input.id);
        if (!instance || instance.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Checklist não encontrado" });
        }
        return instance;
      }),

    // Busca instância com os dados do template (perguntas + respostas juntos)
    getWithTemplate: adminLocalProcedure // ISOLADO COM GUARDA
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        const checklistDb = await import("../checklistsDb");
        const instance = await checklistDb.getChecklistInstanceById(input.id);
        if (!instance || instance.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Checklist não encontrado" });
        }
        return await checklistDb.getChecklistWithTemplate(input.id);
      }),

    // Cria uma nova instância de checklist para uma tarefa de inspeção
    // templateId é global (catálogo compartilhado) — sem checagem de tenant, só de posse da task pai.
    create: adminLocalProcedure // ISOLADO COM GUARDA
      .input(z.object({
        inspectionTaskId: z.number(),
        templateId: z.number(),
        customTitle: z.string().min(1),
        brand: z.string().optional(),    // marca do equipamento
        power: z.string().optional(),    // potência/modelo do equipamento
      }))
      .mutation(async ({ input, ctx }) => {
        const checklistDb = await import("../checklistsDb");

        // GUARDA: a tarefa pai precisa pertencer ao tenant do admin logado.
        const task = await checklistDb.getInspectionTaskById(input.inspectionTaskId);
        if (!task || task.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tarefa de inspeção não encontrada" });
        }

        const id = await checklistDb.createChecklistInstance({ ...input, tenantId: ctx.tenantId });
        return { success: true, id, message: "Checklist adicionado com sucesso" };
      }),

    // Salva as respostas preenchidas de uma instância de checklist
    updateResponses: adminLocalProcedure // ISOLADO COM GUARDA
      .input(z.object({
        id: z.number(),
        responses: z.record(z.string(), z.unknown()), // objeto chave→valor com as respostas
        isComplete: z.boolean(),                       // se todas as perguntas foram respondidas
      }))
      .mutation(async ({ input, ctx }) => {
        const checklistDb = await import("../checklistsDb");

        const instance = await checklistDb.getChecklistInstanceById(input.id);
        if (!instance || instance.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Checklist não encontrado" });
        }

        await checklistDb.updateChecklistResponses(input.id, input.responses, input.isComplete);
        return { success: true, message: "Respostas salvas com sucesso" };
      }),

    // Atualiza metadados de uma instância (título, marca, potência)
    update: adminLocalProcedure // ISOLADO COM GUARDA
      .input(z.object({
        id: z.number(),
        customTitle: z.string().optional(),
        brand: z.string().optional(),
        power: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const checklistDb = await import("../checklistsDb");

        const instance = await checklistDb.getChecklistInstanceById(input.id);
        if (!instance || instance.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Checklist não encontrado" });
        }

        const { id, ...data } = input;
        await checklistDb.updateChecklistInstance(id, data);
        return { success: true, message: "Checklist atualizado com sucesso" };
      }),

    // Remove uma instância de checklist
    delete: adminLocalProcedure // ISOLADO COM GUARDA
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const checklistDb = await import("../checklistsDb");

        const instance = await checklistDb.getChecklistInstanceById(input.id);
        if (!instance || instance.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Checklist não encontrado" });
        }

        await checklistDb.deleteChecklistInstance(input.id);
        return { success: true, message: "Checklist deletado com sucesso" };
      }),

    // Gera sugestão de conclusão com IA para o campo Observações
    suggestConclusion: adminLocalProcedure // ISOLADO COM GUARDA
      .input(z.object({ checklistInstanceId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const checklistDb = await import("../checklistsDb");

        const instance = await checklistDb.getChecklistInstanceById(input.checklistInstanceId);
        if (!instance || instance.tenantId !== ctx.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Checklist não encontrado" });
        }

        const { sugerirConclusaoChecklist } = await import("../iaChecklists");
        return await sugerirConclusaoChecklist(input.checklistInstanceId);
      }),
  }),
});
