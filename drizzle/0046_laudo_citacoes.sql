-- Migration: tabela de citações normativas associadas a cada laudo
-- Permite inserir trechos da biblioteca (trechoId nullable) ou citações manuais livres.
-- Campos desnormalizados (normaCodigo, numeroItem, tituloItem, textoCitado) garantem
-- que o PDF seja gerado corretamente mesmo se a norma for editada ou removida da biblioteca.

CREATE TABLE `laudoCitacoes` (
  `id` int AUTO_INCREMENT NOT NULL,
  -- FK para o laudo ao qual a citação pertence
  `laudoId` int NOT NULL,
  -- FK opcional para a biblioteca de trechos (null = citação manual)
  `trechoId` int,
  -- Dados desnormalizados para geração do PDF independente da biblioteca
  `normaCodigo` varchar(150) NOT NULL,
  `numeroItem` varchar(50) NOT NULL,
  `tituloItem` text NOT NULL,
  `textoCitado` text NOT NULL,
  -- Comentário do técnico explicando como a citação se aplica ao caso concreto
  `aplicacao` text,
  -- Posição da citação na lista (para ordenação manual via ↑↓)
  `ordem` int NOT NULL DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `laudoCitacoes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
-- Cascade: remover o laudo remove todas as suas citações
ALTER TABLE `laudoCitacoes` ADD CONSTRAINT `laudoCitacoes_laudoId_fk`
  FOREIGN KEY (`laudoId`) REFERENCES `laudos`(`id`) ON DELETE CASCADE;
--> statement-breakpoint
-- Sem cascade: remover um trecho da biblioteca não remove as citações já feitas
-- (o texto foi desnormalizado, então o PDF continua funcionando)
ALTER TABLE `laudoCitacoes` ADD CONSTRAINT `laudoCitacoes_trechoId_fk`
  FOREIGN KEY (`trechoId`) REFERENCES `normaTrechos`(`id`) ON DELETE SET NULL;
