-- Migration 0041: Web Push Notifications
-- Data: 2026-05-07
--
-- Cria duas tabelas:
--
-- pushSubscriptions: armazena os endpoints de push de cada usuário (cliente ou técnico).
--   Cada dispositivo gera um endpoint único. Um usuário pode ter vários dispositivos ativos.
--   Quando o navegador remove a subscription (ex: usuário desativou notificações),
--   o servidor recebe erro 410 Gone no envio e marca active=0.
--
-- notificationLogs: log imutável de todas as tentativas de notificação.
--   Fundamental para debug: "por que fulano não recebeu?"
--   Registra canal usado (push/whatsapp/email), se teve sucesso, e o payload completo.

-- ─── Tabela de subscriptions de push ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pushSubscriptions (
  id            INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,

  -- Quem é o dono desta subscription
  userId        INT          NOT NULL COMMENT 'ID do cliente ou técnico',
  userType      ENUM('client', 'technician') NOT NULL COMMENT 'Tipo do usuário dono da subscription',

  -- Dados da Web Push API — obrigatórios para enviar notificação
  endpoint      TEXT         NOT NULL COMMENT 'URL única do serviço de push do navegador',
  p256dh        TEXT         NOT NULL COMMENT 'Chave pública de criptografia do cliente',
  auth          TEXT         NOT NULL COMMENT 'Segredo de autenticação do cliente',

  -- Metadados para debug
  userAgent     VARCHAR(500) NULL     COMMENT 'User-Agent do navegador — ajuda a identificar o dispositivo',
  lastUsedAt    TIMESTAMP    NULL     COMMENT 'Última vez que esta subscription foi usada com sucesso',

  -- Controle de atividade
  active        TINYINT      NOT NULL DEFAULT 1 COMMENT '1=ativa, 0=desativada ou inválida (erro 410)',

  createdAt     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- Índice composto para buscar todas as subscriptions ativas de um usuário rapidamente
  INDEX idx_user (userId, userType),
  -- Índice no endpoint para o upsert (endpoint é único por subscription ativa)
  INDEX idx_endpoint_prefix (userType, userId)
) COMMENT 'Subscriptions de Web Push dos portais cliente e técnico';

-- ─── Tabela de log de notificações ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notificationLogs (
  id            INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,

  -- Destinatário
  userId        INT          NOT NULL COMMENT 'ID do cliente, técnico ou admin',
  userType      ENUM('client', 'technician', 'admin') NOT NULL,

  -- Tipo do evento que gerou a notificação
  -- Valores: alarm, order_new, order_updated, order_completed, budget_new, budget_approved,
  --          budget_rejected, order_completed_pdf (whatsapp obrigatório por causa do PDF)
  notificationType VARCHAR(50) NOT NULL COMMENT 'Tipo do evento (alarm, order_new, etc.)',

  -- Canal efetivamente usado
  channel       ENUM('push', 'whatsapp', 'email') NOT NULL COMMENT 'Canal usado na tentativa',

  -- Resultado
  success       TINYINT      NOT NULL DEFAULT 0 COMMENT '1=entregue com sucesso',
  errorMessage  TEXT         NULL     COMMENT 'Mensagem de erro se success=0',

  -- Payload enviado (para reproduzir e debugar)
  payload       JSON         NULL     COMMENT 'Dados completos enviados na notificação',

  createdAt     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Índices para filtros na tela de admin
  INDEX idx_user_log (userId, userType),
  INDEX idx_created (createdAt),
  INDEX idx_type (notificationType),
  INDEX idx_channel (channel)
) COMMENT 'Log imutável de todas as tentativas de notificação — canal push, WhatsApp ou email';
