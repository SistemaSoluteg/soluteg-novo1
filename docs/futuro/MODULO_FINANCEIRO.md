# Módulo Financeiro — Proposta Futura

> **Status:** 📋 IDEIA MAPEADA — não está no roadmap ativo
> **Data:** 19/05/2026
> **Origem:** Conversa entre Thiago e IA, consolidada em documento
> **Decisão atual:** Salvar como referência. Avaliar implementação **após Fase 4** (validação comercial com 3-5 clientes pagantes).

---

## ⚠️ Por que este documento está em `docs/futuro/`

Esta pasta guarda ideias amadurecidas que **não entraram no roadmap ativo**. Razões para não implementar agora:

1. **Pré-requisito não cumprido:** Fase 3.7 (multi-tenant) ainda em curso. Toda nova tabela exige `tenantId` desde o início — só faz sentido construir após o isolamento de queries (3.7.2) estar validado.

2. **Validação comercial pendente:** A Fase 4 (3-5 clientes pagantes) é onde se descobre o que **o mercado** quer, não só o que a JNC precisa. Construir um ERP financeiro completo antes pode resultar em features que ninguém usa.

3. **Escopo grande:** Estimativa otimista 4-8 meses com 3h/dia. Tempo precioso melhor investido em validação primeiro, refinamento depois.

4. **Trade-offs não testados:** Decisões como "boleto manual + extração de PDF" ou "sem integração com gateway" foram tomadas com base em premissas. Clientes reais podem querer Asaas/iugu/PagBank com boleto automático — mudaria todo o desenho.

**Esta ideia não está descartada.** Quando a JNC e os primeiros tenants do "Soluteg Direto" estiverem operacionais e estáveis, este documento volta à mesa.

---

## 1. Cobrança (Boletos e Notas Fiscais)

A emissão de boletos e notas fiscais é **externa e manual** — feita pelo usuário no banco ou no sistema da prefeitura. O Soluteg não emite documentos diretamente (sem integração com gateway por ora).

**Fluxo de registro de cobrança:**

1. Usuário faz upload do PDF do boleto gerado externamente
2. O sistema extrai automaticamente os dados disponíveis no texto do PDF: linha digitável, valor e data de vencimento (padrão FEBRABAN — confiável em boletos digitais)
3. O usuário vincula manualmente a OS correspondente e confirma os dados
4. O sistema armazena a cobrança vinculada ao cliente e à OS

**Envio automático ao cliente via WhatsApp após registro:**

- Linha digitável (copia e cola)
- Payload PIX / QR Code (quando disponível no boleto)

**Notas fiscais (NFS-e):** mesma lógica — emissão externa, upload do PDF como comprovante vinculado à OS.

---

## 2. Baixa de Pagamento

O cliente envia o comprovante de pagamento (PDF ou imagem digital gerada pelo app do banco — **não foto/print**). O sistema:

- Extrai automaticamente: valor pago, data/hora, ID da transação (E2E PIX ou autenticação do boleto)
- Muda o status da cobrança para `aguardando_confirmacao`
- O financeiro revisa e confirma (ou rejeita) em um clique

**Notas:**
- Comprovantes via PIX têm extração muito confiável
- Boletos pagos também
- Prints de tela não serão suportados — orientar o cliente a sempre enviar o PDF oficial

---

## 3. Política de Retenção de Documentos

- **PDF do boleto:** excluído do storage (Cloudinary) 1 mês após o pagamento
- **Comprovante enviado pelo cliente:** excluído 1 ano após o pagamento
- **Registros no banco de dados:** permanecem indefinidamente — só o arquivo binário é removido
- **Implementação:** cron diário verificando os campos `documentoExpiresAt` e `comprovanteExpiresAt`

Política aderente à LGPD (minimização de dados).

---

## 4. Gestão de Inadimplência

Status possíveis para cada cobrança:
- `pendente`
- `aguardando_confirmacao`
- `pago`
- `vencido`
- `cancelado`

**Cron diário (sugestão: 8h):**

- Cobranças `pendente` com `dataVencimento < hoje` → atualiza para `vencido`
- Vencimentos em D-3 e D-1 → dispara lembrete preventivo por WhatsApp e/ou email
- Cobranças vencidas há 1, 7, 15 e 30 dias → dispara mensagens de cobrança progressiva

**Dashboard de inadimplência exibe:**
- A vencer nos próximos 7 dias
- Vencido hoje
- 1–15 dias em atraso
- Mais de 15 dias em atraso
- Total em aberto

---

## 5. Módulo Financeiro Completo

Núcleo da proposta: um ERP financeiro integrado ao PDV e às OS.

### 5.1 Plano de Contas

Hierarquia de categorias com dois níveis (categoria → subcategoria), separadas por tipo (`receita` / `despesa`), com flags `isFixed` (fixo vs variável) e `isTax` (impostos).

**Exemplos:**

- Receitas → Serviços (Elétrica, Hidráulica, Bombeamento) / Vendas PDV / Outros
- Despesas → Fixas (Aluguel, Salários) / Variáveis (Compras de mercadoria, Combustível) / Impostos (Simples Nacional, ISS, INSS)

**Plano de contas configurável por tenant.**

### 5.2 Lançamentos Financeiros

Tabela central `financialTransactions` com atributos:

