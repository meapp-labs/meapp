ALTER TABLE `messages` ADD `device_id` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `ciphertext` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `ciphertext_type` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `is_encrypted` integer DEFAULT false;--> statement-breakpoint
CREATE TABLE `devices` (
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`platform` text NOT NULL,
	`last_active_at` integer,
	PRIMARY KEY(`user_id`, `device_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE TABLE `identity_keys` (
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`identity_key_public` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer,
	PRIMARY KEY(`user_id`, `device_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `idx_identity_user` ON `identity_keys` (`user_id`);--> statement-breakpoint
CREATE TABLE `prekey_bundles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`prekey_id` integer NOT NULL,
	`prekey_public` text NOT NULL,
	`signed_prekey_id` integer NOT NULL,
	`signed_prekey_public` text NOT NULL,
	`signed_prekey_signature` text NOT NULL,
	`signed_prekey_expires_at` integer NOT NULL,
	`kyber_prekey_id` integer NOT NULL,
	`kyber_prekey_public` text NOT NULL,
	`kyber_prekey_signature` text NOT NULL,
	`is_last_resort` integer DEFAULT false NOT NULL,
	`used` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `idx_prekey_fetch` ON `prekey_bundles` (`user_id`,`device_id`,`used`,`is_last_resort`);--> statement-breakpoint
CREATE INDEX `idx_prekey_expiry` ON `prekey_bundles` (`signed_prekey_expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_device_prekey` ON `prekey_bundles` (`user_id`,`device_id`,`prekey_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_device_kyber` ON `prekey_bundles` (`user_id`,`device_id`,`kyber_prekey_id`);
