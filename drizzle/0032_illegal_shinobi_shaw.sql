CREATE TABLE `auditLog` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`actorType` varchar(30) NOT NULL,
	`actorId` int,
	`actorName` varchar(200),
	`action` varchar(100) NOT NULL,
	`resourceType` varchar(50),
	`resourceId` varchar(100),
	`tenantId` int,
	`ipAddress` varchar(45),
	`userAgent` text,
	`details` text,
	`success` tinyint NOT NULL DEFAULT 1,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `auditLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `laudoCitacoes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`laudoId` int NOT NULL,
	`trechoId` int,
	`normaCodigo` varchar(150) NOT NULL,
	`numeroItem` varchar(50) NOT NULL,
	`tituloItem` text NOT NULL,
	`textoCitado` text NOT NULL,
	`aplicacao` text,
	`ordem` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `laudoCitacoes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `laudoTipos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`codigo` text NOT NULL,
	`label` text NOT NULL,
	`descricao` text,
	`aviso_legal` text,
	`ativo` tinyint NOT NULL DEFAULT 1,
	`ordem` int NOT NULL DEFAULT 0,
	CONSTRAINT `laudoTipos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `loginAttempts` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`userType` varchar(30) NOT NULL,
	`identifier` varchar(200) NOT NULL,
	`ipAddress` varchar(45) NOT NULL,
	`userAgent` text,
	`success` tinyint NOT NULL,
	`failureReason` varchar(100),
	`attemptedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `loginAttempts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `migrationAuditLog` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`migrationName` varchar(200) NOT NULL,
	`step` varchar(100) NOT NULL,
	`sourceType` varchar(50),
	`sourceId` varchar(100),
	`targetType` varchar(50),
	`targetId` varchar(100),
	`status` varchar(20) NOT NULL,
	`details` text,
	`errorMessage` text,
	`executedBy` varchar(100),
	`executedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `migrationAuditLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `normaTrechos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`normaId` int NOT NULL,
	`numeroItem` varchar(50) NOT NULL,
	`tituloItem` text NOT NULL,
	`texto` text NOT NULL,
	`palavrasChave` text NOT NULL,
	`ativa` tinyint NOT NULL DEFAULT 1,
	CONSTRAINT `normaTrechos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notificationLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`userType` enum('client','technician','admin') NOT NULL,
	`notificationType` varchar(50) NOT NULL,
	`channel` enum('push','whatsapp','email') NOT NULL,
	`success` tinyint NOT NULL DEFAULT 0,
	`errorMessage` text,
	`payload` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notificationLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pushSubscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`userType` enum('client','technician') NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`userAgent` varchar(500),
	`lastUsedAt` timestamp,
	`active` tinyint NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pushSubscriptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `laudos` MODIFY COLUMN `tipo` text NOT NULL;--> statement-breakpoint
ALTER TABLE `laudoFotos` ADD `url_anotada` text;--> statement-breakpoint
ALTER TABLE `laudoFotos` ADD `url_recorte` text;--> statement-breakpoint
ALTER TABLE `laudoFotos` ADD `modo_layout` varchar(30) DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE `laudoFotos` ADD `anotacoes_json` text;--> statement-breakpoint
ALTER TABLE `laudos` ADD `tipo_id` int;--> statement-breakpoint
ALTER TABLE `waterTankAlertLog` ADD `delivered` tinyint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `waterTankAlertLog` ADD `deliveryError` text;--> statement-breakpoint
ALTER TABLE `waterTankAlertLog` ADD `osId` int;--> statement-breakpoint
ALTER TABLE `waterTankSensors` ADD `alarm3BoiaEnabled` tinyint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `waterTankSensors` ADD `technicianId` int;--> statement-breakpoint
CREATE INDEX `audit_actor_idx` ON `auditLog` (`actorType`,`actorId`);--> statement-breakpoint
CREATE INDEX `audit_action_idx` ON `auditLog` (`action`);--> statement-breakpoint
CREATE INDEX `audit_resource_idx` ON `auditLog` (`resourceType`,`resourceId`);--> statement-breakpoint
CREATE INDEX `audit_tenant_idx` ON `auditLog` (`tenantId`);--> statement-breakpoint
CREATE INDEX `audit_created_idx` ON `auditLog` (`createdAt`);--> statement-breakpoint
CREATE INDEX `login_identifier_idx` ON `loginAttempts` (`identifier`);--> statement-breakpoint
CREATE INDEX `login_ip_idx` ON `loginAttempts` (`ipAddress`);--> statement-breakpoint
CREATE INDEX `login_attempted_idx` ON `loginAttempts` (`attemptedAt`);--> statement-breakpoint
CREATE INDEX `migaudit_migration_idx` ON `migrationAuditLog` (`migrationName`);--> statement-breakpoint
CREATE INDEX `migaudit_source_idx` ON `migrationAuditLog` (`sourceType`,`sourceId`);--> statement-breakpoint
CREATE INDEX `migaudit_target_idx` ON `migrationAuditLog` (`targetType`,`targetId`);--> statement-breakpoint
CREATE INDEX `idx_user_log` ON `notificationLogs` (`userId`,`userType`);--> statement-breakpoint
CREATE INDEX `idx_created` ON `notificationLogs` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_channel` ON `notificationLogs` (`channel`);--> statement-breakpoint
CREATE INDEX `idx_user` ON `pushSubscriptions` (`userId`,`userType`);