| Atributo | Descrição |
|----------|-----------|
| `type` | `receita`, `despesa` ou `transferencia` |
| `categoryId` | FK para plano de contas |
| `sourceType` | `os`, `venda_pdv`, `boleto`, `compra_mercadoria` ou `manual` |
| `sourceId` | ID do registro de origem |
| `installmentGroupId` | Suporte a parcelamento |
| `recurringDay` | Suporte a recorrência (contas fixas mensais) |
| `status` | `pendente` ou `confirmado` |
| `paymentMethod` | `dinheiro`, `pix`, `boleto`, `cartao`, `transferencia` |

**Geração automática:**
- Lançamentos originados de OS pagas, vendas PDV e boletos confirmados são gerados pelo sistema, sem intervenção do usuário

**UX para lançamento manual:**
- Poucos campos obrigatórios na tela principal
- Opções avançadas colapsadas

### 5.3 Caixa PDV

- Abertura de caixa com saldo inicial informado
- Registro de sangrias e suprimentos durante o dia
- Fechamento com saldo esperado (calculado) vs saldo informado, com apuração da diferença
- Vendas PDV alimentam o caixa automaticamente, com breakdown por forma de pagamento
- O dashboard atual do PDV tem filtros insuficientes — deve ser corrigido junto com essa integração

### 5.4 Dashboard Financeiro

**Cards fixos no topo:**
- Receita do mês
- Despesa do mês
- Resultado
- A receber
- A pagar
- Caixa atual

**Filtros globais aplicáveis a todo o dashboard:**
- Período (semana / mês / trimestre / ano / personalizado)
- Categoria
- Fonte (OS / PDV / manual)
- Status

**Gráficos:**
- Receita vs despesa por mês (tendência)
- Composição da receita por categoria
- Top despesas do período
- Fluxo de caixa projetado (30 dias)
- Inadimplência por faixa de atraso

**Relatórios exportáveis:**
- DRE simplificado
- Fluxo de caixa realizado
- Contas a pagar/receber
- Extrato por categoria
- Fechamentos de caixa PDV

### 5.5 Controle de Acesso

Nova role `financeiro` adicionada ao sistema de permissões existente.

- **Não é um login separado** — o usuário acessa o mesmo `app.soluteg.com.br`
- É direcionado exclusivamente ao módulo financeiro
- Sem acesso às OS ou configurações do sistema
- Nível de acesso ao PDV configurável por tenant

---

## 6. Pontos que requerem revisão arquitetural

Decisões técnicas que precisarão de aprofundamento quando a implementação for iniciada:

1. **Estratégia de extração de texto de PDFs de boletos** — `pdf-parse` vs `pdfjs-dist`, robustez em diferentes layouts de bancos
2. **Geração de QR Code PIX** — a partir do payload da linha digitável (algoritmo FEBRABAN) vs chave PIX avulsa da empresa
3. **Política de deleção de arquivos no Cloudinary via cron** — garantir idempotência e tratamento de falha na API do storage
4. **Recorrência de contas fixas** — geração antecipada (cron mensal cria lançamentos do próximo mês) vs geração sob demanda — trade-off entre visibilidade e complexidade
5. **Integração PDV ↔ financeiro** — transação deve ser atômica (venda fechada + lançamento criado no mesmo commit, ou compensação em caso de falha)
6. **`tenantId` em todas as tabelas desde o schema inicial** — não negociável dado o modelo multi-tenant compartilhado

---

## 7. Sequência de implementação sugerida

Se/quando este módulo for ativado, ordem proposta:

1. Plano de contas + lançamento manual + relatório básico
2. Integração OS → lançamento automático ao marcar como paga
3. Abertura/fechamento de caixa PDV + integração com vendas
4. Cobrança (boletos, comprovantes, inadimplência)
5. Dashboard avançado com filtros e relatórios exportáveis
6. Contas fixas recorrentes, impostos e compras de mercadoria

---

## 8. Critérios para reativar este documento

Este documento deve voltar à mesa quando **todas** as condições abaixo forem atendidas:

- [ ] Fase 3.7 (multi-tenant) totalmente concluída e validada
- [ ] Fase 4 (validação comercial) com **mínimo 3 clientes pagantes ativos**
- [ ] Pelo menos 2 desses clientes pediram explicitamente alguma funcionalidade financeira
- [ ] Decisão sobre integração com gateway (Asaas/iugu/PagBank) feita — adia ou faz parte do escopo?
- [ ] Discussão com o irmão arquiteto sobre trade-offs do escopo proposto

---

## 9. Trade-offs e perguntas em aberto

Pontos que merecem reflexão antes de partir para implementação:

- **Boleto manual vs automatizado:** clientes podem preferir integração com Asaas (boleto gerado pelo sistema, com webhook de pagamento). Hoje a decisão é manual; pode mudar.
- **Mercado já tem alternativas:** Conta Azul, Omie, Bling. Faz sentido reconstruir? Ou integrar?
- **Volume de OS:** se a JNC fecha 76 OS por ano, ERP financeiro completo é overengineering. Se escalar para 50 tenants × 100 OS/ano = 5.000 OS/ano, justifica.
- **Extração de PDF:** funciona bem em laboratório, mas bancos mudam layout. Manutenção pode virar dor de cabeça contínua.

---

**Próxima ação para este documento:** revisar em conjunto com o irmão arquiteto **após Fase 4 estar em curso**. Não antes.
