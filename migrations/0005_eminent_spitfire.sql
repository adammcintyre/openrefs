CREATE TABLE `search_history` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`module` text NOT NULL,
	`query_key` text NOT NULL,
	`params` text NOT NULL,
	`summary` text,
	`hit_count` integer DEFAULT 1 NOT NULL,
	`first_searched_at` integer NOT NULL,
	`last_searched_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `search_history_query_idx` ON `search_history` (`workspace_id`,`module`,`query_key`);--> statement-breakpoint
CREATE INDEX `search_history_recent_idx` ON `search_history` (`workspace_id`,`module`,`last_searched_at`);