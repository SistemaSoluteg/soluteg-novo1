-- Migration: adiciona campos do editor de fotos na tabela laudoFotos
-- url_anotada: URL da imagem após anotações salvas no Cloudinary
-- url_recorte: URL do recorte/zoom salvo no Cloudinary
-- modo_layout: como a foto aparece no PDF (normal, destaque, destaque_duplo, original_zoom, anotada)
-- anotacoes_json: JSON das formas desenhadas no Fabric.js (para reedição futura)

ALTER TABLE `laudoFotos` ADD `url_anotada` text;
--> statement-breakpoint
ALTER TABLE `laudoFotos` ADD `url_recorte` text;
--> statement-breakpoint
ALTER TABLE `laudoFotos` ADD `modo_layout` varchar(30) NOT NULL DEFAULT 'normal';
--> statement-breakpoint
ALTER TABLE `laudoFotos` ADD `anotacoes_json` text;
