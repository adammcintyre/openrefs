DROP INDEX `rank_snapshots_keyword_date_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `rank_snapshots_keyword_date_idx` ON `rank_snapshots` (`tracked_keyword_id`,`date`);