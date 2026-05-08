// ============================================================
// 📁 ARQUIVO: pdfGenerator.ts
// 🎯 FUNÇÃO: Gera o PDF completo de uma Ordem de Serviço.
// ============================================================

import PDFDocument from 'pdfkit';
import { getWorkOrderById } from './workOrdersDb';
import { getMaterialsByWorkOrderId, getCommentsByWorkOrderId, getAttachmentsByWorkOrderId, getTasksByWorkOrderId } from './workOrdersAuxDb';
import { getInspectionTasksByWorkOrder, getChecklistsByInspectionTask } from './checklistsDb';
import { getBudgetById, getBudgetItems, getBudgetAttachments } from './budgetsDb';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// 🔧 HELPERS DE FORMATAÇÃO
// ============================================================

/**
 * Verifica se um valor do banco representa "marcado/verdadeiro".
 *
 * ⚠️ CORREÇÃO: antes só checava 'sim' minúsculo.
 * Agora aceita qualquer variação: true, 1, "Sim", "sim", "SIM",
 * "true", "True", "1", "yes" — independente de maiúsculas.
 */
function isMarcado(value: any): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number')  return value === 1;
  const s = String(value).toLowerCase().trim();
  return s === 'sim' || s === 'true' || s === '1' || s === 'yes';
}

/**
 * Transforma uma chave interna em rótulo legível.
 * Ex: "corrente_1"        → "Corrente 1"
 *     "quantidade_bombas" → "Qtd. bombas"
 *     "tensao"            → "Tensão"
 */
function formatLabel(raw: string): string {
  const aliases: Record<string, string> = {
    tensao:            'Tensão',
    fases:             'Fases',
    quantidade_bombas: 'Qtd. bombas',
    num_bombas:        'Qtd. Bombas',
    corrente_1:        'Corrente 1',
    corrente_2:        'Corrente 2',
    corrente_3:        'Corrente 3',
    corrente_4:        'Corrente 4',
    // Aliases do template unificado de Bomba
    corrente_bomba_1:  'Corrente 1',
    corrente_bomba_2:  'Corrente 2',
    corrente_bomba_3:  'Corrente 3',
    corrente_bomba_4:  'Corrente 4',
    potencia:          'Potência',
    marca:             'Marca',
    modelo:            'Modelo',
    rpm:               'RPM',
    pressao:           'Pressão',
    vazao:             'Vazão',
  };
  const key = raw.toLowerCase().trim();
  if (aliases[key]) return aliases[key];
  return key.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
}

/**
 * Detecta a unidade correta e retorna [valor_limpo, unidade].
 *
 * ⚠️ CORREÇÃO: remove unidade já embutida no valor para evitar
 * duplicação (ex: "220V" + unidade "V" → aparecia "220V V").
 * Agora: "220V" → ["220", "V"]   /   "220" → ["220", "V"]
 */
function splitValueUnit(key: string, value: any): [string, string] {
  const k = key.toLowerCase();

  // Remove unidade colada no final do valor (ex: "220V", "7,5CV", "50Hz")
  const cleanValue = String(value)
    .replace(/\s*(V|A|CV|kW|Hz|RPM|rpm|bar|m³\/h)$/i, '')
    .replace('.', ',') // ponto → vírgula (padrão BR)
    .trim();

  if (k.startsWith('corrente'))                    return [cleanValue, 'A'];
  if (k.startsWith('tensao'))                      return [cleanValue, 'V'];
  if (k === 'potencia')                            return [cleanValue, 'CV'];
  if (k === 'pressao')                             return [cleanValue, 'bar'];
  if (k === 'vazao')                               return [cleanValue, 'm³/h'];
  if (k === 'rpm')                                 return [cleanValue, 'rpm'];
  if (k === 'frequencia')                          return [cleanValue, 'Hz'];
  if (k === 'nivel_combustivel')                   return [cleanValue, 'L'];
  if (k === 'temperatura_arrefecimento')           return [cleanValue, '°C'];
  if (k === 'horometro')                           return [cleanValue, 'h'];
  if (k === 'fases')                               return [formatFieldValue(value), ''];
  return [formatFieldValue(value), ''];
}

