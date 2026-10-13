-- Additive workspace improvements. Existing commission, message, and file rows are preserved.
ALTER TABLE `messages` ADD `attachment_ids` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
CREATE TABLE `commission_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`rating` integer NOT NULL CHECK (`rating` BETWEEN 1 AND 5),
	`body` text DEFAULT '' NOT NULL,
	`state` text DEFAULT 'new' NOT NULL CHECK (`state` IN ('new', 'reviewed', 'hidden')),
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `commission_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `commission_reviews_request_id_unique` ON `commission_reviews` (`request_id`);
--> statement-breakpoint
CREATE INDEX `reviews_state_created` ON `commission_reviews` (`state`, `created_at`);

