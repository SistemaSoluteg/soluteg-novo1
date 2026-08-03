-- Seed: trechos normativos para os 8 novos tipos de laudo
-- + complementação de trechos nas normas já existentes (NBR 5410, NR-10, NR-23)
--
-- Padrão: usa INSERT...SELECT com subquery no normaId para ser independente
-- dos IDs gerados automaticamente — funciona em qualquer ambiente.

-- ════════════════════════════════════════════════════════════════════════════
-- ABNT NBR 5626 — Instalação predial de água fria (Tubulação Hidráulica)
-- ════════════════════════════════════════════════════════════════════════════

-- Estanqueidade das instalações
INSERT INTO `normaTrechos` (`normaId`, `numeroItem`, `tituloItem`, `texto`, `palavrasChave`)
SELECT n.id,
  '5.1',
  'Estanqueidade das instalações',
  'As instalações de água fria devem ser estanques, não podendo apresentar vazamentos sob pressão de serviço nem sob pressão de ensaio.',
  '["estanqueidade","vazamento","pressão","tubulação"]'
FROM `normasBiblioteca` n WHERE n.codigo = 'ABNT NBR 5626' LIMIT 1;

-- Fixação de tubulações
INSERT INTO `normaTrechos` (`normaId`, `numeroItem`, `tituloItem`, `texto`, `palavrasChave`)
SELECT n.id,
  '6.3',
  'Fixação de tubulações',
  'As tubulações devem ser fixadas de modo a não provocar tensões excessivas nas conexões e equipamentos, com espaçamento entre suportes conforme diâmetro e material.',
  '["fixação","suporte","tubulação","conexão"]'
FROM `normasBiblioteca` n WHERE n.codigo = 'ABNT NBR 5626' LIMIT 1;

-- ════════════════════════════════════════════════════════════════════════════
-- ABNT NBR 5419 — Proteção contra descargas atmosféricas (SPDA)
-- ════════════════════════════════════════════════════════════════════════════

-- Escopo e limitações técnicas
INSERT INTO `normaTrechos` (`normaId`, `numeroItem`, `tituloItem`, `texto`, `palavrasChave`)
SELECT n.id,
  '4.1',
  'Escopo e limitações técnicas',
  'O projeto, execução e certificação do SPDA são atividades que requerem profissional legalmente habilitado. A verificação periódica deve ser realizada por pessoa competente, conforme definido nesta norma.',
  '["habilitação","certificação","profissional","competente"]'
FROM `normasBiblioteca` n WHERE n.codigo = 'ABNT NBR 5419' LIMIT 1;

-- Captores — requisitos de instalação
INSERT INTO `normaTrechos` (`normaId`, `numeroItem`, `tituloItem`, `texto`, `palavrasChave`)
SELECT n.id,
  '5.2.1',
  'Captor — Requisitos de instalação',
  'Os captores devem ser instalados de forma a proteger toda a estrutura, utilizando o método da esfera rolante, malha ou ângulo de proteção conforme definido em projeto.',
  '["captor","haste","proteção","instalação"]'
FROM `normasBiblioteca` n WHERE n.codigo = 'ABNT NBR 5419' LIMIT 1;

-- Resistência de aterramento
INSERT INTO `normaTrechos` (`normaId`, `numeroItem`, `tituloItem`, `texto`, `palavrasChave`)
SELECT n.id,
  '6.1',
  'Resistência de aterramento',
  'A resistência de aterramento do sistema SPDA deve ser a mais baixa possível e não deve superar 10 ohms, medida com terrômetro após instalação.',
  '["aterramento","resistência","ohms","terrômetro"]'
FROM `normasBiblioteca` n WHERE n.codigo = 'ABNT NBR 5419' LIMIT 1;

-- ════════════════════════════════════════════════════════════════════════════
-- ABNT NBR IEC 60034 — Máquinas elétricas girantes (Motores Elétricos / Bombas)
-- ════════════════════════════════════════════════════════════════════════════

