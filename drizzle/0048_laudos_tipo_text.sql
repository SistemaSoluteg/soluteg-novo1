-- Migration: altera coluna tipo de laudos de ENUM para TEXT
-- Motivo: com a criação de laudoTipos (tabela dinâmica), novos tipos podem ser
-- cadastrados sem alterar o schema do banco. O ENUM fixo impedia isso.
-- Os dados existentes são preservados — os valores textuais são compatíveis.
--
-- Também adiciona tipo_id (FK opcional para laudoTipos) para relacionamento
-- estruturado, mantendo tipo (text) para compatibilidade com registros já existentes.

-- Altera o tipo da coluna de ENUM para TEXT
-- Valores existentes ('instalacao_eletrica', 'inspecao_predial', 'nr10_nr12',
-- 'grupo_gerador', 'adequacoes') continuam válidos sem necessidade de migração de dados.
ALTER TABLE `laudos` MODIFY COLUMN `tipo` text NOT NULL;
--> statement-breakpoint

-- Adiciona FK opcional para relacionar com a tabela de tipos dinâmicos.
-- NULL para registros antigos — preenchido ao criar/editar laudos novos.
ALTER TABLE `laudos` ADD `tipo_id` int;
--> statement-breakpoint

-- Relaciona tipo_id com laudoTipos sem CASCADE DELETE intencional:
-- deletar um tipo não deve deletar os laudos existentes.
ALTER TABLE `laudos` ADD CONSTRAINT `laudos_tipo_id_fk`
  FOREIGN KEY (`tipo_id`) REFERENCES `laudoTipos`(`id`) ON DELETE SET NULL;
--> statement-breakpoint

-- Preenche tipo_id para todos os laudos existentes com base no campo texto tipo.
-- Usa subquery para buscar o id correspondente na nova tabela.
UPDATE `laudos` l
  INNER JOIN `laudoTipos` t ON t.codigo = l.tipo
  SET l.tipo_id = t.id
  WHERE l.tipo_id IS NULL;
