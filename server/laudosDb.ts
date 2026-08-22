import { eq, desc, and, like, or, inArray, asc } from "drizzle-orm";
import { v2 as cloudinary } from "cloudinary";
import { getDb } from "./db";
import {
  laudos, laudoTipos, laudoFotos, laudoMedicoes, configuracoesTecnico, laudoTecnicos,
  normasBiblioteca, normaTrechos, laudoCitacoes,
  InsertLaudo, InsertLaudoFoto, InsertLaudoMedicao, InsertConfiguracoesTecnico,
} from "../drizzle/schema";

// ── Cloudinary ────────────────────────────────────────────────────────────────

// Configuração reutilizada de server/storage.ts
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Extrai o public_id de uma URL do Cloudinary e deleta o arquivo.
 * Ex: https://res.cloudinary.com/xxx/image/upload/v123/laudo_fotos/abc.jpg
 *  → public_id = laudo_fotos/abc
 *
 * Não lança erro se falhar — evita bloquear a deleção do banco.
 */
async function deletarDoCloudinary(url: string): Promise<void> {
  try {
    // Âncora no número de versão (/v\d+/) que sempre está presente em URLs do Cloudinary.
    // Isso ignora qualquer prefixo de transformação (ex.: q_auto,f_auto/) que o Cloudinary
    // pode incluir na URL quando o upload usa o parâmetro "transformation".
    // Ex: .../upload/q_auto,f_auto/v1234/laudo_anotadas/file.jpg → "laudo_anotadas/file"
    const match = url.match(/\/v\d+\/(.+)\.[a-z0-9]+$/i);
    if (match?.[1]) {
      await cloudinary.uploader.destroy(match[1]);
    }
  } catch {
    // Falha silenciosa — não bloqueia deleção do registro no banco
  }
}

// ── Número automático ────────────────────────────────────────────────────────

export async function generateLaudoNumero(): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const year = new Date().getFullYear();
  const prefix = `LAU-${year}-`;

  const laudosThisYear = await db
    .select({ numero: laudos.numero })
    .from(laudos)
    .where(like(laudos.numero, `${prefix}%`));

  let maxNumber = 0;
  for (const l of laudosThisYear) {
    if (l.numero) {
      const parts = l.numero.split("-");
      if (parts.length >= 3) {
        const num = parseInt(parts[2] || "0");
        if (num > maxNumber) maxNumber = num;
      }
    }
  }

  return `${prefix}${String(maxNumber + 1).padStart(4, "0")}`;
}

// ── CRUD Laudos ──────────────────────────────────────────────────────────────