-- Corrente nominal e sobrecargas
INSERT INTO `normaTrechos` (`normaId`, `numeroItem`, `tituloItem`, `texto`, `palavrasChave`)
SELECT n.id,
  '7.1',
  'Corrente nominal e sobrecargas',
  'O motor deve operar continuamente com sua corrente nominal sem exceder os limites de temperatura estabelecidos, suportando sobrecarga de 150% por 2 minutos.',
  '["corrente","sobrecarga","temperatura","motor"]'
FROM `normasBiblioteca` n WHERE n.codigo = 'ABNT NBR IEC 60034' LIMIT 1;

-- Resistência de isolamento
INSERT INTO `normaTrechos` (`normaId`, `numeroItem`, `tituloItem`, `texto`, `palavrasChave`)
SELECT n.id,
  '8.2',
  'Resistência de isolamento',
  'A resistência de isolamento dos enrolamentos deve ser medida com megôhmetro e o valor mínimo aceitável é definido em função da tensão nominal e temperatura.',
  '["isolamento","megôhmetro","enrolamento","resistência"]'
FROM `normasBiblioteca` n WHERE n.codigo = 'ABNT NBR IEC 60034' LIMIT 1;

-- ════════════════════════════════════════════════════════════════════════════
-- ABNT NBR 13714 — Hidrantes e mangotinhos (Combate a Incêndio)
-- ════════════════════════════════════════════════════════════════════════════

-- Pressão mínima no hidrante
INSERT INTO `normaTrechos` (`normaId`, `numeroItem`, `tituloItem`, `texto`, `palavrasChave`)
SELECT n.id,
  '5.3',
  'Pressão mínima no hidrante',
  'A pressão dinâmica mínima no ponto de hidrante ou mangotinho mais desfavorável deve ser de 100 kPa (10 mca), com vazão mínima de 100 L/min para mangotinhos.',
  '["pressão","hidrante","vazão","mca"]'
FROM `normasBiblioteca` n WHERE n.codigo = 'ABNT NBR 13714' LIMIT 1;

-- Reserva técnica de incêndio
INSERT INTO `normaTrechos` (`normaId`, `numeroItem`, `tituloItem`, `texto`, `palavrasChave`)
SELECT n.id,
  '6.1',
  'Reserva técnica de incêndio',
  'O reservatório deve conter volume mínimo de reserva técnica de incêndio calculado conforme ocupação e risco, exclusivo para o sistema de combate a incêndio.',
  '["reservatório","reserva","incêndio","volume"]'
FROM `normasBiblioteca` n WHERE n.codigo = 'ABNT NBR 13714' LIMIT 1;

-- ════════════════════════════════════════════════════════════════════════════
-- ABNT NBR IEC 61439 — Painéis de Distribuição
-- ════════════════════════════════════════════════════════════════════════════

-- Temperatura máxima dos componentes
INSERT INTO `normaTrechos` (`normaId`, `numeroItem`, `tituloItem`, `texto`, `palavrasChave`)
SELECT n.id,
  '8.2.1',
  'Temperatura máxima dos componentes',
  'A elevação de temperatura dos componentes internos não deve exceder os limites estabelecidos para cada tipo de componente durante operação em regime permanente.',
  '["temperatura","componentes","painel","aquecimento"]'
FROM `normasBiblioteca` n WHERE n.codigo = 'ABNT NBR IEC 61439' LIMIT 1;

-- Grau de proteção da envolvente (IP)
INSERT INTO `normaTrechos` (`normaId`, `numeroItem`, `tituloItem`, `texto`, `palavrasChave`)
SELECT n.id,
  '10.3',
  'Grau de proteção da envolvente (IP)',
  'A envolvente do conjunto deve ter grau de proteção adequado ao local de instalação, conforme ABNT NBR IEC 60529, para proteger contra contatos e penetração de corpos sólidos e líquidos.',
  '["IP","grau proteção","envolvente","painel"]'
FROM `normasBiblioteca` n WHERE n.codigo = 'ABNT NBR IEC 61439' LIMIT 1;

-- ════════════════════════════════════════════════════════════════════════════
-- COMPLEMENTAR: ABNT NBR 5410 (trechos adicionais para instalações elétricas)
-- ════════════════════════════════════════════════════════════════════════════