// ============================================================
// 📄 FUNÇÃO PRINCIPAL
// ============================================================
export async function generateWorkOrderPDF(workOrderId: number): Promise<Buffer> {

    // Buscar anexos/fotos
  const attachments = await getAttachmentsByWorkOrderId(workOrderId);
  const workOrder = await getWorkOrderById(workOrderId);
  if (!workOrder) throw new Error('Ordem de serviço não encontrada');

  const materials       = await getMaterialsByWorkOrderId(workOrderId);
  const comments        = await getCommentsByWorkOrderId(workOrderId, false);
  const workOrderTasks  = await getTasksByWorkOrderId(workOrderId);
  const inspectionTasks = await getInspectionTasksByWorkOrder(workOrderId);


  const tasksWithChecklists = await Promise.all(
    inspectionTasks.map(async (task) => ({
      ...task,
      checklists: await getChecklistsByInspectionTask(task.id)
    }))
  );

  const totalMaterials = materials.reduce((sum: number, m: any) => sum + (m.totalCost || 0), 0);

  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 40, bottom: 40, left: 40, right: 40 },
        autoFirstPage: true,
        bufferPages: true
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end',  () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth    = doc.page.width;
      const leftMargin   = 40;
      const rightMargin  = pageWidth - 40;
      const goldColor    = '#D4A84B';
      const contentWidth = pageWidth - 80;

      // ── CABEÇALHO ────────────────────────────────────────────
      let headerY = 30;

      const possibleLogoPaths = [
        path.join(__dirname, 'logo-jnc-transparente.png'),
        path.join(process.cwd(), 'server', 'logo-jnc-transparente.png'),
        path.join(process.cwd(), 'logo-jnc-transparente.png'),
        '/home/ubuntu/soluteg-novo/server/logo-jnc-transparente.png'
      ];
      let logoPath = '';
      for (const p of possibleLogoPaths) { if (fs.existsSync(p)) { logoPath = p; break; } }
      if (logoPath) {
        doc.image(logoPath, (pageWidth - 80) / 2, headerY, { width: 80, height: 80 });
        headerY += 90;
      }

      doc.fontSize(18).fillColor('#333333').font('Helvetica-Bold')
         .text('ORDEM DE SERVIÇO', leftMargin, headerY, { width: contentWidth, align: 'center' });
      headerY += 25;
      doc.fontSize(14).fillColor(goldColor).font('Helvetica-Bold')
         .text(workOrder.osNumber || `OS-${workOrderId}`, leftMargin, headerY, { width: contentWidth, align: 'center' });
      headerY += 20;
      doc.fontSize(9).fillColor('#666666').font('Helvetica')
         .text(`Data: ${formatDate(workOrder.createdAt)}`, leftMargin, headerY, { width: contentWidth, align: 'right' });
      headerY += 15;
      doc.strokeColor(goldColor).lineWidth(2).moveTo(leftMargin, headerY).lineTo(rightMargin, headerY).stroke();
      headerY += 15;

      // ── INFORMAÇÕES DA OS E DO CLIENTE ────────────────────────
      const col1X    = leftMargin;
      const col2X    = pageWidth / 2 + 10;
      const colWidth = (contentWidth / 2) - 10;
      let infoY = headerY;

      doc.fontSize(11).fillColor(goldColor).font('Helvetica-Bold').text('Informações da Ordem', col1X, infoY);
      infoY += 18;
      doc.fontSize(9).fillColor('#333333').font('Helvetica');
      doc.text(`Título: ${workOrder.title || 'Sem título'}`, col1X, infoY, { width: colWidth }); infoY += 14;
      doc.text(`Status: ${translateStatus(workOrder.status)}`, col1X, infoY, { width: colWidth }); infoY += 14;
      doc.text(`Prioridade: ${translatePriority(workOrder.priority)}`, col1X, infoY, { width: colWidth }); infoY += 14;
      doc.text(`Tipo: ${translateType(workOrder.type)}`, col1X, infoY, { width: colWidth });
      if (workOrder.scheduledDate) { infoY += 14; doc.text(`Data Agendada: ${formatDate(workOrder.scheduledDate)}`, col1X, infoY, { width: colWidth }); }

      let clientY = headerY;
      doc.fontSize(11).fillColor(goldColor).font('Helvetica-Bold').text('Informações do Cliente', col2X, clientY);
      clientY += 18;
      doc.fontSize(9).fillColor('#333333').font('Helvetica');
      doc.text(`Nome: ${workOrder.clientName || 'Não informado'}`, col2X, clientY, { width: colWidth }); clientY += 14;
      doc.text(`Telefone: ${workOrder.clientPhone || 'Não informado'}`, col2X, clientY, { width: colWidth });
      if (workOrder.clientEmail)   { clientY += 14; doc.text(`E-mail: ${workOrder.clientEmail}`, col2X, clientY, { width: colWidth }); }
      if (workOrder.clientAddress) { clientY += 14; doc.text(`Endereço: ${workOrder.clientAddress}`, col2X, clientY, { width: colWidth }); }

      let currentY = Math.max(infoY, clientY) + 25;

      // ── DESCRIÇÃO ─────────────────────────────────────────────
      if (workOrder.description) {
        doc.fontSize(11).fillColor(goldColor).font('Helvetica-Bold').text('Descrição', leftMargin, currentY);
        currentY += 15;
        doc.fontSize(9).fillColor('#333333').font('Helvetica')
           .text(workOrder.description, leftMargin, currentY, { width: contentWidth, align: 'justify' });
        currentY = doc.y + 20;
      }

      // ── MATERIAIS ─────────────────────────────────────────────
      if (materials && materials.length > 0) {
        doc.fontSize(11).fillColor(goldColor).font('Helvetica-Bold').text('Materiais', leftMargin, currentY);
        currentY += 15;
        const tL = leftMargin, tW = contentWidth;
        const cM = tL, cQ = tL + tW * 0.45, cU = tL + tW * 0.60, cS = tL + tW * 0.80;
        doc.rect(tL, currentY, tW, 18).fill(goldColor);
        doc.fontSize(8).fillColor('#FFFFFF').font('Helvetica-Bold')
           .text('Material',    cM + 5, currentY + 5, { width: tW * 0.40 })
           .text('Qtd',         cQ + 5, currentY + 5, { width: tW * 0.12 })
           .text('Valor Unit.', cU + 5, currentY + 5, { width: tW * 0.18 })
           .text('Subtotal',    cS + 5, currentY + 5, { width: tW * 0.18 });
        currentY += 20;
        materials.forEach((m: any, i: number) => {
          const sub  = m.totalCost || 0;
          const nome = m.materialName || m.name || m.description || 'Material sem nome';
          if (i % 2 === 0) doc.rect(tL, currentY, tW, 16).fill('#F8F8F8');
          doc.fontSize(8).fillColor('#333333')
             .text(nome,                                            cM + 5, currentY + 4, { width: tW * 0.40, ellipsis: true })
             .text(`${m.quantity || 0} ${m.unit || 'un'}`,         cQ + 5, currentY + 4, { width: tW * 0.12 })
             .text(`R$ ${(m.unitCost || 0).toFixed(2)}`,           cU + 5, currentY + 4, { width: tW * 0.18 })
             .text(`R$ ${sub.toFixed(2)}`,                         cS + 5, currentY + 4, { width: tW * 0.18 });
          currentY += 18;
        });
        doc.rect(tL, currentY, tW, 20).fill('#3D4654');
        doc.fontSize(10).fillColor('#FFFFFF').font('Helvetica-Bold')
           .text('TOTAL',                            cM + 5, currentY + 5, { width: tW * 0.70 })
           .text(`R$ ${totalMaterials.toFixed(2)}`, cS + 5, currentY + 5, { width: tW * 0.18 });
        currentY += 30;
      }

      // ── VALORES ───────────────────────────────────────────────
      if (workOrder.estimatedValue || workOrder.finalValue) {
        doc.fontSize(11).fillColor(goldColor).font('Helvetica-Bold').text('Valores', leftMargin, currentY);
        currentY += 15;
        doc.fontSize(9).fillColor('#333333').font('Helvetica');
        if (workOrder.estimatedValue) { doc.text(`Valor Estimado: R$ ${workOrder.estimatedValue.toFixed(2)}`, leftMargin, currentY); currentY += 14; }
        if (workOrder.finalValue)     { doc.text(`Valor Final: R$ ${workOrder.finalValue.toFixed(2)}`, leftMargin, currentY); currentY += 14; }
      }

      // ── TAREFAS ───────────────────────────────────────────────
      if (workOrderTasks && workOrderTasks.length > 0) {
        if (currentY > doc.page.height - 100) { doc.addPage(); currentY = 40; }

        doc.fontSize(11).fillColor(goldColor).font('Helvetica-Bold').text('Tarefas', leftMargin, currentY);
        currentY += 15;

        const taskRowH = 18;
        workOrderTasks.forEach((task: any, i: number) => {
          if (currentY > doc.page.height - 60) { doc.addPage(); currentY = 40; }

          // Fundo alternado
          if (i % 2 === 0) doc.rect(leftMargin, currentY, contentWidth, taskRowH).fill('#F8F8F8');

          // Ícone de status
          const status = task.isCompleted as number;
          const iconX = leftMargin + 4;
          const iconY = currentY + (taskRowH - 10) / 2;
          if (status === 1) {
            // Concluída: círculo verde com ✓
            doc.circle(iconX + 5, iconY + 5, 5).fill('#2E7D32');
            doc.fontSize(6).fillColor('#FFFFFF').font('Helvetica-Bold').text('✓', iconX + 2, iconY + 2);
          } else if (status === 2) {
            // Não concluída: círculo vermelho com ✗
            doc.circle(iconX + 5, iconY + 5, 5).fill('#C62828');
            doc.fontSize(6).fillColor('#FFFFFF').font('Helvetica-Bold').text('✗', iconX + 2, iconY + 2);
          } else {
            // Pendente: círculo vazio
            doc.circle(iconX + 5, iconY + 5, 5).strokeColor('#AAAAAA').lineWidth(1).stroke();
          }

          // Título
          const titleStyle = status === 1 ? '#888888' : status === 2 ? '#C62828' : '#333333';
          doc.fontSize(9).fillColor(titleStyle).font(status === 0 ? 'Helvetica' : 'Helvetica')
             .text(task.title, leftMargin + 18, currentY + (taskRowH - 9) / 2, { width: contentWidth - 80 });

          // Label de status à direita
          const statusLabel = status === 1 ? 'Concluída' : status === 2 ? 'Não concluída' : 'Pendente';
          const labelColor  = status === 1 ? '#2E7D32'  : status === 2 ? '#C62828'        : '#888888';
          doc.fontSize(7).fillColor(labelColor).font('Helvetica')
             .text(statusLabel, leftMargin + contentWidth - 70, currentY + (taskRowH - 7) / 2, { width: 70, align: 'right' });

          currentY += taskRowH;
        });

        currentY += 16;
      }

      // ── CHECKLISTS DE EQUIPAMENTOS ────────────────────────────
      if (tasksWithChecklists && tasksWithChecklists.length > 0) {
        if (currentY > doc.page.height - 100) { doc.addPage(); currentY = 40; }

        doc.fontSize(11).fillColor(goldColor).font('Helvetica-Bold').text('Checklists de Equipamentos', leftMargin, currentY);
        currentY += 20;

        for (const task of tasksWithChecklists) {

          if (task.checklists && task.checklists.length > 0) {
            for (const checklist of task.checklists) {
              if (currentY > doc.page.height - 150) { doc.addPage(); currentY = 40; }

              const cardX = leftMargin, cardW = contentWidth;

              // Borda superior dourada
              doc.strokeColor(goldColor).lineWidth(3).moveTo(cardX, currentY).lineTo(cardX + cardW, currentY).stroke();
              currentY += 8;

              // ── PRÉ-PARSE das respostas (necessário para o header) ──────────
              // Feito aqui fora para que tipo_bomba esteja disponível no header mesmo
              // antes de entrar no bloco de detalhes.
              const okNokNaLabels: Record<string, string> = {
                tubos:           'Tubos',       acionamento:     'Acionamento',
                boias:           'Boias',        painel:          'Painel',
                sala:            'Sala',         ruido:           'Ruído',
                vazamentos:      'Vazamentos',   corrosao:        'Corrosão',
                conexoes_soltas: 'Conexões Soltas', radiador:     'Radiador',
                mangueiras:      'Mangueiras',   bateria_visual:  'Bateria (Visual)',
                cabos_eletricos: 'Cabos Elétricos', escapamento:  'Escapamento',
                filtros:         'Filtros',      painel_controle: 'Painel de Controle',
              };

              let tipoBomba: string | undefined;
              let okNokNaKeys = new Set<string>();
              let parsedResponses: Record<string, unknown> = {};

              if (checklist.responses) {
                try {
                  parsedResponses = typeof checklist.responses === 'string'
                    ? JSON.parse(checklist.responses) : checklist.responses;
                  tipoBomba   = parsedResponses.tipo_bomba as string | undefined;
                  okNokNaKeys = new Set(Object.keys(parsedResponses).filter(k => {
                    const v = String(parsedResponses[k]).toLowerCase();
                    return v === 'ok' || v === 'nok' || v === 'na';
                  }));
                } catch { /* falha silenciosa — header ainda será renderizado */ }
              }

              // ── HEADER DO CARD (sempre renderizado) ─────────────────────
              // Se há tipo_bomba, o header cresce para acomodar o subtítulo.
              const headerH = tipoBomba ? 36 : 22;
              doc.rect(cardX, currentY, cardW, headerH).fill('#F5F5F5');
              doc.fontSize(10).fillColor(goldColor).font('Helvetica-Bold')
                 .text(checklist.customTitle, cardX + 10, currentY + 5, { width: cardW - 20 });
              if (tipoBomba) {
                doc.fontSize(8).fillColor('#777777').font('Helvetica')
                   .text(`Bomba de ${tipoBomba}`, cardX + 10, currentY + 21, { width: cardW - 20 });
              }
              currentY += headerH + 6;

              // Marca e Potência
              if (checklist.brand || checklist.power) {
                doc.fontSize(8).fillColor('#888888').font('Helvetica');
                doc.text(`Marca: ${checklist.brand || 'N/A'}`,    cardX + 10,        currentY, { width: cardW / 2 - 10 });
                doc.text(`Potência: ${checklist.power || 'N/A'}`, cardX + cardW / 2, currentY, { width: cardW / 2 - 10 });
                currentY += 16;
              }
              currentY += 4;

              // ── DETALHES (visual, dados técnicos, observações) ───────────
              if (checklist.responses && Object.keys(parsedResponses).length > 0) {
                try {
                  const responses = parsedResponses;

                  // ================================================
                  // ✅ INSPEÇÃO VISUAL — 2 COLUNAS COM BADGES
                  //
                  // Suporta dois formatos de resposta:
                  //
                  // FORMATO ANTIGO (checkbox_table):
                  //   "visual_items_Tubos_OK": "Sim"
                  //   "visual_items_Sala_N/A": "Sim"
                  //
                  // FORMATO NOVO (ok_nok_na — template unificado de Bomba):
                  //   "tubos":      "ok"
                  //   "acionamento":"nok"
                  //   "sala":       "na"
                  // ================================================

                  // ── INSPEÇÃO VISUAL ─────────────────────────────────
                  // Suporta TRÊS gerações de instâncias:
                  //
                  // 1. Templates antigos (checkbox_table):
                  //    Chaves visual_items_* armazenadas diretamente, ex:
                  //    "visual_items_Tubos_OK": "Sim"
                  //
                  // 2. Instâncias do período de migração (ok_nok_na sem dual-write):
                  //    Apenas chaves curtas, sem prefixo visual_items_*, ex:
                  //    "tubos": "ok", "acionamento": "nok"
                  //
                  // 3. Instâncias novas (ok_nok_na com dual-write):
                  //    Ambos os formatos simultâneos — visual_items_* e chaves curtas.

                  // Formato 1 e 3: lê chaves visual_items_*
                  const visualKeys = Object.keys(responses).filter(k =>
                    k.toLowerCase().startsWith('visual_items_')
                  );

                  const itemMap: Record<string, { ok: boolean; nok: boolean; na: boolean }> = {};

                  for (const key of visualKeys) {
                    const semPrefixo  = key.replace(/^visual_items_/i, '');
                    const ultimoUnder = semPrefixo.lastIndexOf('_');
                    if (ultimoUnder === -1) continue;
                    const itemName = semPrefixo.substring(0, ultimoUnder);
                    const estado   = semPrefixo.substring(ultimoUnder + 1).toUpperCase().replace(/\s/g, '');
                    const marcado  = isMarcado(responses[key]);

                    if (!itemMap[itemName]) itemMap[itemName] = { ok: false, nok: false, na: false };
                    if      (estado === 'OK')                               itemMap[itemName].ok  = marcado;
                    else if (estado === 'NOK')                              itemMap[itemName].nok = marcado;
                    else if (estado.includes('N') && estado.includes('A')) itemMap[itemName].na  = marcado;
                  }

                  // Formato 2 e 3: lê chaves ok/nok/na curtas (ex: "tubos": "ok").
                  // Em instâncias do tipo 3, os itens já foram populados pelo loop acima;
                  // o `if (!itemMap[label])` garante que não sobrescrevemos o que existe.
                  for (const key of okNokNaKeys) {
                    const label = okNokNaLabels[key.toLowerCase()] ?? key;
                    const val   = String(responses[key]).toLowerCase();
                    if (!itemMap[label]) itemMap[label] = { ok: false, nok: false, na: false };
                    if      (val === 'ok')  itemMap[label].ok  = true;
                    else if (val === 'nok') itemMap[label].nok = true;
                    else if (val === 'na')  itemMap[label].na  = true;
                  }

                  const hasVisualItems = Object.keys(itemMap).length > 0;

                  if (hasVisualItems) {
                    doc.fontSize(8).fillColor('#888888').font('Helvetica-Bold')
                       .text('INSPEÇÃO VISUAL', cardX + 10, currentY);
                    currentY += 10;
                    doc.strokeColor('#E0E0E0').lineWidth(0.5)
                       .moveTo(cardX + 10, currentY).lineTo(cardX + cardW - 10, currentY).stroke();
                    currentY += 8;

                    // Filtra N/A e mantém ordem conhecida (bomba + gerador)
                    const ordemConhecida = [
                      'Tubos', 'Acionamento', 'Boias', 'Painel', 'Sala', 'Ruído',
                      'Vazamentos', 'Corrosão', 'Conexões Soltas', 'Radiador',
                      'Mangueiras', 'Bateria (Visual)', 'Cabos Elétricos',
                      'Escapamento', 'Filtros', 'Painel de Controle',
                    ];
                    const itensVisiveis  = [
                      ...ordemConhecida.filter(i => itemMap[i] && !itemMap[i].na),
                      ...Object.keys(itemMap).filter(i => !ordemConhecida.includes(i) && !itemMap[i].na)
                    ];

                    // Renderiza em 2 colunas
                    const colVisW   = (cardW - 20) / 2;
                    const col1VisX  = cardX + 10;
                    const col2VisX  = cardX + 10 + colVisW + 5;
                    const rowH      = 16;
                    const badgeW    = 36;
                    const badgeH    = 11;
                    const meioVis   = Math.ceil(itensVisiveis.length / 2);

                    const renderVisualCol = (items: string[], startX: number, startY: number) => {
                      let y = startY;
                      items.forEach((itemName) => {
                        const est   = itemMap[itemName];
                        const bgCol = y % (rowH * 2) < rowH ? '#FAFAFA' : '#FFFFFF';
                        doc.rect(startX, y, colVisW, rowH).fill(bgCol);

                        // Nome do item
                        doc.fontSize(8).fillColor('#333333').font('Helvetica-Bold')
                           .text(itemName, startX + 4, y + 4, { width: colVisW - badgeW * 2 - 20 });

                        const bY   = y + (rowH - badgeH) / 2;
                        const okX  = startX + colVisW - badgeW * 2 - 6;
                        const nokX = okX + badgeW + 4;

                        // Badge OK — verde se marcado, cinza vazio se não
                        if (est.ok) {
                          doc.roundedRect(okX, bY, badgeW, badgeH, 4).fill('#2E7D32');
                          doc.fontSize(6).fillColor('#FFFFFF').font('Helvetica-Bold')
                             .text('✓ OK', okX, bY + 2, { width: badgeW, align: 'center' });
                        } else {
                          doc.roundedRect(okX, bY, badgeW, badgeH, 4).strokeColor('#DDDDDD').lineWidth(0.5).stroke();
                          doc.fontSize(6).fillColor('#CCCCCC').font('Helvetica')
                             .text('OK', okX, bY + 2, { width: badgeW, align: 'center' });
                        }

                        // Badge NOK — vermelho se marcado, cinza vazio se não
                        if (est.nok) {
                          doc.roundedRect(nokX, bY, badgeW, badgeH, 4).fill('#C62828');
                          doc.fontSize(6).fillColor('#FFFFFF').font('Helvetica-Bold')
                             .text('✗ NOK', nokX, bY + 2, { width: badgeW, align: 'center' });
                        } else {
                          doc.roundedRect(nokX, bY, badgeW, badgeH, 4).strokeColor('#DDDDDD').lineWidth(0.5).stroke();
                          doc.fontSize(6).fillColor('#CCCCCC').font('Helvetica')
                             .text('NOK', nokX, bY + 2, { width: badgeW, align: 'center' });
                        }

                        y += rowH;
                      });
                      return y;
                    };

                    const col1EndY = renderVisualCol(itensVisiveis.slice(0, meioVis), col1VisX, currentY);
                    const col2EndY = renderVisualCol(itensVisiveis.slice(meioVis),    col2VisX, currentY);
                    currentY = Math.max(col1EndY, col2EndY) + 10;
                  }

                  // ================================================
                  // 🔧 DADOS TÉCNICOS — grade 2 colunas
                  //
                  // Cada célula: rótulo pequeno (cinza) + valor em
                  // destaque + unidade automática ao lado.
                  //
                  // ⚠️ CORREÇÃO: splitValueUnit agora remove a unidade
                  // já embutida no valor antes de adicionar a sua
                  // (evita "220V V").
                  // ================================================
                  const technicalFields = Object.entries(responses).filter(([key]) => {
                    const k = key.toLowerCase();
                    return !k.startsWith('visual_items_') &&  // formato antigo de inspeção visual
                           !okNokNaKeys.has(key) &&           // formato novo de inspeção visual
                           k !== 'tipo_bomba' &&              // mostrado no cabeçalho do card
                           k !== 'observations' && k !== 'observacoes' &&
                           k !== 'notes'        && k !== 'comments';
                  });

                  if (technicalFields.length > 0) {
                    // Garante espaço para cabeçalho + pelo menos 2 linhas de dados
                    // antes de renderizar "DADOS TÉCNICOS", evitando cabeçalho órfão
                    const minDadosTecH = 16 + 28 * 2; // separador+rótulo + 2 linhas
                    if (currentY > doc.page.height - minDadosTecH - 10) { doc.addPage(); currentY = 40; }

                    doc.strokeColor('#E0E0E0').lineWidth(0.5)
                       .moveTo(cardX + 10, currentY).lineTo(cardX + cardW - 10, currentY).stroke();
                    currentY += 6;
                    doc.fontSize(8).fillColor('#888888').font('Helvetica-Bold')
                       .text('DADOS TÉCNICOS', cardX + 10, currentY);
                    currentY += 10;

                    const cellW    = (cardW - 20) / 2;
                    const cellH    = 28;
                    const col1TecX = cardX + 10;
                    const col2TecX = cardX + 10 + cellW + 4;

                    // Filtra campos com valor
                    const validFields = technicalFields.filter(([, v]) =>
                      v !== null && v !== undefined && v !== ''
                    );

                    validFields.forEach(([label, value], i) => {
                      const isLeft   = i % 2 === 0;
                      const cellX    = isLeft ? col1TecX : col2TecX;
                      const linhaIdx = Math.floor(i / 2);

                      // Avança Y apenas quando começa nova linha (coluna esquerda)
                      if (isLeft && i > 0) currentY += cellH;

                      if (currentY > doc.page.height - 100) { doc.addPage(); currentY = 40; }

                      // Fundo alternado por linha
                      if (linhaIdx % 2 === 0) {
                        doc.rect(cellX, currentY, cellW, cellH).fill('#F7F7F7');
                      }

                      // Rótulo
                      doc.fontSize(7).fillColor('#999999').font('Helvetica')
                         .text(formatLabel(label), cellX + 6, currentY + 4, { width: cellW - 8 });

                      // Valor + unidade
                      const [val, unit] = splitValueUnit(label, value);
                      doc.fontSize(10).fillColor('#222222').font('Helvetica-Bold')
                         .text(val, cellX + 6, currentY + 14, { continued: unit !== '' });
                      if (unit !== '') {
                        doc.fontSize(7).fillColor('#999999').font('Helvetica')
                           .text(` ${unit}`, { continued: false });
                      }
                    });

                    // Avança após a última linha
                    currentY += cellH + 8;
                  }
                
                  // ================================================
                  // 📝 OBSERVAÇÕES TÉCNICAS — blockquote dourado
                  // ================================================
                  const obsContent = responses.observations || responses.observacoes;
                  if (obsContent && obsContent.trim() !== '') {
                    const cleanObs   = obsContent.trim();
                    const obsW       = cardW - 30;
                    const textH      = doc.heightOfString(cleanObs, { width: obsW - 16, align: 'justify' });
                    const blockH     = textH + 20;
                    // Checa com base na altura real do bloco, não um limiar fixo
                    if (currentY + blockH + 12 > doc.page.height - 40) { doc.addPage(); currentY = 40; }

                    // Borda dourada à esquerda (estilo blockquote)
                    doc.strokeColor(goldColor).lineWidth(3)
                       .moveTo(cardX + 10, currentY).lineTo(cardX + 10, currentY + blockH).stroke();

                    doc.rect(cardX + 13, currentY, obsW, blockH).fill('#FDFAF4');

                    doc.fontSize(7).fillColor('#B8922A').font('Helvetica-Bold')
                       .text('OBSERVAÇÕES TÉCNICAS', cardX + 18, currentY + 5);

                    doc.fontSize(8).fillColor('#444444').font('Helvetica')
                       .text(cleanObs, cardX + 18, currentY + 16, {
                         width: obsW - 16, align: 'justify', lineGap: 2
                       });

                    currentY += blockH + 12;
                  }

                  // Linha separadora do card
                  doc.strokeColor(goldColor).lineWidth(1)
                     .moveTo(cardX, currentY).lineTo(cardX + cardW, currentY).stroke();
                  currentY += 14;

                } catch (e) {
                  console.error('[PDF] Erro ao parsear respostas do checklist:', e);
                }
              }
              currentY += 6;
            }
          }
          currentY += 14;
        }
      }

      // ── COMENTÁRIOS ───────────────────────────────────────────
      if (comments && comments.length > 0) {
        if (currentY > doc.page.height - 100) { doc.addPage(); currentY = 40; }
        doc.fontSize(11).fillColor(goldColor).font('Helvetica-Bold').text('Observações', leftMargin, currentY);
        currentY += 15;
        doc.fontSize(9).fillColor('#333333').font('Helvetica');
        comments.forEach((comment: any) => {
          doc.font('Helvetica-Bold').text(`${formatDate(comment.createdAt)}:`, leftMargin, currentY);
          currentY += 12;
          doc.font('Helvetica').text(comment.comment, leftMargin, currentY, { width: contentWidth, align: 'justify' });
          currentY = doc.y + 10;
        });
        currentY += 10;
      }

      // ── FOTOS ─────────────────────────────────────────────────
      const images = attachments?.filter(a => a.fileType?.includes('image')) || [];
      if (images.length > 0) {
        if (currentY > doc.page.height - 150) { doc.addPage(); currentY = 40; }
        doc.fontSize(11).fillColor(goldColor).font('Helvetica-Bold').text('Relatório Fotográfico', leftMargin, currentY);
        currentY += 25;
        const numCols = 3, gap = 10;
        const imgW    = (contentWidth - gap * (numCols - 1)) / numCols;
        const imgH    = 100;
        let maxRowHeight = imgH; // Rastrear altura máxima da linha
        
        for (let i = 0; i < images.length; i++) {
          const col  = i % numCols;
          const xPos = leftMargin + col * (imgW + gap);

          // Avança para a próxima linha e verifica quebra de página apenas no início de cada nova linha
          if (i > 0 && col === 0) {
            currentY += maxRowHeight + gap + 20; // espaço para legenda
            maxRowHeight = imgH;
            if (currentY > doc.page.height - imgH - 40) { doc.addPage(); currentY = 40; }
          }

          try {
            const resp = await axios.get(images[i].fileUrl, { responseType: 'arraybuffer' });
            doc.image(resp.data, xPos, currentY, { width: imgW, height: imgH, fit: [imgW, imgH], align: 'center', valign: 'center' });
          } catch {
            doc.rect(xPos, currentY, imgW, imgH).strokeColor('#CCCCCC').stroke();
          }

          // Legenda abaixo da foto — somente com posição absoluta, nunca usa cursor interno do PDFKit
          if (images[i].description) {
            const legendY = currentY + imgH + 4;
            doc.fontSize(8).fillColor('#555555').font('Helvetica')
               .text(images[i].description, xPos, legendY, { width: imgW, align: 'center', ellipsis: true });
            maxRowHeight = Math.max(maxRowHeight, imgH + 20);
          } else {
            maxRowHeight = Math.max(maxRowHeight, imgH);
          }
        }
        currentY += maxRowHeight + 30;
      }

      // ── ASSINATURAS ───────────────────────────────────────────
      const posRodape = doc.page.height - 160;
      if (currentY > posRodape - 20) { doc.addPage(); currentY = 40; }

      // Monta apenas as assinaturas que existem (ordem: técnico, responsável, cliente)
      type SigEntry = { sig: string; label: string; name: string };
      const sigsToShow: SigEntry[] = [];

      const rawTechSig   = (workOrder as any).technicianSignature   as string | null | undefined;
      const rawCollabSig = (workOrder as any).collaboratorSignature as string | null | undefined;
      const rawClientSig = (workOrder as any).clientSignature       as string | null | undefined;

      if (rawTechSig   && rawTechSig.length   > 50) sigsToShow.push({ sig: rawTechSig,   label: 'Assinatura do Técnico',     name: (workOrder as any).technicianName   || '—' });
      if (rawCollabSig && rawCollabSig.length > 50) sigsToShow.push({ sig: rawCollabSig, label: 'Assinatura do Responsável', name: (workOrder as any).collaboratorName || '—' });
      if (rawClientSig && rawClientSig.length > 50) sigsToShow.push({ sig: rawClientSig, label: 'Assinatura do Cliente',     name: (workOrder as any).clientSignerName || '—' });

      if (sigsToShow.length > 0) {
        const count    = sigsToShow.length;
        const sigGap   = count > 1 ? 30 : 0;
        const sigColW  = count === 1 ? 250 : (contentWidth - sigGap * (count - 1)) / count;
        const totalSigW = sigColW * count + sigGap * (count - 1);
        const sigStartX = count === 1 ? (doc.page.width - totalSigW) / 2 : leftMargin;
        const imageY    = posRodape;
        const sigLineY  = imageY + 45;

        sigsToShow.forEach((item, i) => {
          const x = sigStartX + i * (sigColW + sigGap);
          try {
            const b64 = item.sig.includes(',') ? item.sig.split(',')[1] : item.sig;
            doc.image(Buffer.from(b64, 'base64'), x + sigColW / 4, imageY, { width: sigColW / 2, height: 40 });
          } catch (e) { console.error('Erro ao renderizar assinatura', e); }
          doc.strokeColor('#333333').lineWidth(0.5).moveTo(x, sigLineY).lineTo(x + sigColW, sigLineY).stroke();
          doc.fontSize(8).fillColor('#666666').font('Helvetica')
             .text(item.label,          x, sigLineY + 5,  { width: sigColW, align: 'center' })
             .text(`Nome: ${item.name}`, x, sigLineY + 15, { width: sigColW, align: 'center' });
        });
      }

      // ── RODAPÉ ────────────────────────────────────────────────
      const footerText = 'Este documento foi gerado eletronicamente pelo sistema Soluteg';
      doc.fontSize(7).fillColor('#999999').font('Helvetica')
         .text(footerText, (doc.page.width - doc.widthOfString(footerText)) / 2, doc.page.height - 30, { lineBreak: false });

      doc.end();

    } catch (error) {
      console.error('Erro geral na geração do PDF:', error);
    }
  });
}

