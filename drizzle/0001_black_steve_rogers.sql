CREATE TABLE `admin_sessions` (
	`hash` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_sessions_expiry` ON `admin_sessions` (`expires_at`);