-- Proteção contra sobrecorrente (disjuntores/fusíveis)
INSERT INTO `normaTrechos` (`normaId`, `numeroItem`, `tituloItem`, `texto`, `palavrasChave`)
SELECT n.id,
  '9.1.1',
  'Dispositivos de proteção contra sobrecorrente',
  'Toda instalação deve ser protegida contra efeitos de sobrecorrente por meio de dispositivos que interrompam automaticamente o circuito antes que a corrente cause danos.',
  '["disjuntor","fusível","sobrecorrente","proteção"]'
FROM `normasBiblioteca` n WHERE n.codigo = 'ABNT NBR 5410' LIMIT 1;

-- Tomadas de corrente com contato de proteção
INSERT INTO `normaTrechos` (`normaId`, `numeroItem`, `tituloItem`, `texto`, `palavrasChave`)
SELECT n.id,
  '6.4.1',
  'Tomadas de corrente — Requisitos',
  'As tomadas de corrente devem ser do tipo com contato de proteção (terra) e atender às normas de fabricação, sendo proibidas tomadas sem contato de terra em instalações novas.',
  '["tomada","terra","contato proteção","padrão"]'
FROM `normasBiblioteca` n WHERE n.codigo = 'ABNT NBR 5410' LIMIT 1;

-- Proteção contra incêndio na instalação elétrica
INSERT INTO `normaTrechos` (`normaId`, `numeroItem`, `tituloItem`, `texto`, `palavrasChave`)
SELECT n.id,
  '4.3.1',
  'Proteção contra incêndio na instalação elétrica',
  'Os componentes elétricos devem ser selecionados e instalados de forma a não constituir fonte de ignição em condições normais de operação.',
  '["incêndio","ignição","proteção","instalação"]'
FROM `normasBiblioteca` n WHERE n.codigo = 'ABNT NBR 5410' LIMIT 1;

-- ════════════════════════════════════════════════════════════════════════════
-- COMPLEMENTAR: NR-10 (trechos adicionais de segurança em eletricidade)
-- ════════════════════════════════════════════════════════════════════════════

-- Medidas de controle para trabalho em eletricidade
INSERT INTO `normaTrechos` (`normaId`, `numeroItem`, `tituloItem`, `texto`, `palavrasChave`)
SELECT n.id,
  '10.3.1',
  'Medidas de controle para trabalho em eletricidade',
  'Nas atividades e instalações elétricas devem ser adotadas medidas preventivas de controle do risco elétrico e de outros riscos adicionais, mediante técnicas de análise de risco, respeitando a hierarquia: eliminação, minimização e sinalização.',
  '["controle","risco elétrico","prevenção","análise"]'
FROM `normasBiblioteca` n WHERE n.codigo LIKE '%NR-10%' LIMIT 1;

-- Trabalho em proximidade a partes energizadas
INSERT INTO `normaTrechos` (`normaId`, `numeroItem`, `tituloItem`, `texto`, `palavrasChave`)
SELECT n.id,
  '10.4.1',
  'Trabalho em proximidade a partes energizadas',
  'O trabalho em zona controlada ou zona de risco só é permitido com o sistema elétrico desenergizado e aterrado, ou com medidas especiais de proteção para trabalho em tensão.',
  '["zona controlada","energizado","desenergizado","tensão"]'
FROM `normasBiblioteca` n WHERE n.codigo LIKE '%NR-10%' LIMIT 1;

-- ════════════════════════════════════════════════════════════════════════════
-- COMPLEMENTAR: NR-23 — Saídas de emergência
-- Norma pode não existir ainda; INSERT será ignorado se subquery retornar vazio
-- ════════════════════════════════════════════════════════════════════════════

-- Saídas de emergência — inserido apenas se NR-23 existir na biblioteca
INSERT INTO `normaTrechos` (`normaId`, `numeroItem`, `tituloItem`, `texto`, `palavrasChave`)
SELECT n.id,
  '23.5.1',
  'Saídas de emergência',
  'Os locais de trabalho devem ter saídas em número suficiente e dispostas de modo que aqueles que se encontrem nesses locais possam abandoná-los com rapidez e segurança.',
  '["saída emergência","evacuação","segurança","incêndio"]'
FROM `normasBiblioteca` n WHERE n.codigo LIKE '%NR-23%' LIMIT 1;
