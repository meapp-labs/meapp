CREATE TABLE `auth_credential_cache` (
	`redemption_day` integer PRIMARY KEY NOT NULL,
	`credential` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ec_one_time_prekeys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`identity_type` text DEFAULT 'aci' NOT NULL,
	`prekey_id` integer NOT NULL,
	`public_key` text NOT NULL,
	`private_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`replaced_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ec_one_time_prekey_identity` ON `ec_one_time_prekeys` (`identity_type`,`prekey_id`);--> statement-breakpoint
CREATE TABLE `ec_signed_prekeys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`identity_type` text DEFAULT 'aci' NOT NULL,
	`prekey_id` integer NOT NULL,
	`public_key` text NOT NULL,
	`private_key` text NOT NULL,
	`signature` text NOT NULL,
	`timestamp` integer NOT NULL,
	`created_at` integer NOT NULL,
	`replaced_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ec_signed_prekey_identity` ON `ec_signed_prekeys` (`identity_type`,`prekey_id`);--> statement-breakpoint
CREATE INDEX `idx_ec_signed_prekeys_timestamp` ON `ec_signed_prekeys` (`timestamp`);--> statement-breakpoint
CREATE TABLE `group_master_keys` (
	`group_id` text PRIMARY KEY NOT NULL,
	`master_key` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `group_state_cache` (
	`group_id` text PRIMARY KEY NOT NULL,
	`decrypted_state` text NOT NULL,
	`revision` integer NOT NULL,
	`last_synced` integer NOT NULL,
	`endorsement_expiration` integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE `identity_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`identity_type` text DEFAULT 'aci' NOT NULL,
	`public_key` text NOT NULL,
	`registration_id` integer,
	`dh_public_key` text,
	`dh_private_key` text,
	`signing_public_key` text,
	`signing_private_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `kyber_one_time_prekeys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`identity_type` text DEFAULT 'aci' NOT NULL,
	`prekey_id` integer NOT NULL,
	`public_key` text NOT NULL,
	`private_key` text NOT NULL,
	`signature` text NOT NULL,
	`timestamp` integer NOT NULL,
	`created_at` integer NOT NULL,
	`replaced_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kyber_one_time_prekey_identity` ON `kyber_one_time_prekeys` (`identity_type`,`prekey_id`);--> statement-breakpoint
CREATE INDEX `idx_kyber_one_time_prekeys_created` ON `kyber_one_time_prekeys` (`created_at`);--> statement-breakpoint
CREATE TABLE `kyber_prekey_used` (
	`kyber_prekey_row_id` integer NOT NULL,
	`signed_prekey_identity` text NOT NULL,
	`signed_prekey_id` integer NOT NULL,
	`base_key` text NOT NULL,
	PRIMARY KEY(`kyber_prekey_row_id`, `signed_prekey_identity`, `signed_prekey_id`, `base_key`),
	FOREIGN KEY (`kyber_prekey_row_id`) REFERENCES `kyber_prekeys`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `kyber_prekeys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instance_id` text NOT NULL,
	`identity_type` text DEFAULT 'aci' NOT NULL,
	`prekey_id` integer NOT NULL,
	`public_key` text NOT NULL,
	`private_key` text NOT NULL,
	`signature` text,
	`timestamp` integer NOT NULL,
	`created_at` integer NOT NULL,
	`replaced_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kyber_prekey_instance` ON `kyber_prekeys` (`instance_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `kyber_prekey_identity` ON `kyber_prekeys` (`identity_type`,`prekey_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `kyber_prekey_current_identity` ON `kyber_prekeys` (`identity_type`) WHERE "kyber_prekeys"."replaced_at" IS NULL;--> statement-breakpoint
CREATE INDEX `idx_kyber_prekeys_timestamp` ON `kyber_prekeys` (`timestamp`);--> statement-breakpoint
CREATE TABLE `message_records` (
	`session_id` text NOT NULL,
	`timestamp` integer NOT NULL,
	`recipient_user_id` text NOT NULL,
	`recipient_device_id` integer NOT NULL,
	`plaintext` text NOT NULL,
	`created_at` integer NOT NULL,
	`session_state_id` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`session_id`, `timestamp`)
);
--> statement-breakpoint
CREATE INDEX `idx_message_records_created` ON `message_records` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_message_records_recipient` ON `message_records` (`recipient_user_id`,`recipient_device_id`);--> statement-breakpoint
CREATE TABLE `metadata` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profile_keys` (
	`user_id` text PRIMARY KEY NOT NULL,
	`profile_key` text NOT NULL,
	`profile_key_version` integer DEFAULT 1 NOT NULL,
	`received_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_profile_keys_version` ON `profile_keys` (`profile_key_version`);--> statement-breakpoint
CREATE TABLE `recipient_identities` (
	`recipient_id` text PRIMARY KEY NOT NULL,
	`identity_type` text NOT NULL,
	`record_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_recipient_identities_updated` ON `recipient_identities` (`updated_at`);--> statement-breakpoint
CREATE TABLE `sender_keys` (
	`group_id` text NOT NULL,
	`sender_id` text NOT NULL,
	`device_id` integer NOT NULL,
	`record` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`group_id`, `sender_id`, `device_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_sender_keys_group` ON `sender_keys` (`group_id`);--> statement-breakpoint
CREATE INDEX `idx_sender_keys_sender` ON `sender_keys` (`sender_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`identity_type` text DEFAULT 'aci' NOT NULL,
	`record` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_updated` ON `sessions` (`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_sessions_identity_type` ON `sessions` (`identity_type`);--> statement-breakpoint
CREATE TABLE `skipped_sender_keys` (
	`group_id` text NOT NULL,
	`sender_id` text NOT NULL,
	`sender_device_id` integer NOT NULL,
	`chain_index` integer NOT NULL,
	`cipher_key` text NOT NULL,
	`iv` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`group_id`, `sender_id`, `sender_device_id`, `chain_index`)
);
