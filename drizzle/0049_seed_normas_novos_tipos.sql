-- Seed: normas da biblioteca para os 8 novos tipos de laudo
-- Usa INSERT IGNORE para ser idempotente (pode rodar múltiplas vezes sem duplicar).
-- O campo tiposLaudo é um JSON array de códigos de tipo de laudo que a norma cobre.

-- ── Tubulação Hidráulica ──────────────────────────────────────────────────────

-- Instalação predial de água fria — usada em tubulação, bombas e combate a incêndio
INSERT IGNORE INTO `normasBiblioteca` (`codigo`, `titulo`, `ano`, `tiposLaudo`) VALUES
  ('ABNT NBR 5626',
   'Instalação predial de água fria',
   '1998',
   '["tubulacao_hidraulica","bombas_dagua","combate_incendio"]');

-- Identificação de tubulações por cores — tubulação e combate a incêndio
INSERT IGNORE INTO `normasBiblioteca` (`codigo`, `titulo`, `ano`, `tiposLaudo`) VALUES
  ('ABNT NBR 6493',
   'Emprego de cores para identificação de tubulações',
   '1994',
   '["tubulacao_hidraulica","combate_incendio"]');

-- ── SPDA — Adequação e Execução ───────────────────────────────────────────────

-- Proteção contra descargas atmosféricas — norma principal de SPDA
INSERT IGNORE INTO `normasBiblioteca` (`codigo`, `titulo`, `ano`, `tiposLaudo`) VALUES
  ('ABNT NBR 5419',
   'Proteção contra descargas atmosféricas',
   '2015',
   '["spda_adequacao"]');

-- ── Motores Elétricos e Bombas D'água ─────────────────────────────────────────

-- Máquinas elétricas girantes — motores elétricos e conjunto moto-bomba
INSERT IGNORE INTO `normasBiblioteca` (`codigo`, `titulo`, `ano`, `tiposLaudo`) VALUES
  ('ABNT NBR IEC 60034',
   'Máquinas elétricas girantes',
   '2011',
   '["motores_eletricos","bombas_dagua"]');

-- Projeto de sistema de bombeamento — específico para bombas d'água
INSERT IGNORE INTO `normasBiblioteca` (`codigo`, `titulo`, `ano`, `tiposLaudo`) VALUES
  ('ABNT NBR 12214',
   'Projeto de sistema de bombeamento de água para abastecimento público',
   '1992',
   '["bombas_dagua"]');

-- ── Motores Diesel ────────────────────────────────────────────────────────────

-- Motores de combustão interna — diesel
INSERT IGNORE INTO `normasBiblioteca` (`codigo`, `titulo`, `ano`, `tiposLaudo`) VALUES
  ('NBR 13786',
   'Motores de combustão interna — Especificações gerais',
   '2005',
   '["motores_diesel"]');

-- ── Sistema de Combate a Incêndio ─────────────────────────────────────────────

-- Hidrantes e mangotinhos — sistema predial de combate a incêndio
INSERT IGNORE INTO `normasBiblioteca` (`codigo`, `titulo`, `ano`, `tiposLaudo`) VALUES
  ('ABNT NBR 13714',
   'Sistemas de hidrantes e de mangotinhos para combate a incêndio',
   '2000',
   '["combate_incendio"]');

-- Sprinklers — chuveiros automáticos
INSERT IGNORE INTO `normasBiblioteca` (`codigo`, `titulo`, `ano`, `tiposLaudo`) VALUES
  ('ABNT NBR 10897',
   'Proteção contra incêndio por chuveiros automáticos — Requisitos',
   '2008',
   '["combate_incendio"]');

-- Extintores de incêndio
INSERT IGNORE INTO `normasBiblioteca` (`codigo`, `titulo`, `ano`, `tiposLaudo`) VALUES
  ('ABNT NBR 12693',
   'Sistemas de proteção por extintores de incêndio',
   '2013',
   '["combate_incendio"]');

-- Sinalização de emergência contra incêndio
INSERT IGNORE INTO `normasBiblioteca` (`codigo`, `titulo`, `ano`, `tiposLaudo`) VALUES
  ('ABNT NBR 13434',
   'Sinalização de segurança contra incêndio e pânico',
   '2004',
   '["combate_incendio"]');

-- Iluminação de emergência — combate a incêndio e inspeção predial
INSERT IGNORE INTO `normasBiblioteca` (`codigo`, `titulo`, `ano`, `tiposLaudo`) VALUES
  ('ABNT NBR 10898',
   'Sistema de iluminação de emergência',
   '2013',
   '["combate_incendio","inspecao_predial"]');

-- ── Painéis de Distribuição ───────────────────────────────────────────────────

-- Conjuntos de manobra e controle de baixa tensão
INSERT IGNORE INTO `normasBiblioteca` (`codigo`, `titulo`, `ano`, `tiposLaudo`) VALUES
  ('ABNT NBR IEC 61439',
   'Conjuntos de manobra e controle de baixa tensão',
   '2015',
   '["paineis_distribuicao"]');

-- ── Estruturas Metálicas ──────────────────────────────────────────────────────

-- Projeto de estruturas de concreto e metálicas — norma base
INSERT IGNORE INTO `normasBiblioteca` (`codigo`, `titulo`, `ano`, `tiposLaudo`) VALUES
  ('ABNT NBR 6118',
   'Projeto de estruturas de concreto — Procedimento (também referenciada para metálicas)',
   '2014',
   '["estruturas_metalicas"]');

-- Tintas anticorrosivas para construção civil
INSERT IGNORE INTO `normasBiblioteca` (`codigo`, `titulo`, `ano`, `tiposLaudo`) VALUES
  ('ABNT NBR 7348',
   'Tintas para construção civil — Requisitos e métodos de ensaio',
   '2017',
   '["estruturas_metalicas"]');

-- Parafusos e conexões estruturais
INSERT IGNORE INTO `normasBiblioteca` (`codigo`, `titulo`, `ano`, `tiposLaudo`) VALUES
  ('ABNT NBR 8681',
   'Ações e segurança nas estruturas — Procedimento',
   '2003',
   '["estruturas_metalicas"]');
