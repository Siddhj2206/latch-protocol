CREATE TABLE `rejections` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`message` text NOT NULL,
	`clause` text NOT NULL,
	`expected` text NOT NULL,
	`got` text NOT NULL,
	`root_id` text,
	`merchant_id` text NOT NULL,
	`spot_paise` integer NOT NULL,
	`exec_paise` integer NOT NULL,
	`request_digest` text NOT NULL,
	`created_at` integer NOT NULL
);
