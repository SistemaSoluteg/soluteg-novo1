/**
 * Job de OS mensal automática.
 *
 * Cria uma OS de rotina ("Vistoria de <Mês> de <Ano>") para cada cliente
 * que tiver pelo menos um equipamento cadastrado. Para cada equipamento
 * adiciona automaticamente um checklist do tipo correspondente (bomba/gerador)
 * com subtítulo igual à descrição do equipamento.
 *
 * Regras:
 * - Se já existe uma OS com o mesmo título para o cliente naquele mês → pula.
 * - Roda no startup do servidor e todo dia 1° do mês às 01h00 via node-cron.
 */

import { eq, and } from "drizzle-orm";
import { getDb, getClientEquipment, getAllClientsWithEquipment } from "./db";
import { createWorkOrder } from "./workOrdersDb";
import { createInspectionTask, createChecklistInstance, getTemplateBySlug, getInspectionTasksByWorkOrder } from "./checklistsDb";
import { workOrders } from "../drizzle/schema";

// Nomes dos meses em português (índice 0 = Janeiro)
const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/**
 * Cria a OS mensal de um único cliente.
 * Retorna { created, workOrderId, titulo } se criou, ou { skipped, reason } se pulou.
 */
export async function createMonthlyOsForClient(
  adminId: number,
  clientId: number,
): Promise<{ created: true; workOrderId: number; titulo: string } | { skipped: true; reason: string }> {
  const db = await getDb();
  if (!db) return { skipped: true, reason: "banco indisponível" };

  const now = new Date();
  const mes  = MESES[now.getMonth()];
  const ano  = now.getFullYear();
  const titulo = `Vistoria de ${mes} de ${ano}`;

  // Verifica se já existe OS com esse título para este cliente
  const existing = await db
    .select({ id: workOrders.id })
    .from(workOrders)
    .where(and(eq(workOrders.clientId, clientId), eq(workOrders.title, titulo)))
    .limit(1);

  if (existing.length > 0) return { skipped: true, reason: "OS do mês já existe" };

  // Busca equipamentos cadastrados para o cliente
  const equipment = await getClientEquipment(clientId);
  if (equipment.length === 0) return { skipped: true, reason: "sem equipamentos cadastrados" };

  // Cria a OS principal (sem técnico atribuído — admin designa depois)
  const { id: workOrderId } = await createWorkOrder({
    adminId,
    clientId,
    type: "rotina",
    title: titulo,
    description: "Inspeção mensal e manutenção preventiva",
    status: "aberta",
  });

  // Cria a tarefa de inspeção que agrupa todos os checklists
  const taskId = await createInspectionTask({
    workOrderId,
    title: "Checklists de Equipamentos",
  });

  // Um checklist por equipamento
  for (const equip of equipment) {
    const template = await getTemplateBySlug(equip.type); // 'bomba' ou 'gerador'
    if (!template) {
      console.warn(`[MONTHLY OS] Template '${equip.type}' não encontrado — equipamento ${equip.id} ignorado`);
      continue;
    }
    await createChecklistInstance({
      inspectionTaskId: taskId,
      templateId: template.id,
      customTitle: equip.description, // subtítulo = localização/descrição do equipamento
    });
  }

  console.log(`[MONTHLY OS] ✅ OS criada — cliente ${clientId}, "${titulo}", ${equipment.length} checklist(s)`);
  return { created: true, workOrderId, titulo };
}

/**
 * Chamada ao adicionar um equipamento individual via cadastro.
 *
 * - Se a OS do mês ainda não existe → cria a OS e cria o checklist do equipamento.
 * - Se a OS já existe (outros equipamentos foram adicionados antes) → apenas adiciona
 *   o checklist do novo equipamento à tarefa de inspeção existente.
 *
 * Assim cada equipamento sempre ganha seu checklist, independente da ordem de cadastro.
 */
export async function addEquipmentToMonthlyOs(
  adminId: number,
  clientId: number,
  equipment: { type: string; description: string },
): Promise<{ workOrderId: number; titulo: string; osCreated: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("banco indisponível");

  const now = new Date();
  const mes  = MESES[now.getMonth()];
  const ano  = now.getFullYear();
  const titulo = `Vistoria de ${mes} de ${ano}`;

  // Busca OS existente ou cria uma nova
  const existing = await db
    .select({ id: workOrders.id })
    .from(workOrders)
    .where(and(eq(workOrders.clientId, clientId), eq(workOrders.title, titulo)))
    .limit(1);

  let workOrderId: number;
  let osCreated = false;

  if (existing.length > 0) {
    workOrderId = existing[0].id;
  } else {
    const result = await createWorkOrder({
      adminId,
      clientId,
      type: "rotina",
      title: titulo,
      description: "Inspeção mensal e manutenção preventiva",
      status: "aberta",
    });
    workOrderId = result.id;
    osCreated = true;
  }

  // Busca ou cria a tarefa de inspeção que agrupa os checklists
  const tasks = await getInspectionTasksByWorkOrder(workOrderId);
  const taskId = tasks.length > 0
    ? tasks[0].id
    : await createInspectionTask({ workOrderId, title: "Checklists de Equipamentos" });

  // Cria checklist apenas para este equipamento
  const template = await getTemplateBySlug(equipment.type);
  if (template) {
    await createChecklistInstance({
      inspectionTaskId: taskId,
      templateId: template.id,
      customTitle: equipment.description,
    });
  } else {
    console.warn(`[MONTHLY OS] Template '${equipment.type}' não encontrado — checklist não criado`);
  }

  console.log(`[MONTHLY OS] ✅ Checklist adicionado — "${equipment.description}" (${equipment.type}) na OS "${titulo}"`);
  return { workOrderId, titulo, osCreated };
}

/**
 * Percorre todos os clientes com equipamentos e dispara createMonthlyOsForClient.
 * Erros individuais são logados mas não interrompem os demais clientes.
 */
export async function processAllClientsMonthlyOs(): Promise<void> {
  const clientsWithEquipment = await getAllClientsWithEquipment();
  if (clientsWithEquipment.length === 0) return;

  console.log(`[MONTHLY OS] Processando ${clientsWithEquipment.length} cliente(s)...`);

  for (const client of clientsWithEquipment) {
    try {
      const result = await createMonthlyOsForClient(client.adminId, client.id);
      if ("skipped" in result) {
        console.log(`[MONTHLY OS] ⏭ Cliente ${client.id} (${client.name}): ${result.reason}`);
      }
    } catch (err) {
      console.error(`[MONTHLY OS] ❌ Erro no cliente ${client.id} (${client.name}):`, err);
    }
  }
}
