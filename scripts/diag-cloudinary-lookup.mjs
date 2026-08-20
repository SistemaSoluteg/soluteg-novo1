#!/usr/bin/env node
/**
 * Diagnóstico read-only: busca metadados de um arquivo no Cloudinary pelo public_id,
 * pra confirmar a URL exata antes de reconectar manualmente a um anexo de OS.
 * Não altera nada — só consulta a Admin API do Cloudinary.
 *
 * Uso (no VPS, dentro do diretório da app — reaproveita o .env real):
 *   node scripts/diag-cloudinary-lookup.mjs <publicId>
 *
 * Exemplo (o "id" costuma vir sem a pasta — o script tenta com e sem "os_attachments/"):
 *   node scripts/diag-cloudinary-lookup.mjs sxwk470rlfdluuvdldi0
 */

import { config } from "dotenv";
config();

import { v2 as cloudinary } from "cloudinary";

const rawId = process.argv[2];
if (!rawId) {
  console.error("Uso: node scripts/diag-cloudinary-lookup.mjs <publicId>");
  process.exit(1);
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const candidates = [rawId, `os_attachments/${rawId}`];

async function main() {
  for (const publicId of candidates) {
    console.log(`\n=== Tentando public_id: "${publicId}" ===`);
    try {
      const result = await cloudinary.api.resource(publicId);
      console.log("✓ Encontrado!");
      console.log({
        public_id: result.public_id,
        secure_url: result.secure_url,
        format: result.format,
        resource_type: result.resource_type,
        bytes: result.bytes,
        width: result.width,
        height: result.height,
        created_at: result.created_at,
        folder: result.folder,
      });
    } catch (e) {
      console.log("✗ Não encontrado com esse public_id:", e.message || e.error?.message);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
