// Templates de checklists genéricos para bombas e geradores
// Estrutura conforme documento FORMULARIOS_ESQUEMA.md

export interface ChecklistItem {
  id: string;
  label: string;
  type: 'ok_nok_na'; // Ok, NOk, N/A
  required: boolean;
}

export interface ChecklistField {
  id: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'multiselect';
  unit?: string; // Ex: "A" para Ampere, "V" para Volts
  options?: string[]; // Para campos select
  required: boolean;
  conditional?: {
    field: string;
    operator: 'gte' | 'eq';
    value: number | string;
  };
}

export interface ChecklistSection {
  id: string;
  title: string;
  items?: ChecklistItem[];
  fields?: ChecklistField[];
}

export interface ChecklistTemplateStructure {
  sections: ChecklistSection[];
}

// Itens de Inspeção Visual padrão para TODAS as bombas (Recalque, Dreno, Piscina, Incêndio)
const inspecaoVisualBombasPadrao: ChecklistItem[] = [
  { id: 'tubos', label: 'Tubos', type: 'ok_nok_na', required: true },
  { id: 'acionamento', label: 'Acionamento', type: 'ok_nok_na', required: true },
  { id: 'boias', label: 'Boias', type: 'ok_nok_na', required: true },
  { id: 'painel', label: 'Painel', type: 'ok_nok_na', required: true },
  { id: 'sala', label: 'Sala', type: 'ok_nok_na', required: true },
  { id: 'ruido', label: 'Ruído', type: 'ok_nok_na', required: true },
];

// Itens de Inspeção Visual para GERADOR (específicos para gerador diesel)
const inspecaoVisualGerador: ChecklistItem[] = [
  { id: 'vazamentos', label: 'Vazamentos', type: 'ok_nok_na', required: true },
  { id: 'corrosao', label: 'Corrosão', type: 'ok_nok_na', required: true },
  { id: 'conexoes_soltas', label: 'Conexões Soltas', type: 'ok_nok_na', required: true },
  { id: 'radiador', label: 'Radiador', type: 'ok_nok_na', required: true },
  { id: 'mangueiras', label: 'Mangueiras', type: 'ok_nok_na', required: true },
  { id: 'bateria_visual', label: 'Bateria (Visual)', type: 'ok_nok_na', required: true },
  { id: 'cabos_eletricos', label: 'Cabos Elétricos', type: 'ok_nok_na', required: true },
  { id: 'escapamento', label: 'Escapamento', type: 'ok_nok_na', required: true },
  { id: 'filtros', label: 'Filtros', type: 'ok_nok_na', required: true },
  { id: 'painel_controle', label: 'Painel de Controle', type: 'ok_nok_na', required: true },
];

// Template unificado de Bomba — cobre Recalque, Dreno, Piscina e Incêndio.
// Cada bomba tem seu próprio tipo, potência e corrente na seção Dados Técnicos.
export const bombaTemplate: ChecklistTemplateStructure = {
  sections: [
    {
      id: 'inspecao_visual',
      title: 'Inspeção Visual',
      items: [...inspecaoVisualBombasPadrao],
    },
    {
      id: 'dados_tecnicos',
      title: 'Dados Técnicos',
      fields: [
        { id: 'tensao',     label: 'Tensão', type: 'select', options: ['127V', '220V', '380V', '440V'], required: true },
        { id: 'fases',      label: 'Fases',  type: 'select', options: ['Monofásico', 'Bifásico', 'Trifásico'], required: true },
        { id: 'num_bombas', label: 'Quantidade de Bombas', type: 'select', options: ['1', '2', '3', '4'], required: true },
        // Bomba 1 — sempre visível
        { id: 'tipo_bomba_1',    label: 'Tipo da Bomba 1',    type: 'select', options: ['Recalque', 'Dreno', 'Piscina', 'Incêndio'], required: true },
        { id: 'potencia_bomba_1', label: 'Potência Motor 1',  type: 'number', unit: 'CV', required: true },
        { id: 'corrente_bomba_1', label: 'Corrente Bomba 1',  type: 'number', unit: 'A',  required: true },
        // Bomba 2
        { id: 'tipo_bomba_2',    label: 'Tipo da Bomba 2',    type: 'select', options: ['Recalque', 'Dreno', 'Piscina', 'Incêndio'], required: false, conditional: { field: 'num_bombas', operator: 'gte', value: 2 } },
        { id: 'potencia_bomba_2', label: 'Potência Motor 2',  type: 'number', unit: 'CV', required: false, conditional: { field: 'num_bombas', operator: 'gte', value: 2 } },
        { id: 'corrente_bomba_2', label: 'Corrente Bomba 2',  type: 'number', unit: 'A',  required: false, conditional: { field: 'num_bombas', operator: 'gte', value: 2 } },
        // Bomba 3
        { id: 'tipo_bomba_3',    label: 'Tipo da Bomba 3',    type: 'select', options: ['Recalque', 'Dreno', 'Piscina', 'Incêndio'], required: false, conditional: { field: 'num_bombas', operator: 'gte', value: 3 } },
        { id: 'potencia_bomba_3', label: 'Potência Motor 3',  type: 'number', unit: 'CV', required: false, conditional: { field: 'num_bombas', operator: 'gte', value: 3 } },
        { id: 'corrente_bomba_3', label: 'Corrente Bomba 3',  type: 'number', unit: 'A',  required: false, conditional: { field: 'num_bombas', operator: 'gte', value: 3 } },
        // Bomba 4
        { id: 'tipo_bomba_4',    label: 'Tipo da Bomba 4',    type: 'select', options: ['Recalque', 'Dreno', 'Piscina', 'Incêndio'], required: false, conditional: { field: 'num_bombas', operator: 'gte', value: 4 } },
        { id: 'potencia_bomba_4', label: 'Potência Motor 4',  type: 'number', unit: 'CV', required: false, conditional: { field: 'num_bombas', operator: 'gte', value: 4 } },
        { id: 'corrente_bomba_4', label: 'Corrente Bomba 4',  type: 'number', unit: 'A',  required: false, conditional: { field: 'num_bombas', operator: 'gte', value: 4 } },
      ],
    },
    {
      id: 'observacoes',
      title: 'Observações',
      fields: [
        { id: 'observacoes', label: 'Observações', type: 'text', required: false },
      ],
    },
  ],
};

