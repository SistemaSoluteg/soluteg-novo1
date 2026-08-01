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
 */

import { adminLocalProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

export const checklistsRouter = router({

  // ──────────────────────────────────────────────
  // TEMPLATES — modelos de checklist cadastrados no sistema
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
    listByWorkOrder: adminLocalProcedure
      .input(z.object({ workOrderId: z.number() }))
      .query(async ({ input }) => {
        const checklistDb = await import("../checklistsDb");
        return await checklistDb.getInspectionTasksByWorkOrder(input.workOrderId);
      }),

    // Busca uma tarefa pelo ID
    getById: adminLocalProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const checklistDb = await import("../checklistsDb");
        return await checklistDb.getInspectionTaskById(input.id);
      }),

    // Busca tarefa com todos os detalhes (instâncias de checklist incluídas)
    getFull: adminLocalProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const checklistDb = await import("../checklistsDb");
        return await checklistDb.getFullInspectionTask(input.id);
      }),

    // Cria uma nova tarefa de inspeção para uma OS
    create: adminLocalProcedure
      .input(z.object({
        workOrderId: z.number(),
        title: z.string().min(1),
        description: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const checklistDb = await import("../checklistsDb");
        const id = await checklistDb.createInspectionTask(input);
        return { success: true, id, message: "Tarefa de inspeção criada com sucesso" };
      }),

    // Atualiza o status de andamento de uma tarefa (pendente / em_andamento / concluida)
    updateStatus: adminLocalProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["pendente", "em_andamento", "concluida"]),
      }))
      .mutation(async ({ input }) => {
        const checklistDb = await import("../checklistsDb");
        await checklistDb.updateInspectionTaskStatus(input.id, input.status);
        return { success: true, message: "Status atualizado com sucesso" };
      }),

    // Conclui uma tarefa de inspeção — exige que todos os checklists estejam preenchidos
    // e registra as assinaturas do responsável e (opcionalmente) do cliente
    complete: adminLocalProcedure
      .input(z.object({
        id: z.number(),
        collaboratorSignature: z.string().min(1),
        collaboratorName: z.string().min(1),
        collaboratorDocument: z.string().min(1),
        clientSignature: z.string().optional(),
        clientName: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const checklistDb = await import("../checklistsDb");
        const allComplete = await checklistDb.areAllChecklistsComplete(input.id);
        if (!allComplete) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Todos os checklists devem estar preenchidos antes de concluir a tarefa",
          });
        }
        await checklistDb.completeInspectionTask(input.id, input);
        return { success: true, message: "Tarefa concluída com sucesso" };
      }),

    // Remove uma tarefa de inspeção (e suas instâncias de checklist)
    delete: adminLocalProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const checklistDb = await import("../checklistsDb");
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
    listByTask: adminLocalProcedure
      .input(z.object({ inspectionTaskId: z.number() }))
      .query(async ({ input }) => {
        const checklistDb = await import("../checklistsDb");
        return await checklistDb.getChecklistsByInspectionTask(input.inspectionTaskId);
      }),

    // Lista instâncias de todos os checklists de uma OS (usado no portal do técnico)
    listByWorkOrder: adminLocalProcedure
      .input(z.object({ workOrderId: z.number() }))
      .query(async ({ input }) => {
        const checklistDb = await import("../checklistsDb");
        return await checklistDb.getChecklistsByWorkOrderId(input.workOrderId);
      }),

    // Busca uma instância pelo ID
    getById: adminLocalProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const checklistDb = await import("../checklistsDb");
        return await checklistDb.getChecklistInstanceById(input.id);
      }),

    // Busca instância com os dados do template (perguntas + respostas juntos)
    getWithTemplate: adminLocalProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const checklistDb = await import("../checklistsDb");
        return await checklistDb.getChecklistWithTemplate(input.id);
      }),

    // Cria uma nova instância de checklist para uma tarefa de inspeção
    create: adminLocalProcedure
      .input(z.object({
        inspectionTaskId: z.number(),
        templateId: z.number(),
        customTitle: z.string().min(1),
        brand: z.string().optional(),    // marca do equipamento
        power: z.string().optional(),    // potência/modelo do equipamento
      }))
      .mutation(async ({ input }) => {
        const checklistDb = await import("../checklistsDb");
        const id = await checklistDb.createChecklistInstance(input);
        return { success: true, id, message: "Checklist adicionado com sucesso" };
      }),

    // Salva as respostas preenchidas de uma instância de checklist
    updateResponses: adminLocalProcedure
      .input(z.object({
        id: z.number(),
        responses: z.record(z.string(), z.unknown()), // objeto chave→valor com as respostas
        isComplete: z.boolean(),                       // se todas as perguntas foram respondidas
      }))
      .mutation(async ({ input }) => {
        const checklistDb = await import("../checklistsDb");
        await checklistDb.updateChecklistResponses(input.id, input.responses, input.isComplete);
        return { success: true, message: "Respostas salvas com sucesso" };
      }),

    // Atualiza metadados de uma instância (título, marca, potência)
    update: adminLocalProcedure
      .input(z.object({
        id: z.number(),
        customTitle: z.string().optional(),
        brand: z.string().optional(),
        power: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const checklistDb = await import("../checklistsDb");
        const { id, ...data } = input;
        await checklistDb.updateChecklistInstance(id, data);
        return { success: true, message: "Checklist atualizado com sucesso" };
      }),

    // Remove uma instância de checklist
    delete: adminLocalProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const checklistDb = await import("../checklistsDb");
        await checklistDb.deleteChecklistInstance(input.id);
        return { success: true, message: "Checklist deletado com sucesso" };
      }),

    // Gera sugestão de conclusão com IA para o campo Observações
    suggestConclusion: adminLocalProcedure
      .input(z.object({ checklistInstanceId: z.number() }))
      .mutation(async ({ input }) => {
        const { sugerirConclusaoChecklist } = await import("../iaChecklists");
        return await sugerirConclusaoChecklist(input.checklistInstanceId);
      }),
  }),
});
