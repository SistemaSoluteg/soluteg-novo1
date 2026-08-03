-- Migration: tabela de trechos normativos citáveis
-- Cada trecho pertence a uma norma da biblioteca (normas_biblioteca)
-- e pode ser buscado por palavra-chave e inserido diretamente no laudo

CREATE TABLE `normaTrechos` (
  `id` int AUTO_INCREMENT NOT NULL,
  -- FK para normas_biblioteca (cascade delete: remover norma remove seus trechos)
  `normaId` int NOT NULL,
  -- Ex: "6.2.1", "item 10.3.4"
  `numeroItem` varchar(50) NOT NULL,
  -- Ex: "Proteção contra choques elétricos"
  `tituloItem` text NOT NULL,
  -- O trecho citável em si
  `texto` text NOT NULL,
  -- JSON array de strings para busca por palavra-chave
  -- Ex: '["aterramento","proteção","contato indireto"]'
  -- Nota: TEXT não suporta DEFAULT no MySQL — valor sempre fornecido no INSERT
  `palavrasChave` text NOT NULL,
  `ativa` tinyint NOT NULL DEFAULT 1,
  CONSTRAINT `normaTrechos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `normaTrechos` ADD CONSTRAINT `normaTrechos_normaId_fk`
  FOREIGN KEY (`normaId`) REFERENCES `normasBiblioteca`(`id`) ON DELETE CASCADE;

-- ── Seed: trechos das principais normas ─────────────────────────────────────
-- Usamos subquery em INSERT...SELECT para buscar os IDs pelo campo `codigo`,
-- evitando depender de IDs fixos que podem variar entre ambientes.

-- ── ABNT NBR 5410 ────────────────────────────────────────────────────────────
INSERT INTO `normaTrechos` (`normaId`, `numeroItem`, `tituloItem`, `texto`, `palavrasChave`)
SELECT n.id,
  '4.1.1',
  'Proteção contra choques elétricos — Princípio geral',
  'As pessoas e os animais devem ser protegidos contra perigos que possam surgir por contato com partes vivas da instalação.',
  '["choque","proteção","contato","partes vivas"]'
FROM `normasBiblioteca` n WHERE n.codigo = 'ABNT NBR 5410' LIMIT 1;

INSERT INTO `normaTrechos` (`normaId`, `numeroItem`, `tituloItem`, `texto`, `palavrasChave`)
SELECT n.id,
  '5.1.3.1',
  'Aterramento — Obrigatoriedade',
  'Toda instalação elétrica deve ser dotada de aterramento de proteção, ao qual devem ser conectadas as massas de todos os equipamentos elétricos.',
  '["aterramento","proteção","massas","equipamentos"]'
FROM `normasBiblioteca` n WHERE n.codigo = 'ABNT NBR 5410' LIMIT 1;

INSERT INTO `normaTrechos` (`normaId`, `numeroItem`, `tituloItem`, `texto`, `palavrasChave`)
SELECT n.id,
  '6.2.1',
  'Quadros de distribuição — Requisitos gerais',
  'Os quadros de distribuição devem ser instalados em locais de fácil acesso, ventilados e protegidos contra danos mecânicos, umidade e temperaturas excessivas.',
  '["quadro","distribuição","acesso","ventilação"]'
FROM `normasBiblioteca` n WHERE n.codigo = 'ABNT NBR 5410' LIMIT 1;

INSERT INTO `normaTrechos` (`normaId`, `numeroItem`, `tituloItem`, `texto`, `palavrasChave`)
SELECT n.id,
  '6.3.4',
  'Identificação de condutores e circuitos',
  'Os condutores devem ser identificados de forma permanente e inequívoca, de modo a permitir a localização de qualquer circuito, ponto de utilização ou dispositivo de proteção.',
  '["identificação","condutores","circuitos","cores"]'
FROM `normasBiblioteca` n WHERE n.codigo = 'ABNT NBR 5410' LIMIT 1;

INSERT INTO `normaTrechos` (`normaId`, `numeroItem`, `tituloItem`, `texto`, `palavrasChave`)
SELECT n.id,
  '5.2.2',
  'Condutores — Seção mínima',
  'A seção dos condutores deve ser determinada de modo que a queda de tensão entre a origem da instalação e qualquer ponto de utilização não seja superior aos valores estipulados.',
  '["condutor","seção","bitola","queda de tensão"]'
FROM `normasBiblioteca` n WHERE n.codigo = 'ABNT NBR 5410' LIMIT 1;

-- ── NR-10 ─────────────────────────────────────────────────────────────────────
-- NR-10 pode estar cadastrada como "NR-10" ou "NR-10/NR-12" — tentamos ambos
INSERT INTO `normaTrechos` (`normaId`, `numeroItem`, `tituloItem`, `texto`, `palavrasChave`)
SELECT n.id,
  '10.2.4',
  'Prontuário das instalações elétricas',
  'Nos locais onde se desenvolvem atividades com instalações elétricas deve existir o prontuário de instalações elétricas, contendo: conjunto de procedimentos e instruções técnicas e administrativas de segurança e saúde, implantadas e relacionadas a esta NR e descrição dos sistemas elétricos.',
  '["prontuário","documentação","procedimentos","NR-10"]'
FROM `normasBiblioteca` n WHERE n.codigo LIKE '%NR-10%' LIMIT 1;

INSERT INTO `normaTrechos` (`normaId`, `numeroItem`, `tituloItem`, `texto`, `palavrasChave`)
SELECT n.id,
  '10.6.1',
  'Bloqueio e etiquetagem (LOTO)',
  'Nas intervenções em instalações elétricas devem ser adotadas medidas preventivas de controle para garantir a segurança e saúde dos trabalhadores, através de prontuário, procedimentos, bloqueio e etiquetagem.',
  '["bloqueio","etiquetagem","LOTO","intervenção"]'
FROM `normasBiblioteca` n WHERE n.codigo LIKE '%NR-10%' LIMIT 1;

INSERT INTO `normaTrechos` (`normaId`, `numeroItem`, `tituloItem`, `texto`, `palavrasChave`)
SELECT n.id,
  '10.7.1',
  'Sinalização de segurança',
  'Os serviços em instalações elétricas devem ser precedidos de ordem de serviço específica, aprovada por profissional habilitado, contendo no mínimo o tipo de serviço, local de realização, referências e descrição de serviço.',
  '["sinalização","segurança","ordem de serviço"]'
FROM `normasBiblioteca` n WHERE n.codigo LIKE '%NR-10%' LIMIT 1;

INSERT INTO `normaTrechos` (`normaId`, `numeroItem`, `tituloItem`, `texto`, `palavrasChave`)
SELECT n.id,
  '10.8.1',
  'EPI para trabalhos elétricos',
  'Para atividades em instalações elétricas deve ser garantido ao trabalhador EPI adequado ao risco, em perfeito estado de conservação e funcionamento.',
  '["EPI","equipamento proteção","trabalhador"]'
FROM `normasBiblioteca` n WHERE n.codigo LIKE '%NR-10%' LIMIT 1;

-- ── NR-12 ─────────────────────────────────────────────────────────────────────
INSERT INTO `normaTrechos` (`normaId`, `numeroItem`, `tituloItem`, `texto`, `palavrasChave`)
SELECT n.id,
  '12.5.1',
  'Proteções em máquinas e equipamentos',
  'As máquinas e equipamentos devem ter dispositivos de partida, acionamento e parada instalados em posições que não exponham o operador a situações de risco.',
  '["proteção","máquinas","equipamentos","acionamento"]'
FROM `normasBiblioteca` n WHERE n.codigo LIKE '%NR-12%' LIMIT 1;

INSERT INTO `normaTrechos` (`normaId`, `numeroItem`, `tituloItem`, `texto`, `palavrasChave`)
SELECT n.id,
  '12.6.1',
  'Dispositivos de parada de emergência',
  'As máquinas devem ser dotadas de dispositivos de parada de emergência, que quando acionados devem: eliminar o risco de acidente e não gerar riscos adicionais.',
  '["parada emergência","dispositivo","risco","acidente"]'
FROM `normasBiblioteca` n WHERE n.codigo LIKE '%NR-12%' LIMIT 1;

-- ── ABNT NBR 7094 (Grupo Gerador) ─────────────────────────────────────────────
INSERT INTO `normaTrechos` (`normaId`, `numeroItem`, `tituloItem`, `texto`, `palavrasChave`)
SELECT n.id,
  '5.1',
  'Condições gerais de operação',
  'O gerador deve operar satisfatoriamente sob as condições normais de serviço definidas nesta norma, incluindo variações de tensão e frequência dentro dos limites estipulados.',
  '["gerador","operação","tensão","frequência"]'
FROM `normasBiblioteca` n WHERE n.codigo LIKE '%7094%' OR n.codigo LIKE '%NBR 7094%' LIMIT 1;

INSERT INTO `normaTrechos` (`normaId`, `numeroItem`, `tituloItem`, `texto`, `palavrasChave`)
SELECT n.id,
  '6.3',
  'Sistema de proteção',
  'Os geradores devem ser protegidos contra sobretemperatura, sobrecorrente e curto-circuito, através de dispositivos automáticos que interrompam o fornecimento em caso de falha.',
  '["proteção","gerador","sobretemperatura","curto-circuito"]'
FROM `normasBiblioteca` n WHERE n.codigo LIKE '%7094%' OR n.codigo LIKE '%NBR 7094%' LIMIT 1;
