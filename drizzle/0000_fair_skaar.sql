CREATE TABLE `access_tokens` (
	`hash` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `commission_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tokens_request` ON `access_tokens` (`request_id`);--> statement-breakpoint
CREATE TABLE `client_sessions` (
	`hash` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`request_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`token_hash`) REFERENCES `access_tokens`(`hash`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`request_id`) REFERENCES `commission_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `commission_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`budget` text DEFAULT '' NOT NULL,
	`timeline` text DEFAULT '' NOT NULL,
	`assets` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `commission_requests_idempotency_key_unique` ON `commission_requests` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `requests_email_created` ON `commission_requests` (`email`,`created_at`);--> statement-breakpoint
CREATE TABLE `email_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text,
	`recipient` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`reply_to` text,
	`kind` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`provider_id` text,
	`last_attempt_at` text,
	`next_attempt_at` text,
	`sent_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `commission_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `email_state_created` ON `email_outbox` (`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `email_request` ON `email_outbox` (`request_id`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text,
	`storage_key` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`public` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `commission_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_storage_key_unique` ON `files` (`storage_key`);--> statement-breakpoint
CREATE INDEX `files_request` ON `files` (`request_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`sender` text NOT NULL,
	`body` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `commission_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_duplicate` ON `messages` (`request_id`,`sender`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `messages_request_created` ON `messages` (`request_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `site_content` (
	`id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
