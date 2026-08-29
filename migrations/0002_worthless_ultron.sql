ALTER TABLE `ai_snapshots` ADD `cited` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_snapshots` ADD `response_excerpt` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_snapshots` ADD `model` text;--> statement-breakpoint
ALTER TABLE `ai_snapshots` ADD `cost_usd` real DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `ai_snapshots_prompt_engine_date_idx` ON `ai_snapshots` (`prompt_id`,`engine`,`date`);