// Mantidos apenas como referência — não são mais usados em novos checklists.
// Os 4 templates abaixo foram desativados no banco (active=0) e substituídos por bombaTemplate.
/** @deprecated use bombaTemplate */
export const bombaRecalqueTemplate = bombaTemplate;
/** @deprecated use bombaTemplate */
export const bombaDrenoTemplate = bombaTemplate;
/** @deprecated use bombaTemplate */
export const bombaPiscinaTemplate = bombaTemplate;
/** @deprecated use bombaTemplate */
export const bombaIncendioTemplate = bombaTemplate;

// Template: Gerador (16 campos técnicos específicos)
export const geradorTemplate: ChecklistTemplateStructure = {
  sections: [
    {
      id: 'inspecao_visual',
      title: 'Inspeção Visual',
      items: [...inspecaoVisualGerador]
    },
    {
      id: 'tensao_fases',
      title: 'Tensão e Fases',
      fields: [
        { id: 'tensao', label: 'Tensão', type: 'select', options: ['127V', '220V', '380V', '440V'], required: true },
        { id: 'fases', label: 'Fases', type: 'select', options: ['Monofásico', 'Bifásico', 'Trifásico'], required: true },
      ]
    },
    {
      id: 'tensao_entre_fases',
      title: 'Tensão Entre Fases',
      fields: [
        { id: 'tensao_l1_l2', label: 'L1-L2', type: 'number', unit: 'V', required: true },
        { id: 'tensao_l2_l3', label: 'L2-L3', type: 'number', unit: 'V', required: true },
        { id: 'tensao_l1_l3', label: 'L1-L3', type: 'number', unit: 'V', required: true },
      ]
    },
    {
      id: 'corrente_entre_fases',
      title: 'Corrente Entre Fases',
      fields: [
        { id: 'corrente_l1', label: 'L1', type: 'number', unit: 'A', required: true },
        { id: 'corrente_l2', label: 'L2', type: 'number', unit: 'A', required: true },
        { id: 'corrente_l3', label: 'L3', type: 'number', unit: 'A', required: true },
      ]
    },
    {
      id: 'bateria_info',
      title: 'Bateria',
      fields: [
        { id: 'tensao_bateria', label: 'Tensão da Bateria', type: 'number', unit: 'V', required: true },
        { id: 'tensao_minima_bateria', label: 'Tensão Mínima da Bateria', type: 'number', unit: 'V', required: true },
        { id: 'tensao_carregador', label: 'Tensão do Carregador', type: 'number', unit: 'V', required: true },
      ]
    },
    {
      id: 'alternador',
      title: 'Alternador',
      fields: [
        { id: 'tensao_alternador', label: 'Tensão do Alternador', type: 'number', unit: 'V', required: true },
      ]
    },
    {
      id: 'combustivel_info',
      title: 'Combustível',
      fields: [
        { id: 'nivel_combustivel', label: 'Nível de Combustível', type: 'number', unit: 'L', required: true },
      ]
    },
    {
      id: 'equipamento',
      title: 'Equipamento',
      fields: [
        { id: 'horimetro', label: 'Horômetro', type: 'number', unit: 'h', required: true },
      ]
    },
    {
      id: 'arrefecimento',
      title: 'Líquido de Arrefecimento',
      fields: [
        { id: 'nivel_arrefecimento', label: 'Nível', type: 'select', options: ['Baixo', 'Normal', 'Alto'], required: true },
        { id: 'temperatura', label: 'Temperatura', type: 'number', unit: '°C', required: true },
      ]
    },
    {
      id: 'observacoes',
      title: 'Observações',
      fields: [
        { id: 'observacoes', label: 'Observações', type: 'text', required: false }
      ]
    }
  ]
};

// Mapa de templates ativos — apenas 2 após a unificação das bombas.
// Os slugs bomba_recalque/dreno/piscina/incendio foram desativados no banco
// e existem só para não quebrar instâncias históricas.
export const checklistTemplatesMap = {
  bomba: {
    name: 'Bomba',
    slug: 'bomba',
    description: 'Checklist unificado para inspeção de bombas (Recalque, Dreno, Piscina, Incêndio)',
    structure: bombaTemplate,
  },
  gerador: {
    name: 'Gerador',
    slug: 'gerador',
    description: 'Checklist para inspeção de geradores',
    structure: geradorTemplate,
  },
};

export type ChecklistTemplateSlug = keyof typeof checklistTemplatesMap;
