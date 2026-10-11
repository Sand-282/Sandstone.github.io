CREATE TABLE `stored_chunks` (
	`storage_key` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`data` blob NOT NULL,
	FOREIGN KEY (`storage_key`) REFERENCES `stored_objects`(`storage_key`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stored_chunk_position` ON `stored_chunks` (`storage_key`,`chunk_index`);--> statement-breakpoint
CREATE TABLE `stored_objects` (
	`storage_key` text PRIMARY KEY NOT NULL,
	`size` integer NOT NULL,
	`chunk_count` integer NOT NULL
);
