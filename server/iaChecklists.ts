/**
 * IA para checklists de inspeção.
 *
 * Analisa as respostas preenchidas (ok/nok/na + medições) e gera um texto
 * de conclusão técnica para o campo Observações do checklist.
 *
 * Usa o mesmo modelo e padrão de chamada do iaLaudos.ts (claude-sonnet-4-6).
 */

import { getChecklistInstanceById, getTemplateById } from "./checklistsDb";

export interface SugestaoChecklist {
  conclusao: string;      // texto principal para o campo Observações
  recomendacoes: string;  // recomendações extras (itens NOK), pode ser vazio
}

/**
 * Gera sugestão de conclusão para um checklist preenchido.
 * Monta contexto humano-legível a partir das respostas + estrutura do template.
 */
export async function sugerirConclusaoChecklist(checklistInstanceId: number): Promise<SugestaoChecklist> {
  const instance = await getChecklistInstanceById(checklistInstanceId);
  if (!instance) throw new Error("Checklist não encontrado");

  const template = await getTemplateById(instance.templateId);
  if (!template) throw new Error("Template não encontrado");

  const responses: Record<string, any> = instance.responses
    ? JSON.parse(instance.responses as string)
    : {};

  const formStructure = template.formStructure
    ? JSON.parse(template.formStructure as string)
    : null;
  if (!formStructure?.sections) throw new Error("Estrutura de template inválida");

  // Monta contexto legível seção por seção
  let contexto = `EQUIPAMENTO: ${template.name} — ${instance.customTitle}\n\n`;

  const itensNok: string[] = [];

  for (const section of formStructure.sections as any[]) {
    // Pula seção de observações (é onde a IA vai escrever)
    if (section.id === "observacoes") continue;

    contexto += `=== ${section.title} ===\n`;

    // Itens OK/NOK/NA (inspeção visual)
    if (section.items?.length) {
      for (const item of section.items) {
        // Lê no formato novo (item.id) ou antigo (visual_items_*)
        const val =
          (responses[item.id] as string) ||
          (responses[`visual_items_${item.label}_OK`]  ? "ok"  :
           responses[`visual_items_${item.label}_NOK`] ? "nok" :
           responses[`visual_items_${item.label}_N/A`] ? "na"  : undefined);

        const label = val === "ok"  ? "OK ✓"
                    : val === "nok" ? "NOK ✗"
                    : val === "na"  ? "N/A"
                    : "não respondido";

        contexto += `- ${item.label}: ${label}\n`;

        if (val === "nok") itensNok.push(item.label);
      }
    }

    // Campos de medição / seleção
    if (section.fields?.length) {
      for (const field of section.fields) {
        if (field.id === "observacoes") continue;
        const val = responses[field.id];
        if (val === undefined || val === null || val === "") continue;
        const unidade = field.unit ? ` ${field.unit}` : "";
        contexto += `- ${field.label}: ${val}${unidade}\n`;
      }
    }

    contexto += "\n";
  }

  const resumoNok = itensNok.length > 0
    ? `\nITENS COM PROBLEMA (NOK): ${itensNok.join(", ")}`
    : "\nTodos os itens de inspeção visual estão OK.";

  const systemPrompt =
    "Você é um técnico de manutenção predial especializado em bombas hidráulicas e grupos geradores diesel. " +
    "Analise os dados da inspeção fornecidos e redija textos técnicos profissionais em português brasileiro. " +
    "Responda APENAS com JSON válido, sem markdown, sem texto fora do JSON.";

  const userPrompt =
    contexto +
    resumoNok +
    "\n\nCom base nos dados acima, gere:\n" +
    "1. Um texto de conclusão técnica descrevendo o estado geral do equipamento (2-3 parágrafos).\n" +
    "2. Recomendações de manutenção ou correção baseadas nos itens NOK (ou string vazia se tudo OK).\n\n" +
    "Retorne JSON no formato:\n" +
    "{\n" +
    '  "conclusao": "texto técnico com análise do estado do equipamento",\n' +
    '  "recomendacoes": "recomendações de manutenção ou string vazia"\n' +
    "}";

  const resposta = await chamarClaudeAPI(systemPrompt, userPrompt, 1500);

  try {
    const parsed = JSON.parse(resposta);
    return parsed as SugestaoChecklist;
  } catch {
    throw new Error("Resposta da IA em formato inválido — não foi possível parsear JSON");
  }
}

// ── Utilitário interno: chama a Claude API ──────────────────────────────────

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

  // Remove cercas de markdown caso a IA as inclua mesmo instruída a não fazer
  return texto.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
}
