/**
 * imageCompress.ts — compressão de imagens via Canvas API.
 *
 * Preparada mas desabilitada por padrão (COMPRESS_PHOTOS = false em config/offline.ts).
 * Usar quando o armazenamento local ficar cheio com frequência em campo.
 *
 * Algoritmo: carrega a imagem num <img>, desenha num <canvas> redimensionado
 * e re-exporta como JPEG com a qualidade configurada.
 */

import { COMPRESS_PHOTOS } from "@/config/offline";

/**
 * Comprime um Blob de imagem usando Canvas.
 * Se COMPRESS_PHOTOS=false, retorna o blob original sem modificação.
 *
 * @param blob      Arquivo de imagem original
 * @param maxWidth  Largura máxima em pixels (padrão: 1920)
 * @param quality   Qualidade JPEG de 0 a 1 (padrão: 0.85)
 */
export async function compressImage(
  blob: Blob,
  maxWidth = 1920,
  quality = 0.85
): Promise<Blob> {
  // Flag desligada — retorna sem compressão
  if (!COMPRESS_PHOTOS) return blob;

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);

      // Calcula as novas dimensões mantendo a proporção
      const scale    = Math.min(1, maxWidth / img.width);
      const width    = Math.round(img.width  * scale);
      const height   = Math.round(img.height * scale);

      const canvas = document.createElement("canvas");
      canvas.width  = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Canvas context unavailable")); return; }

      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (result) => result ? resolve(result) : reject(new Error("Falha ao comprimir imagem")),
        "image/jpeg",
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Falha ao carregar imagem para compressão"));
    };

    img.src = url;
  });
}
