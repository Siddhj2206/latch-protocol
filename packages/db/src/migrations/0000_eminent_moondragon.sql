CREATE TABLE `envelopes` (
	`root_id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`per_tx_cap` integer NOT NULL,
	`max_hops` integer NOT NULL,
	`max_delta_pct` integer NOT NULL,
	`budget_paise` integer NOT NULL,
	`spent_paise` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `holds` (
	`id` text PRIMARY KEY NOT NULL,
	`root_id` text NOT NULL,
	`intent_digest` text NOT NULL,
	`spot_paise` integer NOT NULL,
	`exec_paise` integer NOT NULL,
	`merchant_id` text NOT NULL,
	`status` text NOT NULL,
	`step_up` integer DEFAULT false NOT NULL,
	`order_id` text,
	`payment_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `holds_replay_key` ON `holds` (`root_id`,`intent_digest`,`exec_paise`);--> statement-breakpoint
CREATE TABLE `journal` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`hold_id` text NOT NULL,
	`kind` text NOT NULL,
	`account` text NOT NULL,
	`direction` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`hold_id`) REFERENCES `holds`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `single_use_claims` (
	`capability_chain_id` text PRIMARY KEY NOT NULL,
	`hold_id` text NOT NULL,
	`claimed_at` integer NOT NULL,
	FOREIGN KEY (`hold_id`) REFERENCES `holds`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`hold_id` text,
	`processed_at` integer NOT NULL,
	FOREIGN KEY (`hold_id`) REFERENCES `holds`(`id`) ON UPDATE no action ON DELETE no action
);