// ============================================================
// 🔧 FUNÇÕES AUXILIARES
// ============================================================

function translateStatus(status: string): string {
  const map: Record<string, string> = {
    aberta: 'Aberta', aguardando_aprovacao: 'Aguardando Aprovação',
    aprovada: 'Aprovada', rejeitada: 'Rejeitada', em_andamento: 'Em Andamento',
    concluida: 'Concluída', aguardando_pagamento: 'Aguardando Pagamento', cancelada: 'Cancelada'
  };
  return map[status] || status;
}
function translatePriority(p: string): string {
  return ({ normal: 'Normal', alta: 'Alta', critica: 'Crítica' } as any)[p] || p;
}
function translateType(t: string): string {
  const map: Record<string, string> = {
    rotina: 'Rotina', emergencial: 'Emergencial',
    instalacao: 'Instalação', manutencao: 'Manutenção',
    corretiva: 'Corretiva', preventiva: 'Preventiva',
  };
  return map[t] || t;
}
function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('pt-BR');
}
function formatFieldValue(value: any): string {
  if (value === null || value === undefined) return 'N/A';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (typeof value === 'number')  return value.toString();
  if (typeof value === 'string') {
    const t: Record<string, string> = {
      ok: 'Ok', nok: 'NOk', n_a: 'N/A',
      monofasico: 'Monofásico', bifasico: 'Bifásico', trifasico: 'Trifásico'
    };
    return t[value.toLowerCase()] || value;
  }
  return String(value);
}

