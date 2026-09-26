CREATE TABLE `contacts` (
	`user_id` text NOT NULL,
	`contact_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `contact_user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contacts_user_idx` ON `contacts` (`user_id`);--> statement-breakpoint
CREATE INDEX `contacts_contact_user_idx` ON `contacts` (`contact_user_id`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`protocol_device_id` integer DEFAULT 1 NOT NULL,
	`history_complete` integer DEFAULT true NOT NULL,
	`history_unavailable` integer DEFAULT 0 NOT NULL,
	`platform` text NOT NULL,
	`last_active_at` integer,
	PRIMARY KEY(`user_id`, `device_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_user_protocol_device_unique` ON `devices` (`user_id`,`protocol_device_id`);--> statement-breakpoint
CREATE TABLE `friend_requests` (
	`sender_id` text NOT NULL,
	`recipient_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`sender_id`, `recipient_id`),
	FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipient_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `friend_requests_recipient_idx` ON `friend_requests` (`recipient_id`);--> statement-breakpoint
CREATE TABLE `identity_keys` (
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`identity_key_public` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer,
	PRIMARY KEY(`user_id`, `device_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_identity_user` ON `identity_keys` (`user_id`);--> statement-breakpoint
CREATE TABLE `ignored_users` (
	`user_id` text NOT NULL,
	`ignored_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `ignored_user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ignored_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ignored_users_ignored_idx` ON `ignored_users` (`ignored_user_id`);--> statement-breakpoint
CREATE TABLE `message_envelopes` (
	`message_id` text NOT NULL,
	`target_user_id` text NOT NULL,
	`target_device_id` integer DEFAULT 1 NOT NULL,
	`source_user_id` text,
	`source_device_id` integer,
	`ciphertext` text NOT NULL,
	PRIMARY KEY(`message_id`, `target_user_id`, `target_device_id`),
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `message_envelopes_target_idx` ON `message_envelopes` (`target_user_id`,`target_device_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`room_id` text NOT NULL,
	`user_id` text NOT NULL,
	`device_id` text,
	`sender_protocol_device_id` integer DEFAULT 1 NOT NULL,
	`sequence` integer NOT NULL,
	`text` text,
	`ciphertext` text,
	`ciphertext_type` integer,
	`is_encrypted` integer DEFAULT false,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_room_sequence` ON `messages` (`room_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `messages_room_idx` ON `messages` (`room_id`);--> statement-breakpoint
CREATE INDEX `messages_user_idx` ON `messages` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `messages_user_client_unique` ON `messages` (`user_id`,`client_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `messages_room_sequence_unique` ON `messages` (`room_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `room_members` (
	`room_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`room_id`, `user_id`),
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `room_members_room_idx` ON `room_members` (`room_id`);--> statement-breakpoint
CREATE INDEX `room_members_user_idx` ON `room_members` (`user_id`);--> statement-breakpoint
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
);
--> statement-breakpoint
CREATE INDEX `idx_prekey_fetch` ON `prekey_bundles` (`user_id`,`device_id`,`used`,`is_last_resort`);--> statement-breakpoint
CREATE INDEX `idx_prekey_expiry` ON `prekey_bundles` (`signed_prekey_expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_device_prekey` ON `prekey_bundles` (`user_id`,`device_id`,`prekey_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_device_kyber` ON `prekey_bundles` (`user_id`,`device_id`,`kyber_prekey_id`);--> statement-breakpoint
CREATE TABLE `relay_identities` (
	`user_id` text NOT NULL,
	`device_id` integer DEFAULT 1 NOT NULL,
	`install_id` text NOT NULL,
	`registration_id` integer NOT NULL,
	`x25519_public_key` text NOT NULL,
	`ed25519_public_key` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `device_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `relay_identities_user_install_unique` ON `relay_identities` (`user_id`,`install_id`);--> statement-breakpoint
CREATE TABLE `relay_prekeys` (
	`user_id` text NOT NULL,
	`device_id` integer DEFAULT 1 NOT NULL,
	`type` text NOT NULL,
	`key_id` integer NOT NULL,
	`public_key` text NOT NULL,
	`signature` text,
	`consumed` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `device_id`, `type`, `key_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `relay_prekeys_available_idx` ON `relay_prekeys` (`user_id`,`device_id`,`type`,`consumed`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`username` text,
	`name` text,
	`nickname` text,
	`password_hash` text NOT NULL,
	`avatar_url` text,
	`display_name` text,
	`platform` text,
	`push_token` text,
	`created_at` integer NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);