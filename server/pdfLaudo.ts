import PDFDocument from "pdfkit";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import { getLaudoById, getConfiguracoesTecnico, listLaudoTipos } from "./laudosDb";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("pt-BR");
}

function tipoLabel(tipo: string, tiposMap?: Record<string, string>): string {
  // Usa o mapa dinâmico (laudoTipos do banco) se disponível
  if (tiposMap && tiposMap[tipo]) return tiposMap[tipo];
  // Fallback estático para os tipos originais (garante compatibilidade se DB indisponível)
  const fallback: Record<string, string> = {
    instalacao_eletrica: "Instalação Elétrica",
    inspecao_predial: "Inspeção Predial",
    nr10_nr12: "NR-10 / NR-12",
    grupo_gerador: "Grupo Gerador",
    adequacoes: "Adequações",
    tubulacao_hidraulica: "Tubulação Hidráulica",
    spda_adequacao: "SPDA — Adequação e Execução",
    motores_eletricos: "Motores Elétricos",
    bombas_dagua: "Bombas D'água",
    motores_diesel: "Motores Diesel",
    combate_incendio: "Sistema de Combate a Incêndio",
    paineis_distribuicao: "Painéis de Distribuição",
    estruturas_metalicas: "Estruturas Metálicas",
  };
  return fallback[tipo] ?? tipo;
}

function parecerLabel(p: string): string {
  const map: Record<string, string> = {
    conforme: "CONFORME",
    nao_conforme: "NÃO CONFORME",
    parcialmente_conforme: "PARCIALMENTE CONFORME",
  };
  return map[p] ?? p.toUpperCase();
}

function parecerColor(p: string): string {
  if (p === "conforme") return "#16a34a";
  if (p === "nao_conforme") return "#dc2626";
  return "#d97706";
}

function statusConstatacaoLabel(s: string): string {
  if (s === "conforme") return "Conforme";
  if (s === "nao_conforme") return "Nao Conforme";
  return "Atencao";
}

function statusConstatacaoColor(s: string): string {
  if (s === "conforme") return "#16a34a";
  if (s === "nao_conforme") return "#dc2626";
  return "#d97706";
}

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const resp = await axios.get(url, { responseType: "arraybuffer", timeout: 8000 });
    return Buffer.from(resp.data);
  } catch {
    return null;
  }
}