export async function listLaudos(params: {
  tenantId: number; // 3.7.2: escopo de tenant obrigatório (fail-closed)
  tipo?: string;
  status?: string;
  clienteId?: number;
  search?: string;
  criadoPor?: number;
  criadoPorTipo?: "admin" | "tecnico";
  tecnicoId?: number; // inclui laudos atribuídos ao técnico
}) {
  const db = await getDb();
  if (!db) return [];

  // Fail-closed: nunca listar laudos sem escopo de tenant.
  if (params.tenantId == null) throw new Error("listLaudos: tenantId obrigatório");

  const { clients } = await import("../drizzle/schema");

  // Se for filtro por técnico, inclui laudos criados OU atribuídos a ele
  let laudoIdsFiltro: number[] | undefined;
  if (params.tecnicoId !== undefined) {
    const atribuidos = await db
      .select({ laudoId: laudoTecnicos.laudoId })
      .from(laudoTecnicos)
      .where(eq(laudoTecnicos.tecnicoId, params.tecnicoId));
    const idsAtribuidos = atribuidos.map((r) => r.laudoId);

    // laudos criados pelo técnico
    const criados = await db
      .select({ id: laudos.id })
      .from(laudos)
      .where(and(eq(laudos.criadoPor, params.tecnicoId), eq(laudos.criadoPorTipo, "tecnico")));
    const idsCriados = criados.map((r) => r.id);

    const todos = Array.from(new Set([...idsAtribuidos, ...idsCriados]));
    laudoIdsFiltro = todos;
  }

  const conditions: any[] = [eq(laudos.tenantId, params.tenantId)];

  if (params.tipo) conditions.push(eq(laudos.tipo, params.tipo as any));
  if (params.status) conditions.push(eq(laudos.status, params.status as any));
  if (params.clienteId) conditions.push(eq(laudos.clienteId, params.clienteId));
  if (params.criadoPor && params.criadoPorTipo !== "tecnico") {
    conditions.push(eq(laudos.criadoPor, params.criadoPor));
  }
  if (params.criadoPorTipo && !params.tecnicoId) {
    conditions.push(eq(laudos.criadoPorTipo, params.criadoPorTipo));
  }
  if (laudoIdsFiltro !== undefined) {
    if (laudoIdsFiltro.length === 0) return [];
    conditions.push(inArray(laudos.id, laudoIdsFiltro));
  }
  if (params.search) {
    conditions.push(
      or(
        like(laudos.numero, `%${params.search}%`),
        like(laudos.titulo, `%${params.search}%`)
      )
    );
  }

  const rows = await db
    .select({
      id: laudos.id,
      numero: laudos.numero,
      tipo: laudos.tipo,
      titulo: laudos.titulo,
      status: laudos.status,
      dataInspecao: laudos.dataInspecao,
      clienteId: laudos.clienteId,
      clienteNome: clients.name,
      criadoPor: laudos.criadoPor,
      criadoPorTipo: laudos.criadoPorTipo,
      createdAt: laudos.createdAt,
    })
    .from(laudos)
    .leftJoin(clients, eq(laudos.clienteId, clients.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(laudos.createdAt));

  return rows;
}

export async function getLaudoById(id: number) {
  const db = await getDb();
  if (!db) return null;

  const { clients } = await import("../drizzle/schema");

  const [laudo] = await db
    .select({
      id: laudos.id,
      tenantId: laudos.tenantId,
      numero: laudos.numero,
      tipo: laudos.tipo,
      titulo: laudos.titulo,
      clienteId: laudos.clienteId,
      clienteNome: clients.name,
      clienteEndereco: clients.address,
      osId: laudos.osId,
      status: laudos.status,
      objeto: laudos.objeto,
      metodologia: laudos.metodologia,
      equipamentosUtilizados: laudos.equipamentosUtilizados,
      condicoesLocal: laudos.condicoesLocal,
      constatacoes: laudos.constatacoes,
      conclusaoParecer: laudos.conclusaoParecer,
      conclusaoTexto: laudos.conclusaoTexto,
      recomendacoes: laudos.recomendacoes,
      normasReferencia: laudos.normasReferencia,
      validadeMeses: laudos.validadeMeses,
      dataInspecao: laudos.dataInspecao,
      criadoPor: laudos.criadoPor,
      criadoPorTipo: laudos.criadoPorTipo,
      createdAt: laudos.createdAt,
      updatedAt: laudos.updatedAt,
    })
    .from(laudos)
    .leftJoin(clients, eq(laudos.clienteId, clients.id))
    .where(eq(laudos.id, id))
    .limit(1);

  if (!laudo) return null;

  const { technicians } = await import("../drizzle/schema");

  const fotos = await db
    .select()
    .from(laudoFotos)
    .where(eq(laudoFotos.laudoId, id))
    .orderBy(laudoFotos.ordem);

  const medicoes = await db
    .select()
    .from(laudoMedicoes)
    .where(eq(laudoMedicoes.laudoId, id))
    .orderBy(laudoMedicoes.ordem);

  const tecnicosRows = await db
    .select({
      id: laudoTecnicos.id,
      tecnicoId: laudoTecnicos.tecnicoId,
      nome: technicians.name,
      atribuidoEm: laudoTecnicos.atribuidoEm,
      atribuidoPor: laudoTecnicos.atribuidoPor,
    })
    .from(laudoTecnicos)
    .leftJoin(technicians, eq(laudoTecnicos.tecnicoId, technicians.id))
    .where(eq(laudoTecnicos.laudoId, id));

  const citacoes = await getLaudoCitacoes(id);

  return {
    ...laudo,
    constatacoes: laudo.constatacoes ? JSON.parse(laudo.constatacoes) : [],
    normasReferencia: laudo.normasReferencia ? JSON.parse(laudo.normasReferencia) : [],
    fotos,
    medicoes,
    tecnicos: tecnicosRows,
    citacoes,
  };
}

export async function createLaudo(data: {
  tenantId: number; // 3.7.2: fail-closed
  tipo: string;
  titulo: string;
  clienteId?: number;
  osId?: number;
  normasReferencia?: any[];
  criadoPor?: number;
  criadoPorTipo?: "admin" | "tecnico";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Fail-closed: nunca gravar laudo sem tenant (evita órfão tenantId=NULL).
  if (data.tenantId == null) throw new Error("createLaudo: tenantId obrigatório");

  const numero = await generateLaudoNumero();

  await db.insert(laudos).values({
    tenantId: data.tenantId,
    numero,
    tipo: data.tipo as any,
    titulo: data.titulo,
    clienteId: data.clienteId ?? null,
    osId: data.osId ?? null,
    normasReferencia: data.normasReferencia ? JSON.stringify(data.normasReferencia) : null,
    criadoPor: data.criadoPor ?? null,
    criadoPorTipo: data.criadoPorTipo ?? null,
    status: "rascunho",
  });

  const [novo] = await db
    .select({ id: laudos.id })
    .from(laudos)
    .where(eq(laudos.numero, numero))
    .limit(1);

  return { id: novo?.id ?? 0, numero };
}

export async function updateLaudo(id: number, data: Partial<{
  tipo: string;
  titulo: string;
  clienteId: number | null;
  osId: number | null;
  status: string;
  objeto: string;
  metodologia: string;
  equipamentosUtilizados: string;
  condicoesLocal: string;
  constatacoes: any[];
  conclusaoParecer: string;
  conclusaoTexto: string;
  recomendacoes: string;
  normasReferencia: any[];
  validadeMeses: number;
  dataInspecao: Date | null;
}>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updateData: Record<string, any> = { ...data };

  if (data.constatacoes !== undefined) {
    updateData.constatacoes = JSON.stringify(data.constatacoes);
  }
  if (data.normasReferencia !== undefined) {
    updateData.normasReferencia = JSON.stringify(data.normasReferencia);
  }

  await db.update(laudos).set(updateData as any).where(eq(laudos.id, id));
}

export async function deleteLaudo(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Deleta cada foto individualmente via removeLaudoFoto, que já cuida de
  // limpar todas as versões (url, urlAnotada, urlRecorte) do Cloudinary antes
  // de deletar a linha do banco — evita duplicação de lógica de cleanup.
  const fotosDoLaudo = await db
    .select({ id: laudoFotos.id })
    .from(laudoFotos)
    .where(eq(laudoFotos.laudoId, id));

  for (const f of fotosDoLaudo) {
    await removeLaudoFoto(f.id);
  }

  await db.delete(laudoMedicoes).where(eq(laudoMedicoes.laudoId, id));
  await db.delete(laudoTecnicos).where(eq(laudoTecnicos.laudoId, id));
  // LAUDO-01: cascade esquecia as citações de norma vinculadas ao laudo.
  await db.delete(laudoCitacoes).where(eq(laudoCitacoes.laudoId, id));
  await db.delete(laudos).where(eq(laudos.id, id));
}

// ── Fotos ────────────────────────────────────────────────────────────────────

export async function getLaudoFotoById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const [foto] = await db
    .select()
    .from(laudoFotos)
    .where(eq(laudoFotos.id, id))
    .limit(1);
  return foto ?? null;
}

export async function addLaudoFoto(data: {
  tenantId: number; // 3.7.2: fail-closed
  laudoId: number;
  url: string;
  legenda?: string;
  comentario?: string;
  classificacao?: "conforme" | "nao_conforme" | "atencao";
  ordem?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (data.tenantId == null) throw new Error("addLaudoFoto: tenantId obrigatório");

  await db.insert(laudoFotos).values({
    tenantId: data.tenantId,
    laudoId: data.laudoId,
    url: data.url,
    legenda: data.legenda ?? null,
    comentario: data.comentario ?? null,
    classificacao: data.classificacao ?? null,
    ordem: data.ordem ?? 0,
  });
}

export async function updateLaudoFoto(id: number, data: Partial<{
  legenda: string;
  comentario: string;
  classificacao: "conforme" | "nao_conforme" | "atencao";
  ordem: number;
  // Campos do editor avançado de fotos (Etapa 3)
  urlAnotada: string;
  urlRecorte: string;
  modoLayout: string;
  anotacoesJson: string;
}>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(laudoFotos).set(data as any).where(eq(laudoFotos.id, id));
}

export async function removeLaudoFoto(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Busca a foto antes de deletar para obter as URLs do Cloudinary
  const [foto] = await db
    .select()
    .from(laudoFotos)
    .where(eq(laudoFotos.id, id))
    .limit(1);

  if (foto) {
    // Deleta todas as versões da foto no Cloudinary em paralelo
    const urlsParaDeletar = [
      foto.url,
      foto.urlAnotada,
      foto.urlRecorte,
    ].filter(Boolean) as string[];

    await Promise.all(urlsParaDeletar.map(deletarDoCloudinary));
  }

  await db.delete(laudoFotos).where(eq(laudoFotos.id, id));
}

// ── Medições ─────────────────────────────────────────────────────────────────

export async function addLaudoMedicao(data: {
  tenantId: number; // 3.7.2: fail-closed
  laudoId: number;
  descricao: string;
  unidade?: string;
  valorMedido?: string;
  valorReferencia?: string;
  resultado?: "aprovado" | "reprovado";
  ordem?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (data.tenantId == null) throw new Error("addLaudoMedicao: tenantId obrigatório");

  await db.insert(laudoMedicoes).values({
    tenantId: data.tenantId,
    laudoId: data.laudoId,
    descricao: data.descricao,
    unidade: data.unidade ?? null,
    valorMedido: data.valorMedido ?? null,
    valorReferencia: data.valorReferencia ?? null,
    resultado: data.resultado ?? null,
    ordem: data.ordem ?? 0,
  });
}

export async function getLaudoMedicaoById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const [medicao] = await db
    .select()
    .from(laudoMedicoes)
    .where(eq(laudoMedicoes.id, id))
    .limit(1);
  return medicao ?? null;
}

export async function removeLaudoMedicao(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(laudoMedicoes).where(eq(laudoMedicoes.id, id));
}

// ── Técnicos atribuídos ──────────────────────────────────────────────────────

export async function getLaudoTecnicos(laudoId: number) {
  const db = await getDb();
  if (!db) return [];

  const { technicians } = await import("../drizzle/schema");

  const rows = await db
    .select({
      id: laudoTecnicos.id,
      tecnicoId: laudoTecnicos.tecnicoId,
      nome: technicians.name,
      atribuidoEm: laudoTecnicos.atribuidoEm,
      atribuidoPor: laudoTecnicos.atribuidoPor,
    })
    .from(laudoTecnicos)
    .leftJoin(technicians, eq(laudoTecnicos.tecnicoId, technicians.id))
    .where(eq(laudoTecnicos.laudoId, laudoId));

  return rows;
}

export async function atribuirTecnico(data: {
  tenantId: number; // 3.7.2: fail-closed
  laudoId: number;
  tecnicoId: number;
  atribuidoPor?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (data.tenantId == null) throw new Error("atribuirTecnico: tenantId obrigatório");

  // INSERT IGNORE equivalente — tenta inserir, ignora duplicata
  try {
    await db.insert(laudoTecnicos).values({
      tenantId: data.tenantId,
      laudoId: data.laudoId,
      tecnicoId: data.tecnicoId,
      atribuidoPor: data.atribuidoPor ?? null,
    });
  } catch (e: any) {
    // errno 1062 = Duplicate entry
    if (e.errno !== 1062) throw e;
  }
}

export async function removerTecnico(laudoId: number, tecnicoId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .delete(laudoTecnicos)
    .where(and(eq(laudoTecnicos.laudoId, laudoId), eq(laudoTecnicos.tecnicoId, tecnicoId)));
}

// ── Configurações do Técnico ─────────────────────────────────────────────────

// 3.7.2: configuracoesTecnico tem tenantId — é config por tenant (cabeçalho do
// PDF, CRT, empresa), NÃO catálogo compartilhado. Escopar por tenant.
export async function getConfiguracoesTecnico(tenantId: number) {
  const db = await getDb();
  if (!db) return null;

  if (tenantId == null) throw new Error("getConfiguracoesTecnico: tenantId obrigatório");

  const [config] = await db
    .select()
    .from(configuracoesTecnico)
    .where(eq(configuracoesTecnico.tenantId, tenantId))
    .orderBy(configuracoesTecnico.id)
    .limit(1);

  return config ?? null;
}

export async function upsertConfiguracoesTecnico(tenantId: number, data: {
  nomeCompleto?: string;
  registroCrt?: string;
  especialidade?: string;
  empresa?: string;
  cidade?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (tenantId == null) throw new Error("upsertConfiguracoesTecnico: tenantId obrigatório");

  const existing = await getConfiguracoesTecnico(tenantId);
  if (existing) {
    await db
      .update(configuracoesTecnico)
      .set(data as any)
      .where(eq(configuracoesTecnico.id, existing.id));
  } else {
    await db.insert(configuracoesTecnico).values({ ...data, tenantId } as any);
  }
}

// ── Tipos de laudo dinâmicos ─────────────────────────────────────────────────

/**
 * Retorna todos os tipos de laudo ativos, ordenados pelo campo `ordem`.
 * Usado pelos formulários (AdminLaudoForm, TecnicoLaudoForm) para popular
 * o select de tipo dinamicamente — sem precisar alterar código ao criar tipos novos.
 */
export async function listLaudoTipos() {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(laudoTipos)
    .where(eq(laudoTipos.ativo, 1 as any))
    .orderBy(asc(laudoTipos.ordem));
}

// ── Biblioteca de normas ─────────────────────────────────────────────────────

// ── Trechos normativos ───────────────────────────────────────────────────────

/**
 * Lista todos os trechos ativos de uma norma específica, ordenados por número do item.
 */
export async function listNormaTrechos(normaId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(normaTrechos)
    .where(and(eq(normaTrechos.normaId, normaId), eq(normaTrechos.ativa, 1 as any)))
    .orderBy(asc(normaTrechos.numeroItem));
}

/**
 * Busca trechos por palavra-chave em texto, tituloItem e palavrasChave.
 * Faz JOIN com normasBiblioteca para retornar codigo e titulo da norma.
 * Se tipoLaudo for informado, filtra apenas normas compatíveis.
 */
export async function searchNormaTrechos(params: {
  busca: string;
  tipoLaudo?: string;
}) {
  const db = await getDb();
  if (!db) return [];

  const termoBusca = `%${params.busca}%`;

  const rows = await db
    .select({
      id: normaTrechos.id,
      normaId: normaTrechos.normaId,
      normaCodigo: normasBiblioteca.codigo,
      normaTitulo: normasBiblioteca.titulo,
      normaTiposLaudo: normasBiblioteca.tiposLaudo,
      numeroItem: normaTrechos.numeroItem,
      tituloItem: normaTrechos.tituloItem,
      texto: normaTrechos.texto,
      palavrasChave: normaTrechos.palavrasChave,
    })
    .from(normaTrechos)
    .innerJoin(normasBiblioteca, eq(normaTrechos.normaId, normasBiblioteca.id))
    .where(
      and(
        eq(normaTrechos.ativa, 1 as any),
        eq(normasBiblioteca.ativa, 1 as any),
        or(
          like(normaTrechos.texto, termoBusca),
          like(normaTrechos.tituloItem, termoBusca),
          like(normaTrechos.palavrasChave, termoBusca),
          like(normaTrechos.numeroItem, termoBusca),
          like(normasBiblioteca.codigo, termoBusca),
          like(normasBiblioteca.titulo, termoBusca)
        )
      )
    )
    .orderBy(asc(normasBiblioteca.codigo), asc(normaTrechos.numeroItem));

  // Filtra por tipo de laudo em memória (tiposLaudo é JSON array)
  if (!params.tipoLaudo) return rows;
  return rows.filter((r) => {
    try {
      const tipos: string[] = JSON.parse(r.normaTiposLaudo);
      return tipos.includes(params.tipoLaudo!);
    } catch {
      return true; // se JSON inválido, inclui o resultado
    }
  });
}

/**
 * Retorna todos os trechos ativos da biblioteca com código e título da norma.
 * Usado pela IA para ter contexto completo sem filtro de palavra-chave.
 */
export async function listAllNormaTrechosParaIA() {
  const db = await getDb();
  if (!db) return [];

  try {
    return await db
      .select({
        id: normaTrechos.id,
        normaId: normaTrechos.normaId,
        normaCodigo: normasBiblioteca.codigo,
        normaTitulo: normasBiblioteca.titulo,
        numeroItem: normaTrechos.numeroItem,
        tituloItem: normaTrechos.tituloItem,
        texto: normaTrechos.texto,
        palavrasChave: normaTrechos.palavrasChave,
      })
      .from(normaTrechos)
      .innerJoin(normasBiblioteca, eq(normaTrechos.normaId, normasBiblioteca.id))
      .where(and(eq(normaTrechos.ativa, 1 as any), eq(normasBiblioteca.ativa, 1 as any)))
      .orderBy(asc(normasBiblioteca.codigo), asc(normaTrechos.numeroItem));
  } catch {
    return []; // tabela pode não existir se migrations não foram executadas
  }
}

// ── Citações dos laudos ──────────────────────────────────────────────────────

/**
 * Retorna todas as citações de um laudo, ordenadas por `ordem`.
 * Retorna [] em caso de erro (ex: tabela não existe se migration ainda não foi executada).
 */
export async function getLaudoCitacoes(laudoId: number) {
  const db = await getDb();
  if (!db) return [];

  try {
    return await db
      .select()
      .from(laudoCitacoes)
      .where(eq(laudoCitacoes.laudoId, laudoId))
      .orderBy(asc(laudoCitacoes.ordem), asc(laudoCitacoes.createdAt));
  } catch {
    // Tabela pode não existir ainda se as migrations não foram executadas
    return [];
  }
}

export async function getLaudoCitacaoById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const [citacao] = await db
    .select()
    .from(laudoCitacoes)
    .where(eq(laudoCitacoes.id, id))
    .limit(1);
  return citacao ?? null;
}

/**
 * Adiciona uma citação normativa a um laudo.
 * Retorna o id inserido.
 */
export async function addLaudoCitacao(data: {
  tenantId: number; // 3.7.2: fail-closed
  laudoId: number;
  trechoId?: number;
  normaCodigo: string;
  numeroItem: string;
  tituloItem: string;
  textoCitado: string;
  aplicacao?: string;
  ordem?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (data.tenantId == null) throw new Error("addLaudoCitacao: tenantId obrigatório");

  await db.insert(laudoCitacoes).values({
    tenantId: data.tenantId,
    laudoId: data.laudoId,
    trechoId: data.trechoId ?? null,
    normaCodigo: data.normaCodigo,
    numeroItem: data.numeroItem,
    tituloItem: data.tituloItem,
    textoCitado: data.textoCitado,
    aplicacao: data.aplicacao ?? null,
    ordem: data.ordem ?? 0,
  });

  // Retorna a citação recém-criada para o frontend poder atualizar o estado local
  const [nova] = await db
    .select()
    .from(laudoCitacoes)
    .where(eq(laudoCitacoes.laudoId, data.laudoId))
    .orderBy(desc(laudoCitacoes.createdAt))
    .limit(1);

  return nova;
}

/**
 * Atualiza campos editáveis de uma citação (textoCitado, aplicacao, ordem).
 */
export async function updateLaudoCitacao(id: number, data: Partial<{
  textoCitado: string;
  aplicacao: string;
  ordem: number;
}>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(laudoCitacoes).set(data as any).where(eq(laudoCitacoes.id, id));
}

/**
 * Remove uma citação pelo id.
 */
export async function removeLaudoCitacao(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(laudoCitacoes).where(eq(laudoCitacoes.id, id));
}

export async function listNormasBiblioteca(tipoLaudo?: string) {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select()
    .from(normasBiblioteca)
    .where(eq(normasBiblioteca.ativa, 1 as any))
    .orderBy(asc(normasBiblioteca.codigo));

  if (!tipoLaudo) return rows;

  return rows.filter((n) => {
    try {
      const tipos: string[] = JSON.parse(n.tiposLaudo);
      return tipos.includes(tipoLaudo);
    } catch {
      return false;
    }
  });
}
