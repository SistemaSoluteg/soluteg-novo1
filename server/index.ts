// ============================================================
// 📁 ARQUIVO: index.ts
// 🎯 FUNÇÃO: Arquivo principal do servidor da JNC Elétrica.
//    Ele "liga" o servidor, registra todas as rotas (endereços
//    que o sistema responde) e conecta o banco de dados.
// ============================================================

import "dotenv/config";        // Carrega variáveis de ambiente (.env), como senhas e chaves secretas
import express from "express"; // Framework que cria o servidor web
import type { Request, Response, NextFunction } from "express";
import { createServer } from "http"; // Cria o servidor HTTP nativo do Node.js
import multer from "multer";   // Biblioteca para receber arquivos (fotos, PDFs) via upload
import { rateLimit } from "express-rate-limit"; // Proteção contra força bruta (Rate Limiting)
import { createExpressMiddleware } from "@trpc/server/adapters/express"; // Integração com tRPC (camada de API tipada)
import { appRouter } from "./routers";                 // Todas as rotas tRPC do sistema
import { createContext } from "./_core/context";       // Contexto compartilhado entre as requisições
import { setupVite, serveStatic } from "./vite";       // Configuração do frontend (React)
import { initMqtt, addSseClient, removeSseClient } from "./mqttService"; // MQTT + SSE
import { verifyToken, verifyClientToken, verifyTechnicianToken } from "./adminAuth"; // Verificação de JWT

// ============================================================
// 🔐 UTILITÁRIO: Extrai e valida o JWT dos cookies da requisição
// Usado pelos middlewares de autenticação abaixo.
// ============================================================

// Parseia o header "Cookie" da requisição HTTP em um objeto chave→valor
function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header.split(";").map(c => {
      const idx = c.indexOf("=");
      return [c.slice(0, idx).trim(), c.slice(idx + 1).trim()];
    })
  );
}

// Middleware: bloqueia requisições sem cookie válido de admin
function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const token = parseCookies(req)["admin_token"];
  if (!token || !verifyToken(token)) {
    return res.status(401).json({ message: "Não autorizado" });
  }
  next();
}

// Middleware: bloqueia requisições sem cookie válido de cliente
function requireClientAuth(req: Request, res: Response, next: NextFunction) {
  const token = parseCookies(req)["client_token"];
  if (!token || !verifyClientToken(token)) {
    return res.status(401).json({ message: "Não autorizado" });
  }
  next();
}

// Middleware: aceita admin OU técnico autenticado
// Usado nos endpoints de laudos (editor de fotos acessível pelos dois tipos)
function requireAdminOrTechAuth(req: Request, res: Response, next: NextFunction) {
  const cookies = parseCookies(req);
  const adminOk = cookies["admin_token"] && verifyToken(cookies["admin_token"]);
  const techOk = cookies["technician_token"] && verifyTechnicianToken(cookies["technician_token"]);
  if (!adminOk && !techOk) {
    return res.status(401).json({ message: "Não autorizado" });
  }
  next();
}

// ============================================================
// 📦 CONFIGURAÇÃO DO MULTER (Gerenciador de Upload de Arquivos)
// O multer intercepta arquivos enviados pelo usuário.
// "memoryStorage" significa que o arquivo fica na RAM
// temporariamente, antes de ser enviado para o Cloudinary.
// ============================================================
// Whitelist de tipos de arquivos permitidos (Segurança MED-06)
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