function findLogoPath(): string {
  const candidates = [
    path.join(__dirname, "logo-jnc-transparente.png"),
    path.join(process.cwd(), "server", "logo-jnc-transparente.png"),
    path.join(process.cwd(), "logo-jnc-transparente.png"),
    "/home/ubuntu/soluteg-novo/server/logo-jnc-transparente.png",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return "";
}

// ── Gerador principal ────────────────────────────────────────────────────────

export async function generateLaudoPDF(laudoId: number): Promise<Buffer> {
  const laudo = await getLaudoById(laudoId);
  if (!laudo) throw new Error("Laudo não encontrado");

  // Config do técnico é por tenant — deriva do próprio laudo.
  const tecnico = await getConfiguracoesTecnico(laudo.tenantId as number);
  const logoPath = findLogoPath();

  // Carrega tipos dinâmicos para rótulo e aviso_legal no PDF
  const tiposRows = await listLaudoTipos().catch(() => []);
  // Mapa codigo → label para tipoLabel()
  const tiposMap: Record<string, string> = {};
  // Mapa codigo → avisoLegal para o bloco de aviso na capa
  const tiposAvisoMap: Record<string, string | null> = {};
  for (const t of tiposRows) {
    tiposMap[t.codigo as string] = t.label as string;
    tiposAvisoMap[t.codigo as string] = (t as any).avisoLegal ?? null;
  }
  const avisoLegal = tiposAvisoMap[laudo.tipo] ?? null;

  const laudoRef = laudo; // non-null reference for closures

  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 40, bottom: 50, left: 40, right: 40 },
        bufferPages: true,
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const pageW = doc.page.width;
      const pageH = doc.page.height;
      const L = 40;
      const R = pageW - 40;
      const CW = pageW - 80;
      const GOLD = "#D4A84B";
      const DARK = "#1e293b";
      const MUTED = "#64748b";

      // Funções como arrows para evitar TS1252
      const drawPageHeader = (num: string) => {
        doc.save();
        doc.rect(0, 0, pageW, 32).fill("#1e293b");
        if (logoPath) {
          doc.image(logoPath, L, 4, { width: 24, height: 24 });
        }
        doc.fontSize(7).fillColor("#94a3b8").font("Helvetica")
          .text("JNC Elétrica — Laudo Técnico", L + 30, 12)
          .text(`N ${num}`, R - 80, 12, { width: 80, align: "right" });
        doc.restore();
      };

      const checkPageBreak = (neededHeight: number) => {
        const usableBottom = pageH - 60;
        if (doc.y + neededHeight > usableBottom) {
          doc.addPage();
          drawPageHeader(laudoRef.numero);
          doc.y = 50;
        }
      };

      const sectionTitle = (title: string) => {
        checkPageBreak(40);
        doc.moveDown(0.5);
        const ty = doc.y;
        doc.rect(L, ty, CW, 22).fill(DARK);
        doc.fontSize(9).font("Helvetica-Bold").fillColor("#ffffff")
          .text(title.toUpperCase(), L + 8, ty + 6, { width: CW - 16 });
        doc.y = ty + 28;
      };

      const bodyText = (label: string, value: string) => {
        checkPageBreak(24);
        doc.fontSize(8).font("Helvetica-Bold").fillColor(DARK).text(`${label}: `, L, doc.y, { continued: true });
        doc.font("Helvetica").fillColor(MUTED).text(value || "—");
      };

      const paragraph = (text: string) => {
        checkPageBreak(30);
        doc.fontSize(8.5).font("Helvetica").fillColor(DARK)
          .text(text || "—", L, doc.y, { width: CW, lineGap: 2 });
        doc.moveDown(0.4);
      };

      // ══════════════════════════════════════════════════════════════════════
      // PÁGINA 1 — CAPA
      // ══════════════════════════════════════════════════════════════════════
      let y = 0;

      doc.rect(0, 0, pageW, 120).fill(DARK);

      if (logoPath) {
        doc.image(logoPath, (pageW - 64) / 2, 20, { width: 64, height: 64 });
        y = 94;
      } else {
        y = 30;
      }

      doc.fontSize(22).font("Helvetica-Bold").fillColor("#ffffff")
        .text("LAUDO TECNICO", L, y, { width: CW, align: "center" });
      y += 26;
      doc.fontSize(13).font("Helvetica").fillColor(GOLD)
        .text(tipoLabel(laudoRef.tipo, tiposMap), L, y, { width: CW, align: "center" });
      y = 140;

      // Número do laudo
      doc.rect(L + CW / 4, y, CW / 2, 32).fill(GOLD);
      doc.fontSize(14).font("Helvetica-Bold").fillColor("#ffffff")
        .text(laudoRef.numero, L + CW / 4, y + 9, { width: CW / 2, align: "center" });
      y += 50;

      const col1 = L;
      const col2 = L + CW / 2 + 10;
      const colW = CW / 2 - 10;

      const infoBox = (label: string, value: string, x: number, yPos: number, w: number): number => {
        doc.rect(x, yPos, w, 38).stroke("#e2e8f0");
        doc.fontSize(7).font("Helvetica").fillColor(MUTED)
          .text(label.toUpperCase(), x + 6, yPos + 6, { width: w - 12 });
        doc.fontSize(10).font("Helvetica-Bold").fillColor(DARK)
          .text(value || "—", x + 6, yPos + 17, { width: w - 12 });
        return yPos + 38;
      };

      infoBox("Data de Emissao", formatDate(new Date()), col1, y, colW);
      infoBox("Data de Inspecao", formatDate(laudoRef.dataInspecao), col2, y, colW);
      y += 44;

      infoBox("Validade", `${laudoRef.validadeMeses} meses`, col1, y, colW);
      infoBox("Status", laudoRef.status.charAt(0).toUpperCase() + laudoRef.status.slice(1), col2, y, colW);
      y += 60;

      // Bloco aviso legal — exibido apenas para tipos com restrição (ex: SPDA)
      if (avisoLegal) {
        // Borda e fundo âmbar
        doc.rect(L, y, CW, 2).fill("#f59e0b");
        y += 4;
        doc.save();
        doc.rect(L, y, CW, 14).fill("#fef3c7");
        doc.restore();
        doc.fontSize(8).font("Helvetica-Bold").fillColor("#92400e")
          .text("⚠  AVISO IMPORTANTE", L + 8, y + 3, { width: CW - 16 });
        y += 16;
        // Calcula a altura necessária para o texto do aviso
        const avisoTextHeight = doc.heightOfString(avisoLegal, { width: CW - 16, fontSize: 7 });
        doc.save();
        doc.rect(L, y, CW, avisoTextHeight + 12).fill("#fef3c7");
        doc.restore();
        doc.fontSize(7).font("Helvetica").fillColor("#78350f")
          .text(avisoLegal, L + 8, y + 6, { width: CW - 16, lineGap: 1.5 });
        y += avisoTextHeight + 16;
      }

      // Bloco cliente
      doc.rect(L, y, CW, 2).fill(GOLD);
      y += 10;
      doc.fontSize(9).font("Helvetica-Bold").fillColor(DARK).text("CLIENTE", L, y);
      y += 14;
      doc.fontSize(9).font("Helvetica").fillColor(DARK)
        .text(laudoRef.clienteNome ?? "Nao informado", L, y);
      if (laudoRef.clienteEndereco) {
        y += 12;
        doc.fontSize(8).fillColor(MUTED).text(String(laudoRef.clienteEndereco), L, y);
      }
      y += 30;

      // Bloco técnico
      doc.rect(L, y, CW, 2).fill(GOLD);
      y += 10;
      const tecnicosAtribuidos = (laudoRef as any).tecnicos as Array<{ nome?: string | null; tecnicoId: number }> | undefined;
      const temTecnicosAtribuidos = tecnicosAtribuidos && tecnicosAtribuidos.length > 0;
      doc.fontSize(9).font("Helvetica-Bold").fillColor(DARK)
        .text(temTecnicosAtribuidos ? "TECNICOS RESPONSAVEIS" : "TECNICO RESPONSAVEL", L, y);
      y += 14;
      if (temTecnicosAtribuidos) {
        for (let ti = 0; ti < tecnicosAtribuidos!.length; ti++) {
          const t = tecnicosAtribuidos![ti];
          doc.fontSize(9).font("Helvetica").fillColor(DARK)
            .text(t.nome ?? `Tecnico #${t.tecnicoId}`, L, y);
          y += 12;
        }
      } else {
        doc.fontSize(9).font("Helvetica").fillColor(DARK)
          .text(tecnico?.nomeCompleto ?? "Nao informado", L, y);
        y += 12;
        const tecnicoInfo = [
          tecnico?.registroCrt ?? "",
          tecnico?.especialidade ?? "",
          tecnico?.empresa ?? "",
          tecnico?.cidade ?? "",
        ].filter(Boolean).join(" | ");
        if (tecnicoInfo) {
          doc.fontSize(8).fillColor(MUTED).text(tecnicoInfo, L, y);
        }
      }

      // ══════════════════════════════════════════════════════════════════════
      // PÁGINAS SEGUINTES — Conteúdo
      // ══════════════════════════════════════════════════════════════════════
      doc.addPage();
      drawPageHeader(laudoRef.numero);
      doc.y = 50;

      // 1. Objeto do Laudo
      sectionTitle("1. Objeto do Laudo");
      paragraph(laudoRef.objeto ?? "");

      // 2. Normas de Referência
      const normas = laudoRef.normasReferencia as Array<{ codigo: string; titulo: string }>;
      if (normas && normas.length > 0) {
        sectionTitle("2. Normas de Referencia");
        for (let ni = 0; ni < normas.length; ni++) {
          const n = normas[ni];
          checkPageBreak(16);
          doc.fontSize(8).font("Helvetica-Bold").fillColor(DARK)
            .text(`- ${n.codigo}`, L + 8, doc.y, { continued: true });
          doc.font("Helvetica").fillColor(MUTED).text(` - ${n.titulo}`);
          doc.moveDown(0.2);
        }
      }

      // 3. Fundamentação Normativa (citações de trechos das normas)
      // Só renderiza se o laudo tiver citações adicionadas
      const citacoes = (laudoRef as any).citacoes as Array<{
        normaCodigo: string;
        numeroItem: string;
        tituloItem: string;
        textoCitado: string;
        aplicacao?: string | null;
      }> | undefined;

      if (citacoes && citacoes.length > 0) {
        sectionTitle("3. Fundamentacao Normativa");

        for (let qi = 0; qi < citacoes.length; qi++) {
          const cit = citacoes[qi];

          // Cabeçalho da citação: badge da norma + número e título do item
          checkPageBreak(80);
          const citY = doc.y;

          // Badge da norma (fundo azul claro)
          const badgeText = cit.normaCodigo;
          const badgeW = Math.min(doc.widthOfString(badgeText, { fontSize: 8 }) + 16, 160);
          doc.rect(L, citY, badgeW, 16).fill("#dbeafe");
          doc.fontSize(8).font("Helvetica-Bold").fillColor("#1e40af")
            .text(badgeText, L + 4, citY + 4, { width: badgeW - 8 });

          // Número e título do item
          doc.fontSize(8).font("Helvetica").fillColor(MUTED)
            .text(`Item ${cit.numeroItem} — ${cit.tituloItem}`,
              L + badgeW + 6, citY + 4, { width: CW - badgeW - 6 });

          doc.y = citY + 20;

          // Texto citado (em itálico com borda esquerda azul)
          checkPageBreak(30);
          const textY = doc.y;
          doc.rect(L, textY, 3, 0).fill("#2563eb"); // borda esquerda (desenhada após saber altura)
          doc.fontSize(8.5).font("Helvetica-Oblique").fillColor("#374151")
            .text(`"${cit.textoCitado}"`, L + 10, textY, { width: CW - 10, lineGap: 2 });
          // Desenha borda esquerda retroativamente com a altura real
          const textH = doc.y - textY + 4;
          doc.rect(L, textY - 2, 3, textH).fill("#2563eb");
          doc.y = textY + textH + 4;

          // Aplicação ao caso (se houver)
          if (cit.aplicacao) {
            checkPageBreak(20);
            doc.fontSize(8).font("Helvetica-Bold").fillColor(DARK)
              .text("Aplicacao: ", L + 10, doc.y, { continued: true });
            doc.font("Helvetica").fillColor(MUTED).text(cit.aplicacao, { width: CW - 10 });
          }

          doc.moveDown(0.6);
        }
      }

      // 4. Metodologia e Condições
      sectionTitle("4. Metodologia e Condicoes do Local");
      bodyText("Metodologia", laudoRef.metodologia ?? "");
      doc.moveDown(0.3);
      bodyText("Equipamentos Utilizados", laudoRef.equipamentosUtilizados ?? "");
      doc.moveDown(0.3);
      bodyText("Condicoes do Local", laudoRef.condicoesLocal ?? "");
      doc.moveDown(0.4);

      // 5. Constatações Técnicas
      const constatacoes = laudoRef.constatacoes as Array<{
        item: string; descricao: string; status: string; referenciaNormativa?: string;
      }>;
      if (constatacoes && constatacoes.length > 0) {
        sectionTitle("5. Constatacoes Tecnicas");

        const wItem = CW * 0.18;
        const wDesc = CW * 0.44;
        const wStat = CW * 0.20;
        const wRef  = CW * 0.18;

        checkPageBreak(20);
        const hY = doc.y;
        doc.rect(L, hY, CW, 16).fill("#e2e8f0");
        doc.fontSize(7.5).font("Helvetica-Bold").fillColor(DARK)
          .text("Item", L + 4, hY + 4, { width: wItem })
          .text("Descricao", L + wItem + 4, hY + 4, { width: wDesc })
          .text("Status", L + wItem + wDesc + 4, hY + 4, { width: wStat })
          .text("Referencia", L + wItem + wDesc + wStat + 4, hY + 4, { width: wRef });
        doc.y = hY + 18;

        for (let ci = 0; ci < constatacoes.length; ci++) {
          const c = constatacoes[ci];
          const rowH = 22;
          checkPageBreak(rowH + 4);
          const rowY = doc.y;
          if (ci % 2 === 1) doc.rect(L, rowY, CW, rowH).fill("#f8fafc");
          doc.rect(L, rowY, CW, rowH).stroke("#e2e8f0");
          doc.fontSize(7.5).font("Helvetica").fillColor(DARK)
            .text(c.item || `Item ${ci + 1}`, L + 4, rowY + 7, { width: wItem - 8 });
          doc.text(c.descricao || "—", L + wItem + 4, rowY + 7, { width: wDesc - 8 });
          doc.fillColor(statusConstatacaoColor(c.status))
            .text(statusConstatacaoLabel(c.status), L + wItem + wDesc + 4, rowY + 7, { width: wStat - 8 });
          doc.fillColor(MUTED)
            .text(c.referenciaNormativa || "—", L + wItem + wDesc + wStat + 4, rowY + 7, { width: wRef - 8 });
          doc.y = rowY + rowH + 2;
        }
        doc.moveDown(0.4);
      }

      // 6. Medições
      const medicoes = laudoRef.medicoes as Array<{
        descricao: string; unidade?: string; valorMedido?: string; valorReferencia?: string; resultado?: string;
      }>;
      if (medicoes && medicoes.length > 0) {
        sectionTitle("6. Medicoes e Ensaios");

        checkPageBreak(18);
        const mhY = doc.y;
        doc.rect(L, mhY, CW, 16).fill("#e2e8f0");
        doc.fontSize(7.5).font("Helvetica-Bold").fillColor(DARK)
          .text("Descricao", L + 4, mhY + 4, { width: CW * 0.35 })
          .text("Unid.", L + CW * 0.35 + 4, mhY + 4, { width: CW * 0.10 })
          .text("Medido", L + CW * 0.45 + 4, mhY + 4, { width: CW * 0.15 })
          .text("Referencia", L + CW * 0.60 + 4, mhY + 4, { width: CW * 0.20 })
          .text("Resultado", L + CW * 0.80 + 4, mhY + 4, { width: CW * 0.20 });
        doc.y = mhY + 18;

        for (let mi = 0; mi < medicoes.length; mi++) {
          const m = medicoes[mi];
          const rowH = 20;
          checkPageBreak(rowH + 4);
          const rowY = doc.y;
          if (mi % 2 === 1) doc.rect(L, rowY, CW, rowH).fill("#f8fafc");
          doc.rect(L, rowY, CW, rowH).stroke("#e2e8f0");
          doc.fontSize(7.5).font("Helvetica").fillColor(DARK)
            .text(m.descricao || "—", L + 4, rowY + 6, { width: CW * 0.35 - 8 })
            .text(m.unidade || "—", L + CW * 0.35 + 4, rowY + 6, { width: CW * 0.10 - 8 })
            .text(m.valorMedido || "—", L + CW * 0.45 + 4, rowY + 6, { width: CW * 0.15 - 8 })
            .text(m.valorReferencia || "—", L + CW * 0.60 + 4, rowY + 6, { width: CW * 0.20 - 8 });
          const resColor = m.resultado === "aprovado" ? "#16a34a" : m.resultado === "reprovado" ? "#dc2626" : MUTED;
          doc.fillColor(resColor)
            .text(
              m.resultado === "aprovado" ? "Aprovado" : m.resultado === "reprovado" ? "Reprovado" : "—",
              L + CW * 0.80 + 4, rowY + 6, { width: CW * 0.20 - 8 }
            );
          doc.y = rowY + rowH + 2;
        }
        doc.moveDown(0.4);
      }

      // 6. Registros Fotográficos
      // Cada foto pode ter um modo_layout diferente que altera sua renderização no PDF:
      //  normal        → 2 fotos por linha (padrão)
      //  destaque      → foto única ocupando largura total
      //  destaque_duplo→ original à esquerda + versão anotada à direita
      //  original_zoom → original à esquerda + recorte ampliado à direita
      //  anotada       → usa url_anotada no lugar da url original
      const fotos = laudoRef.fotos as Array<{
        url: string; legenda?: string; comentario?: string; classificacao?: string;
        urlAnotada?: string | null; urlRecorte?: string | null;
        modoLayout?: string;
      }>;

      // Função auxiliar para desenhar uma imagem no PDF
      const drawPhoto = async (
        url: string,
        x: number, y: number,
        w: number, h: number
      ) => {
        const buf = await fetchImageBuffer(url);
        if (buf) {
          try {
            doc.image(buf, x, y, { width: w, height: h, cover: [w, h] });
          } catch {
            doc.rect(x, y, w, h).stroke("#e2e8f0");
            doc.fontSize(7).fillColor(MUTED)
              .text("Imagem indisponivel", x, y + h / 2 - 5, { width: w, align: "center" });
          }
        } else {
          doc.rect(x, y, w, h).stroke("#e2e8f0");
          doc.fontSize(7).fillColor(MUTED)
            .text("Imagem indisponivel", x, y + h / 2 - 5, { width: w, align: "center" });
        }
      };

      // Função auxiliar para badge de classificação
      const drawClassBadge = (fotoClassif: string | undefined, x: number, y: number, w: number) => {
        if (!fotoClassif) return;
        const badgeColor = statusConstatacaoColor(fotoClassif);
        doc.rect(x + w - 70, y + 4, 66, 14).fill(badgeColor);
        doc.fontSize(6.5).font("Helvetica-Bold").fillColor("#ffffff")
          .text(statusConstatacaoLabel(fotoClassif), x + w - 68, y + 8, { width: 62, align: "center" });
      };

      if (fotos && fotos.length > 0) {
        sectionTitle("7. Registros Fotograficos");

        let fi = 0;
        while (fi < fotos.length) {
          const foto = fotos[fi];
          const modo = foto.modoLayout ?? "normal";

          // ── Modo DESTAQUE — foto única em largura total ──────────────────
          if (modo === "destaque") {
            const h = 220;
            checkPageBreak(h + 50);
            const y0 = doc.y;
            await drawPhoto(foto.urlAnotada || foto.url, L, y0, CW, h);
            drawClassBadge(foto.classificacao, L, y0, CW);
            const legendY = y0 + h + 4;
            if (foto.legenda) {
              doc.fontSize(7.5).font("Helvetica-Bold").fillColor(DARK)
                .text(foto.legenda, L, legendY, { width: CW });
            }
            if (foto.comentario) {
              doc.fontSize(7).font("Helvetica").fillColor(MUTED)
                .text(foto.comentario, L, legendY + (foto.legenda ? 11 : 0), { width: CW });
            }
            doc.y = legendY + 30;
            fi += 1;

          // ── Modo DESTAQUE_DUPLO — original à esq + anotada à dir ─────────
          } else if (modo === "destaque_duplo") {
            const half = (CW - 12) / 2;
            const h = 160;
            checkPageBreak(h + 50);
            const y0 = doc.y;
            // Original
            await drawPhoto(foto.url, L, y0, half, h);
            doc.fontSize(6.5).font("Helvetica").fillColor(MUTED)
              .text("Original", L, y0 + h + 2, { width: half, align: "center" });
            // Anotada
            if (foto.urlAnotada) {
              await drawPhoto(foto.urlAnotada, L + half + 12, y0, half, h);
              doc.fontSize(6.5).font("Helvetica").fillColor(MUTED)
                .text("Com anotacoes", L + half + 12, y0 + h + 2, { width: half, align: "center" });
            } else {
              doc.rect(L + half + 12, y0, half, h).stroke("#e2e8f0");
              doc.fontSize(7).fillColor(MUTED)
                .text("(sem anotacoes)", L + half + 12, y0 + h / 2 - 5, { width: half, align: "center" });
            }
            drawClassBadge(foto.classificacao, L, y0, half);
            const legendY = y0 + h + 14;
            if (foto.legenda) {
              doc.fontSize(7.5).font("Helvetica-Bold").fillColor(DARK)
                .text(foto.legenda, L, legendY, { width: CW });
            }
            if (foto.comentario) {
              doc.fontSize(7).font("Helvetica").fillColor(MUTED)
                .text(foto.comentario, L, legendY + (foto.legenda ? 11 : 0), { width: CW });
            }
            doc.y = legendY + 30;
            fi += 1;

          // ── Modo ORIGINAL_ZOOM — original à esq + recorte à dir ──────────
          // Se urlRecorte não está definido ainda (usuário anotou mas não recortou),
          // exibe a foto anotada em largura total como fallback (igual ao modo destaque).
          } else if (modo === "original_zoom") {
            if (!foto.urlRecorte) {
              // Fallback: sem recorte — exibe a versão anotada (ou original) em largura total
              const h = 220;
              checkPageBreak(h + 50);
              const y0 = doc.y;
              await drawPhoto(foto.urlAnotada || foto.url, L, y0, CW, h);
              drawClassBadge(foto.classificacao, L, y0, CW);
              const legendY = y0 + h + 4;
              if (foto.legenda) {
                doc.fontSize(7.5).font("Helvetica-Bold").fillColor(DARK)
                  .text(foto.legenda, L, legendY, { width: CW });
              }
              if (foto.comentario) {
                doc.fontSize(7).font("Helvetica").fillColor(MUTED)
                  .text(foto.comentario, L, legendY + (foto.legenda ? 11 : 0), { width: CW });
              }
              doc.y = legendY + 30;
              fi += 1;
            } else {
              // Fluxo normal: original à esquerda + recorte ampliado à direita
              const half = (CW - 12) / 2;
              const h = 160;
              checkPageBreak(h + 50);
              const y0 = doc.y;
              // Original (ou versão anotada do lado esquerdo)
              await drawPhoto(foto.urlAnotada || foto.url, L, y0, half, h);
              doc.fontSize(6.5).font("Helvetica").fillColor(MUTED)
                .text("Original", L, y0 + h + 2, { width: half, align: "center" });
              // Recorte ampliado com borda vermelha para destacar o detalhe
              await drawPhoto(foto.urlRecorte, L + half + 12, y0, half, h);
              doc.rect(L + half + 12, y0, half, h).stroke("#ef4444");
              doc.fontSize(6.5).font("Helvetica").fillColor("#ef4444")
                .text("Detalhe ampliado", L + half + 12, y0 + h + 2, { width: half, align: "center" });
              drawClassBadge(foto.classificacao, L, y0, half);
              const legendY = y0 + h + 14;
              if (foto.legenda) {
                doc.fontSize(7.5).font("Helvetica-Bold").fillColor(DARK)
                  .text(foto.legenda, L, legendY, { width: CW });
              }
              if (foto.comentario) {
                doc.fontSize(7).font("Helvetica").fillColor(MUTED)
                  .text(foto.comentario, L, legendY + (foto.legenda ? 11 : 0), { width: CW });
              }
              doc.y = legendY + 30;
              fi += 1;
            }

          // ── Modo NORMAL ou ANOTADA — 2 fotos por linha ───────────────────
          } else {
            const photoW = (CW - 12) / 2;
            const photoH = 130;
            checkPageBreak(photoH + 50);
            const rowY = doc.y;

            for (let fj = 0; fj < 2; fj++) {
              const fotoRow = fotos[fi + fj];
              // Para na próxima foto que não seja de 2 colunas
              if (!fotoRow) continue;
              const modoRow = fotoRow.modoLayout ?? "normal";
              if (modoRow !== "normal" && modoRow !== "anotada") continue;

              const xPos = L + fj * (photoW + 12);
              // Usa url_anotada para o modo "anotada", senão a original
              const srcUrl = (modoRow === "anotada" && fotoRow.urlAnotada)
                ? fotoRow.urlAnotada
                : fotoRow.url;

              await drawPhoto(srcUrl, xPos, rowY, photoW, photoH);
              drawClassBadge(fotoRow.classificacao, xPos, rowY, photoW);

              const legendY = rowY + photoH + 4;
              if (fotoRow.legenda) {
                doc.fontSize(7.5).font("Helvetica-Bold").fillColor(DARK)
                  .text(fotoRow.legenda, xPos, legendY, { width: photoW });
              }
              if (fotoRow.comentario) {
                doc.fontSize(7).font("Helvetica").fillColor(MUTED)
                  .text(fotoRow.comentario, xPos, legendY + (fotoRow.legenda ? 11 : 0), { width: photoW });
              }
            }

            doc.y = rowY + photoH + 45;
            doc.moveDown(0.3);
            // Avança 1 ou 2 fotos dependendo de quantas foram consumidas nesta linha
            const proxModo = fotos[fi + 1]?.modoLayout ?? "normal";
            fi += (proxModo === "normal" || proxModo === "anotada") ? 2 : 1;
          }
        }
      }

      // 8. Conclusão
      sectionTitle("8. Conclusao e Parecer Tecnico");
      if (laudoRef.conclusaoParecer) {
        checkPageBreak(50);
        const parecerY = doc.y;
        const color = parecerColor(laudoRef.conclusaoParecer);
        doc.rect(L, parecerY, CW, 44).fill(color);
        doc.fontSize(18).font("Helvetica-Bold").fillColor("#ffffff")
          .text(parecerLabel(laudoRef.conclusaoParecer), L, parecerY + 12, { width: CW, align: "center" });
        doc.y = parecerY + 52;
      }
      if (laudoRef.conclusaoTexto) {
        doc.moveDown(0.3);
        paragraph(laudoRef.conclusaoTexto);
      }

      // 9. Recomendações
      if (laudoRef.recomendacoes) {
        sectionTitle("9. Recomendacoes");
        paragraph(laudoRef.recomendacoes);
      }

      // 10. Assinatura
      sectionTitle("10. Responsabilidade Tecnica");
      checkPageBreak(90);
      const sigY = doc.y + 8;
      doc.moveTo(L + 40, sigY + 50).lineTo(L + 200, sigY + 50).stroke("#1e293b");
      doc.fontSize(8).font("Helvetica-Bold").fillColor(DARK)
        .text(tecnico?.nomeCompleto ?? "Tecnico Responsavel", L + 40, sigY + 54, { width: 200, align: "center" });
      if (tecnico?.registroCrt) {
        doc.fontSize(7.5).font("Helvetica").fillColor(MUTED)
          .text(tecnico.registroCrt, L + 40, sigY + 66, { width: 200, align: "center" });
      }
      if (tecnico?.especialidade) {
        doc.fontSize(7.5).fillColor(MUTED)
          .text(tecnico.especialidade, L + 40, sigY + 78, { width: 200, align: "center" });
      }
      const cidade = tecnico?.cidade ?? "";
      doc.fontSize(7.5).fillColor(MUTED)
        .text(
          `${cidade}${cidade ? " — " : ""}${formatDate(new Date())}`,
          R - 200, sigY + 54, { width: 160, align: "right" }
        );

      // Rodapé de todas as páginas
      const range = doc.bufferedPageRange();
      const total = range.count;
      for (let pi = 0; pi < total; pi++) {
        doc.switchToPage(range.start + pi);
        doc.save();
        doc.rect(0, pageH - 30, pageW, 30).fill("#f1f5f9");
        doc.fontSize(6.5).fillColor(MUTED).font("Helvetica")
          .text(
            "Este laudo foi elaborado por Tecnico em Eletrotecnica registrado no CRT-SP, dentro do escopo legal permitido.",
            L, pageH - 22, { width: CW - 60 }
          )
          .text(`Pagina ${pi + 1} de ${total}`, R - 60, pageH - 22, { width: 60, align: "right" });
        doc.restore();
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
