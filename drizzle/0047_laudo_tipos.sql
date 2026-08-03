-- Migration: tabela laudo_tipos — tipos de laudo dinâmicos
-- Substitui o enum fixo da tabela laudos por uma tabela administrável.
-- O campo `aviso_legal` exibe um banner de alerta no formulário e no PDF
-- (usado principalmente para SPDA, onde a emissão do certificado é privativa
-- de Engenheiro Eletricista habilitado).

CREATE TABLE `laudoTipos` (
  `id` int AUTO_INCREMENT NOT NULL,
  -- Código único do tipo, ex: "instalacao_eletrica" — compatível com enum anterior
  `codigo` text NOT NULL,
  -- Rótulo exibido no formulário e no PDF, ex: "Instalação Elétrica"
  `label` text NOT NULL,
  -- Descrição opcional do tipo de laudo
  `descricao` text,
  -- Texto de aviso exibido como banner no formulário e na capa do PDF.
  -- Usado quando o laudo tem restrições legais de emissão (ex: SPDA).
  `aviso_legal` text,
  -- Controla se o tipo aparece nas listagens (soft delete)
  `ativo` boolean NOT NULL DEFAULT true,
  -- Ordem de exibição no select do formulário
  `ordem` int NOT NULL DEFAULT 0,
  CONSTRAINT `laudoTipos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
-- Índice único no código para busca e filtros rápidos
ALTER TABLE `laudoTipos` ADD UNIQUE INDEX `laudoTipos_codigo_unique` (`codigo`(100));

-- ── Seed: 5 tipos existentes (mantém mesmos codigos do enum anterior) ────────

INSERT INTO `laudoTipos` (`codigo`, `label`, `ordem`) VALUES
  ('instalacao_eletrica', 'Instalação Elétrica', 1);

INSERT INTO `laudoTipos` (`codigo`, `label`, `ordem`) VALUES
  ('inspecao_predial', 'Inspeção Predial', 2);

INSERT INTO `laudoTipos` (`codigo`, `label`, `ordem`) VALUES
  ('nr10_nr12', 'NR-10 / NR-12', 3);

INSERT INTO `laudoTipos` (`codigo`, `label`, `ordem`) VALUES
  ('grupo_gerador', 'Grupo Gerador', 4);

INSERT INTO `laudoTipos` (`codigo`, `label`, `ordem`) VALUES
  ('adequacoes', 'Adequações', 5);

-- ── Seed: 8 novos tipos ───────────────────────────────────────────────────────

INSERT INTO `laudoTipos` (`codigo`, `label`, `ordem`) VALUES
  ('tubulacao_hidraulica', 'Tubulação Hidráulica', 6);

-- SPDA: aviso legal obrigatório — a certificação é privativa de Eng. Eletricista
INSERT INTO `laudoTipos` (`codigo`, `label`, `aviso_legal`, `ordem`) VALUES
  ('spda_adequacao',
   'SPDA — Adequação e Execução',
   'ATENÇÃO: Este laudo técnico refere-se exclusivamente à execução de serviços e adequação do sistema de proteção contra descargas atmosféricas (SPDA). Não substitui nem tem a intenção de substituir o laudo e certificado de SPDA elaborado por Engenheiro Eletricista habilitado, conforme exigência da ABNT NBR 5419. A emissão do laudo e certificado de SPDA é atividade privativa de Engenheiro Eletricista registrado no CREA.',
   7);

INSERT INTO `laudoTipos` (`codigo`, `label`, `ordem`) VALUES
  ('motores_eletricos', 'Motores Elétricos', 8);

INSERT INTO `laudoTipos` (`codigo`, `label`, `ordem`) VALUES
  ('bombas_dagua', 'Bombas D''água', 9);

INSERT INTO `laudoTipos` (`codigo`, `label`, `ordem`) VALUES
  ('motores_diesel', 'Motores Diesel', 10);

INSERT INTO `laudoTipos` (`codigo`, `label`, `ordem`) VALUES
  ('combate_incendio', 'Sistema de Combate a Incêndio', 11);

INSERT INTO `laudoTipos` (`codigo`, `label`, `ordem`) VALUES
  ('paineis_distribuicao', 'Painéis de Distribuição', 12);

INSERT INTO `laudoTipos` (`codigo`, `label`, `ordem`) VALUES
  ('estruturas_metalicas', 'Estruturas Metálicas', 13);