// Instância do multer com armazenamento em memória e filtro de MIME
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB por arquivo
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo de arquivo não permitido: ${file.mimetype}`));
    }
  },
});

// Configuração de Rate Limiting para logins (Segurança S01)
// Bloqueia após 10 tentativas falhas/sucessos por IP a cada 15 minutos.
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10, // limite de 10 requisições por IP
  message: { message: "Muitas tentativas de login. Tente novamente em 15 minutos." },
  standardHeaders: true, // Retorna info de limite nos headers RateLimit-*
  legacyHeaders: false, // Desabilita headers X-RateLimit-* antigos
});


// ============================================================
// 🚀 FUNÇÃO PRINCIPAL: Inicia o servidor
// Tudo dentro dessa função só roda quando o sistema é ligado.
// ============================================================
async function startServer() {
  const app = express();              // Cria a aplicação Express
  const server = createServer(app);   // Cria o servidor HTTP com base na aplicação

  // ----------------------------------------------------------
  // ⚙️ CONFIGURAÇÕES GLOBAIS
  // Define o tamanho máximo de dados que o servidor aceita.
  // 50mb é importante para fotos de alta resolução não serem
  // bloqueadas antes de chegar na rota de upload.
  // ----------------------------------------------------------
  // Necessário para que o rate limiter identifique o IP real atrás do nginx
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // ============================================================
  // 📸 ROTA: Upload Múltiplo de Fotos/PDFs
  // Endereço: POST /api/work-orders/upload
  //
  // Como funciona:
  //   1. O frontend envia os arquivos nessa rota
  //   2. O multer intercepta e coloca os arquivos na memória RAM
  //   3. Cada arquivo é enviado para o Cloudinary (armazenamento na nuvem)
  //   4. Os links (URLs) dos arquivos são retornados para o frontend salvar
  //
  // upload.array('files', 10) → aceita até 10 arquivos de uma vez,
  // com o nome de campo "files" no formulário.
  // ============================================================
  app.post("/api/work-orders/upload", requireAdminOrTechAuth, upload.array('files', 10), async (req, res) => {
    try {
      // req.files contém os arquivos que chegaram na requisição
      const files = req.files as Express.Multer.File[];

      // Log útil para monitorar no terminal (pm2 logs)
      console.log(`[JNC Upload] Recebidos ${files?.length || 0} arquivos.`);

      // Se não veio nenhum arquivo, retorna erro 400 (Bad Request)
      if (!files || files.length === 0) {
        return res.status(400).json({ success: false, message: "Nenhum arquivo enviado" });
      }

      // Validação de MIME Type (Whitelist) — Segurança MED-06
      const invalidFiles = files.filter(f => !ALLOWED_MIME_TYPES.includes(f.mimetype));
      if (invalidFiles.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Tipo de arquivo não permitido: ${invalidFiles.map(f => f.mimetype).join(", ")}. Apenas imagens (JPG, PNG, WebP) e PDFs são aceitos.`
        });
      }

      // Importa a função de salvar arquivos na nuvem (Cloudinary)
      const { storagePut } = await import("./storage");

      // Sobe TODOS os arquivos ao mesmo tempo (em paralelo) para economizar tempo
      // Promise.all → espera todas as operações terminarem antes de continuar
      const uploadPromises = files.map(async (file) => {
        // Envia o arquivo para o Cloudinary e recebe a URL pública de volta
        const { url, key } = await storagePut(
          file.originalname, // Nome original do arquivo (ex: "foto_quadro.jpg")
          file.buffer,       // Conteúdo do arquivo em bytes (vem da memória RAM)
          file.mimetype      // Tipo do arquivo (ex: "image/jpeg", "application/pdf")
        );

        // Retorna um objeto com as informações do arquivo já salvo na nuvem
        return {
          url,                        // Link público para acessar o arquivo
          key,                        // Identificador único no Cloudinary
          fileName: file.originalname, // Nome original
          fileType: file.mimetype,     // Tipo (imagem, pdf, etc.)
          fileSize: file.size          // Tamanho em bytes
        };
      });

      // Aguarda todos os uploads terminarem
      const results = await Promise.all(uploadPromises);

      // Retorna os dados para o frontend (componente WorkOrderAttachments.tsx)
      // 'urls' é um array com as informações de cada arquivo enviado
      res.json({
        success: true,
        urls: results
      });

    } catch (error: any) {
      // Se qualquer coisa der errado, registra o erro e avisa o frontend
      console.error("Erro no upload JNC:", error);
      res.status(500).json({ success: false, message: error.message || "Erro no processamento" });
    }
  });


  // ============================================================
  // 🖊️ ROTA: Upload de imagem anotada/recortada do editor de fotos dos laudos
  // Endereço: POST /api/laudos/upload-anotada
  //
  // Recebe a imagem em base64 (gerada pelo Fabric.js ou Cropper.js no frontend),
  // converte para Buffer e salva no Cloudinary na pasta "laudo_anotadas".
  // Retorna a URL pública para ser salva no banco (url_anotada ou url_recorte).
  // ============================================================
  app.post("/api/laudos/upload-anotada", requireAdminOrTechAuth, async (req, res) => {
    try {
      const { base64, filename } = req.body as { base64?: string; filename?: string };

      if (!base64 || typeof base64 !== "string") {
        return res.status(400).json({ success: false, message: "Campo base64 obrigatório" });
      }
      if (!filename || typeof filename !== "string") {
        return res.status(400).json({ success: false, message: "Campo filename obrigatório" });
      }

      // Limite de ~10 MB para evitar DoS (base64 de 10 MB ≈ 7,5 MB de imagem)
      if (base64.length > 14_000_000) {
        return res.status(413).json({ success: false, message: "Imagem muito grande (máx 10 MB)" });
      }

      // Remove o prefixo "data:image/...;base64," se presente
      const base64Data = base64.includes(",") ? base64.split(",")[1] : base64;
      const buffer = Buffer.from(base64Data, "base64");

      const { storagePut } = await import("./storage");
      const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const { url } = await storagePut(safeName, buffer, "image/jpeg", "laudo_anotadas");

      res.json({ success: true, url });
    } catch (error: any) {
      console.error("Erro ao salvar imagem anotada:", error);
      res.status(500).json({ success: false, message: error.message || "Erro ao processar imagem" });
    }
  });


  // ============================================================
  // 🗑️ ROTA: Apagar imagem do Cloudinary (usada pelo FotoEditor ao salvar nova versão)
  // Endereço: POST /api/laudos/delete-cloudinary
  //
  // Recebe a URL pública de uma imagem do Cloudinary, extrai o public_id e deleta.
  // Chamada pelo frontend antes de fazer upload de nova versão anotada/recortada,
  // para evitar acúmulo de imagens órfãs no Cloudinary.
  // ============================================================
  app.post("/api/laudos/delete-cloudinary", requireAdminOrTechAuth, async (req, res) => {
    try {
      const { url } = req.body as { url?: string };
      if (!url || typeof url !== "string") {
        return res.json({ success: false });
      }
      // Âncora no número de versão (/v\d+/) — ignora transformações no prefixo (q_auto,f_auto/)
      const match = url.match(/\/v\d+\/(.+)\.[a-z0-9]+$/i);
      if (match?.[1]) {
        const { v2: cloudinary } = await import("cloudinary");
        // Garante credenciais configuradas (o singleton pode não ter sido inicializado ainda)
        cloudinary.config({
          cloud_name: process.env.CLOUDINARY_NAME,
          api_key: process.env.CLOUDINARY_API_KEY,
          api_secret: process.env.CLOUDINARY_API_SECRET,
        });
        await cloudinary.uploader.destroy(match[1]);
      }
      res.json({ success: true });
    } catch (e: any) {
      // Retorna sucesso mesmo em falha — o frontend não deve bloquear por isso
      res.json({ success: false, message: e.message });
    }
  });

  // ============================================================
  // 🧹 ROTA: Limpeza de imagens órfãs no Cloudinary (pasta laudo_anotadas)
  // Endereço: POST /api/admin/laudos/cleanup-cloudinary
  //
  // Compara todos os public_ids ativos no banco (urlAnotada e urlRecorte de laudoFotos)
  // com os arquivos existentes na pasta laudo_anotadas/ do Cloudinary.
  // Deleta qualquer arquivo no Cloudinary que não esteja referenciado no banco.
  // ============================================================
  app.post("/api/admin/laudos/cleanup-cloudinary", requireAdminAuth, async (req, res) => {
    try {
      const { v2: cld } = await import("cloudinary");
      cld.config({
        cloud_name: process.env.CLOUDINARY_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
      });

      const { getDb } = await import("./db");
      const { laudoFotos } = await import("../drizzle/schema");
      const db = await getDb();
      if (!db) return res.status(503).json({ success: false, message: "Banco indisponível" });

      // Coleta todos os public_ids ativos no banco
      const fotos = await db
        .select({ urlAnotada: laudoFotos.urlAnotada, urlRecorte: laudoFotos.urlRecorte })
        .from(laudoFotos);

      const ativos = new Set<string>();
      const extractPublicId = (url: string | null) => {
        if (!url) return;
        const m = url.match(/\/v\d+\/(.+)\.[a-z0-9]+$/i);
        if (m?.[1]) ativos.add(m[1]);
      };
      for (const f of fotos) {
        extractPublicId(f.urlAnotada);
        extractPublicId(f.urlRecorte);
      }

      // Lista todos os arquivos da pasta laudo_anotadas/ no Cloudinary (com paginação)
      const cloudinaryIds: string[] = [];
      let nextCursor: string | undefined;
      do {
        const result: any = await cld.api.resources({
          type: "upload",
          prefix: "laudo_anotadas/",
          max_results: 500,
          next_cursor: nextCursor,
        });
        for (const r of result.resources ?? []) cloudinaryIds.push(r.public_id);
        nextCursor = result.next_cursor;
      } while (nextCursor);

      // Identifica e deleta os órfãos
      const orfaos = cloudinaryIds.filter((id) => !ativos.has(id));
      let deletados = 0;
      let falhas = 0;
      for (const id of orfaos) {
        try {
          await cld.uploader.destroy(id);
          deletados++;
        } catch {
          falhas++;
        }
      }

      res.json({
        success: true,
        totalNoCloudinary: cloudinaryIds.length,
        totalAtivosNoBanco: ativos.size,
        orfaosEncontrados: orfaos.length,
        deletados,
        falhas,
      });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ============================================================
  // 🔑 ROTA: Login do Cliente (Portal do Cliente)
  // Endereço: POST /api/client-login
  //
  // Recebe usuário e senha, valida, e retorna um token de acesso.
  // ============================================================
  app.post("/api/client-login", loginRateLimiter, async (req, res) => {
    try {
      // Valida se os dados enviados têm o formato correto (usuário e senha)
      const { clientLoginSchema } = await import("./validation");
      const validation = clientLoginSchema.safeParse(req.body);

      if (!validation.success) {
        // Dados mal formatados (ex: senha em branco)
        return res.status(400).json({ message: "Dados inválidos", errors: validation.error.flatten() });
      }

      const { username, password } = validation.data;

      // Importa as funções necessárias do banco de dados e autenticação
      const { getClientByUsername, updateClientLastLogin } = await import("./db");
      const { comparePassword } = await import("./adminAuth");

      // Busca o cliente no banco pelo nome de usuário
      const client = await getClientByUsername(username);
      if (!client) {
        // Usuário não existe — usamos mensagem genérica por segurança
        return res.status(401).json({ message: "Usuário ou senha inválidos" });
      }

      // Compara a senha enviada com o hash salvo no banco
      const isValid = await comparePassword(password, client.password);
      if (!isValid) {
        // Senha errada
        return res.status(401).json({ message: "Usuário ou senha inválidos" });
      }

      // Verifica se o cadastro do cliente está ativo
      if (!client.active) {
        return res.status(403).json({ message: "Cliente inativo" });
      }

      // Regra da JNC: clientes do tipo "sem_portal" não podem acessar o portal
      if (client.type === "sem_portal") {
        return res.status(403).json({ message: "Este cliente não possui acesso ao portal." });
      }

      // Atualiza a data/hora do último login no banco
      await updateClientLastLogin(client.id);

      // Gera JWT e define cookie HttpOnly (não acessível via JS)
      const { generateClientToken } = await import("./adminAuth");
      const clientJwt = generateClientToken(client.id);
      res.cookie("client_token", clientJwt, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dias
      });

      // Retorna dados básicos do cliente (clientId mantido para compatibilidade de display)
      res.json({
        success: true,
        token: `client-${client.id}`,
        // jwt: enviado para o app mobile usar como Bearer token
        jwt: clientJwt,
        clientId: client.id,
        name: client.name,
      });

    } catch (error) {
      console.error("Client login error:", error);
      res.status(500).json({ message: "Erro ao fazer login" });
    }
  });

  // Logout do cliente — limpa o cookie JWT
  app.post("/api/client-logout", (_req, res) => {
    res.clearCookie("client_token", { httpOnly: true, sameSite: "strict" });
    res.json({ success: true });
  });


  // ============================================================
  // 🔑 ROTA: Login do Técnico (Portal do Técnico)
  // Endereço: POST /api/technician-login
  // ============================================================
  app.post("/api/technician-login", loginRateLimiter, async (req, res) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ message: "Usuário e senha são obrigatórios" });
      }

      const technicianDb = await import("./technicianDb");
      const { comparePassword } = await import("./adminAuth");

      const technician = await technicianDb.getTechnicianByUsername(username);
      if (!technician) {
        return res.status(401).json({ message: "Usuário ou senha inválidos" });
      }

      const isValid = await comparePassword(password, technician.password);
      if (!isValid) {
        return res.status(401).json({ message: "Usuário ou senha inválidos" });
      }

      if (!technician.active) {
        return res.status(403).json({ message: "Técnico inativo" });
      }

      await technicianDb.updateTechnicianLastLogin(technician.id);

      // Gera JWT e define cookie HttpOnly
      const { generateTechnicianToken } = await import("./adminAuth");
      const techJwt = generateTechnicianToken(technician.id);
      res.cookie("technician_token", techJwt, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dias
      });

      res.json({
        success: true,
        token: `technician-${technician.id}`,
        // jwt: enviado para o app mobile usar como Bearer token
        jwt: techJwt,
        technicianId: technician.id,
        name: technician.name,
      });
    } catch (error) {
      console.error("Technician login error:", error);
      res.status(500).json({ message: "Erro ao fazer login" });
    }
  });

  // Logout do técnico — limpa o cookie JWT
  app.post("/api/technician-logout", (_req, res) => {
    res.clearCookie("technician_token", { httpOnly: true, sameSite: "strict" });
    res.json({ success: true });
  });


  // ============================================================
  // 📄 ROTA: Listar Documentos de um Cliente
  // Endereço: GET /api/client-documents?clientId=123
  //
  // Retorna todos os documentos (contratos, laudos, etc.)
  // vinculados a um cliente específico.
  // ============================================================
  // clientId vem do JWT do cliente autenticado — não aceita clientId externo por query string
  app.get("/api/client-documents", requireClientAuth, async (req, res) => {
    try {
      const cookies = parseCookies(req);
      const payload = verifyClientToken(cookies["client_token"]);
      if (!payload) return res.status(401).json({ message: "Não autorizado" });

      const { getDocumentsByClientId } = await import("./db");
      const documents = await getDocumentsByClientId(payload.clientId);

      res.json(documents);
    } catch (error) {
      res.status(500).json({ message: "Erro ao carregar documentos" });
    }
  });


  // ============================================================
  // 🗑️ ROTA: Deletar um Documento
  // Endereço: DELETE /api/client-documents/456
  //
  // Remove um documento do banco de dados pelo ID.
  // ============================================================
  app.delete("/api/client-documents/:id", requireAdminAuth, async (req, res) => {
    try {
      const { deleteClientDocument } = await import("./db");
      await deleteClientDocument(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Erro ao deletar documento" });
    }
  });


  // ============================================================
  // 📋 ROTA: Criar OS pelo Portal do Cliente
  // Endereço: POST /api/work-orders
  //
  // Recebe a solicitação do cliente, cria a OS no banco e
  // envia notificação via WhatsApp para o admin.
  // ============================================================
  // clientId vem do JWT do cliente autenticado — ignoramos qualquer clientId do body
  app.post("/api/work-orders", requireClientAuth, async (req, res) => {
    try {
      const cookies = parseCookies(req);
      const payload = verifyClientToken(cookies["client_token"]);
      if (!payload) return res.status(401).json({ message: "Não autorizado" });

      const { type, title, description, serviceType, priority } = req.body;
      const clientId = payload.clientId;

      if (!title || !type) {
        return res.status(400).json({ message: "title e type são obrigatórios" });
      }

      const { getClientById } = await import("./db");
      const client = await getClientById(clientId);

      if (!client) {
        return res.status(404).json({ message: "Cliente não encontrado" });
      }

      const workOrdersDb = await import("./workOrdersDb");
      const result = await workOrdersDb.createWorkOrder({
        adminId: client.adminId,
        clientId: clientId,
        type,
        title,
        description: description || null,
        serviceType: serviceType || null,
        priority: priority || "normal",
        status: "aberta",
      } as any);

      const osId = (result as any)?.insertId || (result as any)?.id;

      // Notifica o admin via WhatsApp
      const { sendWhatsappAlert } = await import("./whatsapp");
      const portalUrl = `https://app.soluteg.com.br/gestor/work-orders/${osId}`;
      const msg =
        `🔔 *SOLICITAÇÃO VIA PORTAL - JNC SOLUTEG*\n\n` +
        `🏢 *Condomínio:* ${client.name}\n` +
        `🛠️ *Serviço:* ${title}\n` +
        `📋 *Tipo:* ${String(type).toUpperCase()}\n` +
        `⚡ *Prioridade:* ${String(priority || "normal").toUpperCase()}\n` +
        (description ? `📝 *Descrição:* ${description}\n` : "") +
        `\n🔗 *Ver OS:*\n${portalUrl}`;

      sendWhatsappAlert(msg).catch((e: any) => console.error("Erro no Zap (portal):", e));

      res.json({ success: true, message: "Solicitação enviada com sucesso", id: osId });

    } catch (error: any) {
      console.error("Erro ao criar OS pelo portal:", error);
      res.status(500).json({ message: "Erro ao criar solicitação" });
    }
  });


  // ============================================================
  // 🔍 ROTA: Buscar uma Ordem de Serviço pelo ID
  // Endereço: GET /api/work-orders/789
  //
  // Retorna os dados completos de uma OS específica.
  // ============================================================
  app.get("/api/work-orders/:id", requireAdminAuth, async (req, res) => {
    try {
      const { getWorkOrderById } = await import("./db");
      const workOrder = await getWorkOrderById(parseInt(req.params.id));

      if (!workOrder) {
        // OS não encontrada no banco
        return res.status(404).json({ message: "OS não encontrada" });
      }

      res.json(workOrder);

    } catch (error) {
      res.status(500).json({ message: "Erro ao carregar OS" });
    }
  });


  // ============================================================
  // 📊 ROTA: Métricas do Dashboard Admin
  // Endereço: GET /api/admin-metrics?adminId=X
  // ============================================================
  app.get("/api/admin-metrics", async (req, res) => {
    try {
      const adminId = parseInt(req.query.adminId as string);
      if (!adminId) {
        return res.status(400).json({ message: "adminId é obrigatório" });
      }

      const { getDb } = await import("./db");
      const { clients, clientDocuments, workOrders } = await import("../drizzle/schema");
      const { eq, and, count, sql } = await import("drizzle-orm");

      const db = await getDb();
      if (!db) {
        return res.status(500).json({ message: "Banco de dados indisponível" });
      }

      const [totalClientsResult] = await db
        .select({ total: count() })
        .from(clients)
        .where(eq(clients.adminId, adminId));

      const [activeClientsResult] = await db
        .select({ total: count() })
        .from(clients)
        .where(and(eq(clients.adminId, adminId), eq(clients.active, 1)));

      const [openWorkOrdersResult] = await db
        .select({ total: count() })
        .from(workOrders)
        .where(and(
          eq(workOrders.adminId, adminId),
          sql`${workOrders.status} NOT IN ('concluida', 'cancelada')`
        ));

      const [totalDocumentsResult] = await db
        .select({ total: count() })
        .from(clientDocuments)
        .where(eq(clientDocuments.adminId, adminId));

      res.json({
        totalClients: totalClientsResult?.total ?? 0,
        activeClients: activeClientsResult?.total ?? 0,
        openWorkOrders: openWorkOrdersResult?.total ?? 0,
        totalDocuments: totalDocumentsResult?.total ?? 0,
      });
    } catch (error) {
      console.error("Erro ao carregar métricas:", error);
      res.status(500).json({ message: "Erro ao carregar métricas" });
    }
  });


  // ============================================================
  // 📡 SSE: Atualizações em Tempo Real — Nível de Caixa d'Água
  // Endereço: GET /api/water-tank-sse?clientId=123
  //
  // O frontend abre esta rota e mantém a conexão aberta.
  // Sempre que um sensor publicar via MQTT, o servidor empurra
  // um evento JSON para todos os clientes conectados com aquele clientId.
  // ============================================================
  app.get("/api/water-tank-sse", (req, res) => {
    const clientId = parseInt(req.query.clientId as string);
    if (!clientId) {
      return res.status(400).json({ message: "clientId é obrigatório" });
    }

    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // Evita buffering em proxies (nginx)
    });
    res.flushHeaders();

    // Evento inicial para confirmar conexão
    res.write(`data: ${JSON.stringify({ type: "connected", clientId })}\n\n`);

    addSseClient(clientId, res);

    // Heartbeat a cada 25s para manter a conexão viva
    const heartbeat = setInterval(() => {
      try { res.write(": ping\n\n"); } catch { /* conexão fechada */ }
    }, 25_000);

    req.on("close", () => {
      clearInterval(heartbeat);
      removeSseClient(clientId, res);
    });
  });


  // ============================================================
  // 📝 ROTA: Registro Manual de Nível de Caixa d'Água
  // Endereço: POST /api/water-tank-monitoring
  //
  // Usado enquanto o sensor físico ainda não está instalado,
  // ou para sobrescrever um valor manualmente.
  // ============================================================
  app.post("/api/water-tank-monitoring", requireAdminAuth, async (req, res) => {
    try {
      const { clientId, adminId, tankName, levelPercentage, capacity, notes } = req.body;

      if (!clientId || !tankName || levelPercentage == null) {
        return res.status(400).json({ message: "clientId, tankName e levelPercentage são obrigatórios" });
      }

      const level = Math.max(0, Math.min(100, parseInt(levelPercentage)));
      if (isNaN(level)) {
        return res.status(400).json({ message: "levelPercentage deve ser um número entre 0 e 100" });
      }

      // Resolver adminId se não fornecido
      let resolvedAdminId = adminId;
      if (!resolvedAdminId) {
        const { getClientById } = await import("./db");
        const clientRecord = await getClientById(parseInt(clientId));
        if (!clientRecord) return res.status(404).json({ message: "Cliente não encontrado" });
        resolvedAdminId = clientRecord.adminId;
      }

      const { saveWaterTankReading } = await import("./waterTankDb");
      await saveWaterTankReading({
        clientId: parseInt(clientId),
        adminId: resolvedAdminId,
        tankName,
        currentLevel: level,
      });

      // Broadcast via SSE para atualizar o portal em tempo real
      const { broadcastTankUpdate } = await import("./mqttService");
      broadcastTankUpdate(parseInt(clientId), {
        type: "level_update",
        tankName,
        currentLevel: level,
        capacity: capacity ? parseInt(capacity) : null,
        measuredAt: new Date().toISOString(),
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Erro ao registrar nível:", error);
      res.status(500).json({ message: "Erro ao registrar monitoramento" });
    }
  });


  // ============================================================
  // 📡 INTEGRAÇÃO tRPC (Lógica Principal do Sistema)
  // Endereço: /api/trpc/*
  //
  // O tRPC é a camada que conecta o frontend React com o backend
  // de forma tipada e segura. A maioria das operações do sistema
  // (criar OS, listar clientes, etc.) passa por aqui.
  // ============================================================
  // Rate limiting no login admin via tRPC — Segurança S01
  // O login admin passa por /api/trpc/adminAuth.login (POST), por isso precisa de um
  // middleware separado antes do bloco geral do tRPC.
  app.use("/api/trpc/adminAuth.login", loginRateLimiter);

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,    // Todas as rotas tRPC definidas em ./routers
      createContext,        // Contexto da requisição (usuário logado, banco de dados, etc.)
    })
  );


  // ============================================================
  // 🖥️ CONFIGURAÇÃO DO FRONTEND (React/Vite)
  //
  // Em desenvolvimento: usa o Vite com hot reload (atualiza
  //   automaticamente ao salvar o código)
  // Em produção: serve os arquivos estáticos já compilados
  // ============================================================
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server); // Modo dev com hot reload
  } else {
    serveStatic(app); // Modo produção: arquivos estáticos
  }


  // ============================================================
  // ▶️ INICIA O SERVIDOR
  // Porta lida do ambiente (.env). Em produção sem PORT no .env,
  // cai no padrão 3000. Em staging, PORT=3001 no .env é respeitado.
  // ============================================================
  const PORT = Number(process.env.PORT) || 3000;
  server.listen(PORT, "0.0.0.0", () => {
    console.log("=========================================");
    console.log(`🚀 SERVIDOR SOLUTEG RODANDO`);
    console.log(`- Acesse: http://jnc.soluteg.com.br p/ landing JNC`);
    console.log(`- Acesse: http://app.soluteg.com.br p/ login Admin, Técnico e Clientes`);
    console.log("=========================================");
    initMqtt(); // Inicia o subscriber MQTT (desabilita sozinho se MQTT_BROKER_URL não estiver no .env)
  });
}

// Inicia tudo — se der erro grave na inicialização, mostra no console
startServer().catch(console.error);