// ============================================================
// 📄 GERADOR DE PDF — ORÇAMENTO
// ============================================================
export async function generateBudgetPDF(budgetId: number): Promise<Buffer> {
  const budget = await getBudgetById(budgetId);
  if (!budget) throw new Error('Orçamento não encontrado');

  const items = await getBudgetItems(budgetId);
  const photos = await getBudgetAttachments(budgetId);

  const serviceTypeLabel: Record<string, string> = {
    instalacao: 'Instalação', manutencao: 'Manutenção',
    corretiva: 'Corretiva', preventiva: 'Preventiva',
    rotina: 'Rotina', emergencial: 'Emergencial',
  };
  const statusLabel: Record<string, string> = {
    pendente: 'Pendente', finalizado: 'Ag. Aprovação',
    aprovado: 'Aprovado', reprovado: 'Reprovado',
  };
  const fmtCurrency = (cents: number | null | undefined) => {
    if (!cents && cents !== 0) return '—';
    return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
  };

  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 40, bottom: 60, left: 40, right: 40 },
        autoFirstPage: true,
        bufferPages: true,
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageW   = doc.page.width;
      const L       = 40;   // left margin
      const R       = pageW - 40;
      const CW      = pageW - 80;
      const GOLD    = '#D4A84B';
      const DARK    = '#1e293b';
      const MUTED   = '#64748b';

      // ── LOGO ──────────────────────────────────────────────────
      const possibleLogoPaths = [
        path.join(__dirname, 'logo-jnc-transparente.png'),
        path.join(process.cwd(), 'server', 'logo-jnc-transparente.png'),
        path.join(process.cwd(), 'logo-jnc-transparente.png'),
        '/home/ubuntu/soluteg-novo/server/logo-jnc-transparente.png',
      ];
      let logoPath = '';
      for (const p of possibleLogoPaths) { if (fs.existsSync(p)) { logoPath = p; break; } }

      let y = 30;
      if (logoPath) {
        doc.image(logoPath, (pageW - 70) / 2, y, { width: 70, height: 70 });
        y += 80;
      }

      // ── TÍTULO ────────────────────────────────────────────────
      doc.fontSize(18).fillColor(DARK).font('Helvetica-Bold')
         .text('ORÇAMENTO', L, y, { width: CW, align: 'center' });
      y += 24;
      doc.fontSize(13).fillColor(GOLD).font('Helvetica-Bold')
         .text(budget.budgetNumber || `ORC-${budgetId}`, L, y, { width: CW, align: 'center' });
      y += 20;
      doc.fontSize(8).fillColor(MUTED).font('Helvetica')
         .text(`Emissão: ${formatDate(budget.createdAt)}`, L, y, { width: CW, align: 'right' });
      y += 10;
      doc.strokeColor(GOLD).lineWidth(2).moveTo(L, y).lineTo(R, y).stroke();
      y += 14;

      // ── DADOS PRINCIPAIS ──────────────────────────────────────
      const col2X = pageW / 2 + 10;
      const half  = CW / 2 - 10;

      doc.fontSize(10).fillColor(GOLD).font('Helvetica-Bold').text('Dados do Orçamento', L, y); y += 16;
      doc.fontSize(9).fillColor(DARK).font('Helvetica');

      const left: [string, string][] = [
        ['Título',        budget.title || '—'],
        ['Tipo de Serviço', serviceTypeLabel[budget.serviceType] || budget.serviceType],
        ['Status',        statusLabel[budget.status] || budget.status],
        ['Cliente',       budget.clientName || '—'],
      ];
      const right: [string, string][] = [
        ['Válido até',    budget.validUntil ? formatDate(budget.validUntil) : '—'],
        ['Validade',      `${budget.validityDays ?? '—'} dias`],
        ['Valor Total',   fmtCurrency(budget.totalValue)],
        ['Mão de Obra',   fmtCurrency(budget.laborValue)],
      ];

      const startY = y;
      left.forEach(([label, value], i) => {
        const rowY = startY + i * 16;
        doc.font('Helvetica-Bold').text(`${label}: `, L, rowY, { continued: true, width: half });
        doc.font('Helvetica').text(value, { width: half });
      });
      right.forEach(([label, value], i) => {
        const rowY = startY + i * 16;
        doc.font('Helvetica-Bold').text(`${label}: `, col2X, rowY, { continued: true, width: half });
        doc.font('Helvetica').text(value, { width: half });
      });
      y = startY + left.length * 16 + 8;

      // ── DESCRIÇÃO ─────────────────────────────────────────────
      if (budget.description) {
        doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(L, y).lineTo(R, y).stroke(); y += 10;
        doc.fontSize(9).fillColor(GOLD).font('Helvetica-Bold').text('Descrição', L, y); y += 14;
        doc.fontSize(9).fillColor(DARK).font('Helvetica').text(budget.description, L, y, { width: CW }); y += doc.heightOfString(budget.description, { width: CW }) + 8;
      }

      // ── ESCOPO ────────────────────────────────────────────────
      if (budget.scope) {
        doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(L, y).lineTo(R, y).stroke(); y += 10;
        doc.fontSize(9).fillColor(GOLD).font('Helvetica-Bold').text('Escopo dos Serviços', L, y); y += 14;
        doc.fontSize(9).fillColor(DARK).font('Helvetica').text(budget.scope, L, y, { width: CW }); y += doc.heightOfString(budget.scope, { width: CW }) + 8;
      }

      // ── TABELA DE ITENS ───────────────────────────────────────
      if (items.length > 0) {
        doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(L, y).lineTo(R, y).stroke(); y += 10;
        doc.fontSize(10).fillColor(GOLD).font('Helvetica-Bold').text('Detalhamento de Itens', L, y); y += 14;

        // cabeçalho da tabela
        // colTotal = 75px para caber valores como "R$ 37.700,00" sem quebrar linha
        const colDesc   = L;
        const colQty    = R - 260;
        const colUnit   = R - 210;
        const colUPrice = R - 150;
        const colTotal  = R - 75;

        doc.rect(L, y, CW, 18).fill('#f1f5f9');
        doc.fontSize(8).fillColor(DARK).font('Helvetica-Bold');
        doc.text('Descrição',   colDesc,   y + 4, { width: colQty - colDesc - 4 });
        doc.text('Qtd.',        colQty,    y + 4, { width: 46, align: 'center' });
        doc.text('Un.',         colUnit,   y + 4, { width: 46, align: 'center' });
        doc.text('Vl. Unit.',   colUPrice, y + 4, { width: 66, align: 'right' });
        doc.text('Total',       colTotal,  y + 4, { width: 75, align: 'right' });
        y += 18;

        items.forEach((item: any, idx: number) => {
          if (idx % 2 === 1) doc.rect(L, y, CW, 16).fill('#f8fafc');
          doc.fillColor(DARK).font('Helvetica').fontSize(8);
          doc.text(item.description,                                colDesc,   y + 2, { width: colQty - colDesc - 4 });
          doc.text((item.quantity / 100).toFixed(2),                colQty,    y + 2, { width: 46, align: 'center' });
          doc.text(item.unit || '—',                                colUnit,   y + 2, { width: 46, align: 'center' });
          doc.text(fmtCurrency(item.unitPrice),                     colUPrice, y + 2, { width: 66, align: 'right' });
          doc.font('Helvetica-Bold').text(fmtCurrency(item.totalPrice), colTotal,  y + 2, { width: 75, align: 'right' });
          y += 16;
        });

        // rodapé da tabela
        doc.rect(L, y, CW, 18).fill('#1e293b');
        doc.fontSize(9).fillColor('#ffffff').font('Helvetica-Bold');
        doc.text('TOTAL',               colDesc,   y + 4, { width: colUPrice - colDesc - 4 });
        doc.text(fmtCurrency(budget.totalValue), colTotal, y + 4, { width: 75, align: 'right' });
        y += 22;
      }

      // ── OBSERVAÇÕES AO CLIENTE ────────────────────────────────
      if (budget.clientNotes) {
        y += 4;
        doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(L, y).lineTo(R, y).stroke(); y += 10;
        doc.fontSize(9).fillColor(GOLD).font('Helvetica-Bold').text('Observações', L, y); y += 14;
        doc.fontSize(9).fillColor(DARK).font('Helvetica').text(budget.clientNotes, L, y, { width: CW }); y += doc.heightOfString(budget.clientNotes, { width: CW }) + 8;
      }

      // ── FOTOS DO LOCAL (ANTES) ────────────────────────────────
      const imagePhotos = photos.filter((p: any) => p.fileType?.startsWith('image/'));
      if (imagePhotos.length > 0) {
        if (y > doc.page.height - 150) { doc.addPage(); y = 40; }
        doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(L, y).lineTo(R, y).stroke(); y += 10;
        doc.fontSize(10).fillColor(GOLD).font('Helvetica-Bold').text('Fotos do Local (Antes)', L, y); y += 16;

        const numCols = 2;
        const gap     = 10;
        const imgW    = (CW - gap) / numCols;
        const imgH    = 140;

        for (let i = 0; i < imagePhotos.length; i++) {
          const col  = i % numCols;
          const xPos = L + col * (imgW + gap);

          if (i > 0 && col === 0) y += imgH + (imagePhotos[i - 1].caption ? 28 : 12);
          if (y > doc.page.height - imgH - 60) { doc.addPage(); y = 40; }

          try {
            const resp = await axios.get(imagePhotos[i].fileUrl, { responseType: 'arraybuffer' });
            doc.image(resp.data, xPos, y, { width: imgW, height: imgH, fit: [imgW, imgH], align: 'center', valign: 'center' });
          } catch {
            doc.rect(xPos, y, imgW, imgH).strokeColor('#cccccc').stroke();
            doc.fontSize(7).fillColor(MUTED).text('Imagem indisponível', xPos, y + imgH / 2 - 5, { width: imgW, align: 'center' });
          }

          if (imagePhotos[i].caption) {
            doc.fontSize(8).fillColor(DARK).font('Helvetica')
               .text(imagePhotos[i].caption, xPos, y + imgH + 4, { width: imgW, align: 'center', ellipsis: true });
          }
        }
        // avança y após última linha
        y += imgH + (imagePhotos[imagePhotos.length - 1].caption ? 28 : 12) + 6;
      }

      // ── POSICIONA ASSINATURAS PRÓXIMAS AO RODAPÉ ─────────────
      // Espaço real: divisor+rótulo (22) + imagem (56) + nome/doc/data (36) por assinatura
      // + validade (50) + margem interna (16) = ~180px (duas assinaturas cabem em ~230px)
      const hasTechSig   = !!budget.technicianSignature;
      const hasClientSig = !!budget.clientSignature;
      const sigBlockHeight = (hasTechSig ? 120 : 0) + (hasClientSig ? 110 : 0) + 60;
      const posRodape = doc.page.height - sigBlockHeight - 60; // 60 = bottom margin do doc
      if (y > posRodape) doc.addPage();
      y = posRodape;

      // ── ASSINATURA DO TÉCNICO ─────────────────────────────────
      if (budget.technicianSignature) {
        y += 8;
        doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(L, y).lineTo(R, y).stroke(); y += 10;
        doc.fontSize(9).fillColor(GOLD).font('Helvetica-Bold').text('Responsável Técnico', L, y); y += 12;
        const sigBase64 = budget.technicianSignature.replace(/^data:image\/\w+;base64,/, '');
        const sigBuf = Buffer.from(sigBase64, 'base64');
        doc.image(sigBuf, L, y, { height: 50 });
        y += 56;
        doc.fontSize(8).fillColor(DARK).font('Helvetica').text(budget.technicianName || '—', L, y); y += 12;
        if (budget.technicianDocument) { doc.text(`Doc: ${budget.technicianDocument}`, L, y); y += 12; }
        if (budget.finalizedAt) { doc.fillColor(MUTED).text(`Finalizado em: ${formatDate(budget.finalizedAt)}`, L, y); y += 12; }
      }

      // ── ASSINATURA DO CLIENTE ─────────────────────────────────
      if (budget.clientSignature) {
        y += 8;
        doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(L, y).lineTo(R, y).stroke(); y += 10;
        doc.fontSize(9).fillColor(GOLD).font('Helvetica-Bold').text('Aprovado por', L, y); y += 12;
        const sigBase64 = budget.clientSignature.replace(/^data:image\/\w+;base64,/, '');
        const sigBuf = Buffer.from(sigBase64, 'base64');
        doc.image(sigBuf, L, y, { height: 50 });
        y += 56;
        doc.fontSize(8).fillColor(DARK).font('Helvetica').text(budget.clientSignatureName || budget.approvedBy || '—', L, y); y += 12;
        if (budget.approvedAt) { doc.fillColor(MUTED).text(`Aprovado em: ${formatDate(budget.approvedAt)}`, L, y); y += 12; }
      }

      // ── AVISO DE VALIDADE (rodapé do documento) ───────────────
      y += 16;
      doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(L, y).lineTo(R, y).stroke(); y += 10;
      const validityNotice = `Este orçamento é válido por ${budget.validityDays ?? '—'} dias a partir da data de emissão`
        + (budget.finalizedAt ? ` (${formatDate(budget.finalizedAt)})` : '')
        + `. Após este prazo, os preços e condições poderão ser revistos.`;
      doc.fontSize(8).fillColor(MUTED).font('Helvetica').text(validityNotice, L, y, { width: CW, align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
