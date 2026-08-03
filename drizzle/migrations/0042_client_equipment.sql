-- Migration 0042: Equipamentos do Cliente
-- Data: 2026-08-01
--
-- Cria a tabela client_equipment para armazenar os equipamentos físicos
-- (bombas e geradores) de cada cliente.
--
-- Cada equipamento cadastrado gera automaticamente um checklist na OS mensal
-- de vistoria ("Vistoria de <Mês> de <Ano>") criada no 1º dia do mês.
-- O subtítulo do checklist é a descrição/localização informada no cadastro.

CREATE TABLE IF NOT EXISTS client_equipment (
  id          INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,

  -- Cliente dono deste equipamento
  clientId    INT          NOT NULL COMMENT 'FK → clients.id',

  -- Tipo do equipamento — define qual template de checklist será usado
  type        ENUM('bomba','gerador') NOT NULL COMMENT 'bomba = template de bomba | gerador = template de gerador',

  -- Localização/subtítulo que identifica o equipamento (ex: "Torre 1 - Subsolo")
  description VARCHAR(255) NOT NULL COMMENT 'Subtítulo que aparece no checklist da OS mensal',

  createdAt   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Ao deletar o cliente, remove automaticamente seus equipamentos
  CONSTRAINT fk_client_equipment_client
    FOREIGN KEY (clientId) REFERENCES clients(id) ON DELETE CASCADE,

  -- Índice para buscar rapidamente todos os equipamentos de um cliente
  INDEX idx_client (clientId)
) COMMENT 'Equipamentos (bombas/geradores) cadastrados por cliente para inspeção mensal automática';
