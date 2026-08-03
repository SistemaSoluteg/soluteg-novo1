-- ============================================================
-- Migration: Corrigir collation das tabelas de auditoria (3.7.1a)
-- 
-- As tabelas auditLog, loginAttempts e migrationAuditLog foram
-- criadas com a collation default do banco (utf8mb4_0900_ai_ci),
-- divergente das tabelas de negócio que usam utf8mb4_bin.
-- 
-- Isso causaria "Illegal mix of collations" em JOINs futuros.
-- As 3 tabelas estão vazias (0 registros), então o CONVERT é
-- seguro e instantâneo.
-- ============================================================

ALTER TABLE `auditLog` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
--> statement-breakpoint
ALTER TABLE `loginAttempts` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
--> statement-breakpoint
ALTER TABLE `migrationAuditLog` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
