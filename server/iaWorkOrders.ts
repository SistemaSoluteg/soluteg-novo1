/**
 * IA para comentários públicos (visíveis ao cliente) das Ordens de Serviço.
 *
 * Analisa os dados da OS, comentários internos e checklists preenchidos
 * para sugerir um texto de atualização claro e profissional para o cliente.
 *
 * Usa o mesmo modelo e padrão de chamada dos outros módulos de IA (claude-sonnet-4-6).
 */

import { getWorkOrderById } from "./workOrdersDb";
import { getCommentsByWorkOrderId, getTasksByWorkOrderId } from "./workOrdersAuxDb";
import { getChecklistsByWorkOrderId, getTemplateById } from "./checklistsDb";

export interface SugestaoComentarioOS {
  comentario: string; // texto pronto para colar no campo de comentário do cliente
}

/**
 * Gera sugestão de comentário público para o cliente com base em:
 *  - Dados gerais da OS (título, tipo, status, notas internas)
 *  - Comentários internos (não visíveis ao cliente)
 *  - Tarefas/itens de serviço e seus status de conclusão
 *  - Checklists de inspeção preenchidos (resumo dos pontos NOK)
 */
export async function sugerirComentarioCliente(workOrderId: number): Promise<SugestaoComentarioOS> {
  const os = await getWorkOrderById(workOrderId);
  if (!os) throw new Error("OS não encontrada");

  // Carrega comentários internos para contexto da IA (NÃO vão para o cliente diretamente)
  const comentariosInternos = await getCommentsByWorkOrderId(workOrderId, true);
  const somenteInternos = comentariosInternos.filter((c: any) => c.isInternal === 1);

  // Carrega tarefas da OS
  const tarefas = await getTasksByWorkOrderId(workOrderId);

  // Carrega checklists e monta resumo dos itens NOK
  const checklists = await getChecklistsByWorkOrderId(workOrderId);
  const resumoChecklists: string[] = [];

  for (const cl of checklists) {
    if (!cl.responses) continue;
    const template = await getTemplateById(cl.templateId);
    if (!template?.formStructure) continue;

    let estrutura: any = null;
    try { estrutura = JSON.parse(template.formStructure as string); } catch { continue; }

    const respostas: Record<string, any> = JSON.parse(cl.responses as string);
    const secoes = estrutura.sections ?? (estrutura.fields ? [{ title: "Geral", fields: estrutura.fields }] : []);

    const itensNok: string[] = [];
    for (const secao of secoes) {
      const campos = secao.fields ?? secao.items?.flatMap((i: any) => i.fields ?? []) ?? [];
      for (const campo of campos) {
        const val = respostas[campo.id];
        if (val === "nok" || val === "NOK") itensNok.push(`${secao.title} → ${campo.label ?? campo.id}`);
      }
    }

    if (itensNok.length > 0) {
      resumoChecklists.push(`Checklist "${cl.customTitle}" (${template.name}): ${itensNok.length} item(ns) NOK — ${itensNok.join("; ")}`);
    } else if (cl.isComplete) {
      resumoChecklists.push(`Checklist "${cl.customTitle}" (${template.name}): todos os itens OK`);
    }
  }

  // Monta tarefas com status
  const tarefasTexto = tarefas.map((t: any) =>
    `- [${t.isCompleted ? "✓" : " "}] ${t.title}${t.description ? `: ${t.description}` : ""}`
  ).join("\n") || "Nenhuma tarefa cadastrada";

  // Monta comentários internos (só os relevantes, em forma de notas)
  const notasInternas = somenteInternos.length > 0
    ? somenteInternos.map((c: any) => `• ${c.comment} (${c.userId})`).join("\n")
    : "Nenhuma anotação interna";

  const systemPrompt =
    "Você é um assistente de comunicação para uma empresa de manutenção elétrica e de geradores. " +
    "Sua tarefa é redigir um comentário profissional, claro e objetivo para o cliente sobre o andamento " +
    "ou conclusão do serviço. " +
    "O comentário deve ser em português, tom cordial mas técnico, sem jargões internos, sem revelar " +
    "informações confidenciais, e com no máximo 3-4 parágrafos curtos. " +
    "Responda APENAS com JSON válido no formato: {\"comentario\": \"texto aqui\"}. " +
    "Sem markdown, sem explicações fora do JSON.";

  // Mapa de status para texto legível
  const statusMap: Record<string, string> = {
    aberta: "Aberta",
    em_andamento: "Em andamento",
    pausada: "Pausada",
    concluida: "Concluída",
    cancelada: "Cancelada",
  };
  const tipoMap: Record<string, string> = {
    corretiva: "Corretiva",
    preventiva: "Preventiva",
    rotina: "Rotina/Vistoria",
    instalacao: "Instalação",
    orcamento: "Orçamento",
  };

  const userPrompt =
    `DADOS DA OS:\n` +
    `Número: ${os.osNumber ?? os.id}\n` +
    `Título: ${os.title}\n` +
    `Tipo: ${tipoMap[os.type ?? ""] ?? os.type}\n` +
    `Status atual: ${statusMap[os.status ?? ""] ?? os.status}\n` +
    `Descrição: ${os.description ?? "—"}\n` +
    `Notas internas da OS: ${os.internalNotes ?? "—"}\n` +
    `\nTAREFAS:\n${tarefasTexto}\n` +
    `\nCHECKLISTS DE INSPEÇÃO:\n${resumoChecklists.length > 0 ? resumoChecklists.join("\n") : "Nenhum checklist preenchido"}\n` +
    `\nCOMENTÁRIOS INTERNOS (não mostrar ao cliente, usar apenas como contexto):\n${notasInternas}\n` +
    `\nCom base em todas essas informações, redija um comentário para enviar ao cliente sobre o status/resultado do serviço.`;

  const resposta = await chamarClaudeAPI(systemPrompt, userPrompt, 800);

  let parsed: any;
  try {
    parsed = JSON.parse(resposta);
  } catch {
    // Se a IA não retornou JSON, usa o texto direto
    return { comentario: resposta };
  }

  return { comentario: parsed.comentario ?? resposta };
}

// ── Utilitário de chamada à API Claude ────────────────────────────────────────

async function chamarClaudeAPI(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY não configurada no servidor");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const erroTexto = await response.text().catch(() => "sem detalhes");
    throw new Error(`Erro na API Claude: ${response.status} — ${erroTexto}`);
  }

  const data: any = await response.json();
  const texto: string = data?.content?.[0]?.text ?? "";
  if (!texto) throw new Error("Resposta vazia da API Claude");

  return texto.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
}
