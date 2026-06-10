CREATE TABLE `saved_maps` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`seed` integer NOT NULL,
	`complexity` integer NOT NULL,
	`structure` text NOT NULL,
	`map_json` text NOT NULL,
	`created_at` integer NOT NULL
);
