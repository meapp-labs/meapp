import { index, integer, primaryKey, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

// ─────────────────────────────────────────────────────────────
// users (V8 FINAL)
// ─────────────────────────────────────────────────────────────

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').unique(),
  emailVerifiedAt: integer('email_verified_at'),
  authVersion: integer('auth_version').notNull().default(0),
  username: text('username').unique(),
  name: text('name'),
  nickname: text('nickname'), // expand phase, nullable
  passwordHash: text('password_hash').notNull(),
  avatarUrl: text('avatar_url'),
  displayName: text('display_name'),
  platform: text('platform', { enum: ['ios', 'android', 'web'] }),
  pushToken: text('push_token'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert

export const notificationPreferences = sqliteTable('notification_preferences', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  settings: text('settings').notNull(),
})

export const accountRecoveryProofs = sqliteTable(
  'account_recovery_proofs',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose', { enum: ['enroll', 'reset'] }).notNull(),
    email: text('email').notNull(),
    authVersion: integer('auth_version').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [
    index('account_recovery_user_idx').on(table.userId),
    index('account_recovery_expiry_idx').on(table.expiresAt),
  ],
)

// ─────────────────────────────────────────────────────────────
// rooms (conversations) (V8 FINAL)
// ─────────────────────────────────────────────────────────────

export const rooms = sqliteTable('rooms', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type', { enum: ['dm', 'group', 'saved'] })
    .notNull()
    .default('dm'),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
})

export type Room = typeof rooms.$inferSelect
export type NewRoom = typeof rooms.$inferInsert

// ─────────────────────────────────────────────────────────────
// room_members (participants) (V8 FINAL)
// ─────────────────────────────────────────────────────────────

export const roomMembers = sqliteTable(
  'room_members',
  {
    muted: integer('muted', { mode: 'boolean' }).notNull().default(false),
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    joinedAt: integer('joined_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.roomId, t.userId] }),
    index('room_members_room_idx').on(t.roomId),
    index('room_members_user_idx').on(t.userId),
  ],
)

export type RoomMember = typeof roomMembers.$inferSelect
export type NewRoomMember = typeof roomMembers.$inferInsert

// ─────────────────────────────────────────────────────────────
// room_invites (expiring, hashed tokens with atomic usage count)
// ─────────────────────────────────────────────────────────────

export const roomInvites = sqliteTable(
  'room_invites',
  {
    tokenHash: text('token_hash').primaryKey(),
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    inviterId: text('inviter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    maxUses: integer('max_uses').notNull().default(1),
    usesCount: integer('uses_count').notNull().default(0),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index('room_invites_room_idx').on(t.roomId),
    index('room_invites_inviter_idx').on(t.inviterId),
  ],
)

export type RoomInvite = typeof roomInvites.$inferSelect
export type NewRoomInvite = typeof roomInvites.$inferInsert

// ─────────────────────────────────────────────────────────────
// messages (V10 EXPAND - E2E columns nullable, plaintext text kept for N)
// ─────────────────────────────────────────────────────────────

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull(),
    replyTo: text('reply_to'),
    threadRootId: text('thread_root_id'),
    attachmentIds: text('attachment_ids').notNull().default('[]'),
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    deviceId: text('device_id'), // sender device for encrypted messages
    senderProtocolDeviceId: integer('sender_protocol_device_id').notNull().default(1),
    sequence: integer('sequence').notNull(), // Monotonic per room, gaps possible after conflict/retry
    text: text('text'), // null for encrypted messages
    ciphertext: text('ciphertext'), // base64 Signal protocol body; null for plaintext
    ciphertextType: integer('ciphertext_type'), // 1=Whisper, 3=PreKeyWhisper
    isEncrypted: integer('is_encrypted', { mode: 'boolean' }).default(false),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    unique('messages_user_client_unique').on(t.userId, t.clientId),
    unique('messages_room_sequence_unique').on(t.roomId, t.sequence),
    index('idx_room_sequence').on(t.roomId, t.sequence),
    index('messages_thread_sequence').on(t.roomId, t.threadRootId, t.sequence),
    index('messages_room_idx').on(t.roomId),
    index('messages_user_idx').on(t.userId),
  ],
)

export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert

// Durable reaction operations use their own revision cursor, never message sequences.
// Emoji and authorship are server-visible interaction metadata; message content stays E2E.
export const reactionOperations = sqliteTable(
  'reaction_operations',
  {
    revision: integer('revision').primaryKey({ autoIncrement: true }),
    operationId: text('operation_id').notNull(),
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    predecessor: integer('predecessor').notNull(),
    emoji: text('emoji'),
  },
  (t) => [
    unique('reaction_user_operation').on(t.userId, t.operationId),
    index('reaction_room_revision').on(t.roomId, t.revision),
    index('reaction_target_author').on(t.messageId, t.userId, t.revision),
  ],
)

// Exact acknowledgements avoid treating sequence gaps or unavailable history as read.
// A user receipt aggregates successful processing by any of their linked devices.
export const messageReceipts = sqliteTable(
  'message_receipts',
  {
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deliveredAt: integer('delivered_at').notNull(),
    readAt: integer('read_at'),
    // Set only by reads made while sharing is enabled; enabling is not retroactive.
    sharedReadAt: integer('shared_read_at'),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.userId] }),
    index('message_receipts_user_idx').on(t.userId),
  ],
)

export const receiptPreferences = sqliteTable(
  'receipt_preferences',
  {
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    shareReadReceipts: integer('share_read_receipts', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.userId] })],
)

// Object keys are random capabilities. A deleting row is a durable GC claim:
// message insertion can only link committed rows inside its SQLite transaction.
export const attachments = sqliteTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull(),
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.id),
    senderId: text('sender_id')
      .notNull()
      .references(() => users.id),
    storageKey: text('storage_key').notNull().unique(),
    state: text('state', { enum: ['pending', 'committed', 'linked', 'deleting', 'expired'] })
      .notNull()
      .default('pending'),
    variantsJson: text('variants_json').notNull(),
    cipherTotal: integer('cipher_total').notNull(),
    createdAt: integer('created_at').notNull(),
    committedAt: integer('committed_at'),
    linkedAt: integer('linked_at'),
    linkedTo: text('linked_to'),
    lastUploadExpiry: integer('last_upload_expiry').notNull(),
  },
  (t) => [
    unique('attachments_sender_client_unique').on(t.senderId, t.clientId),
    index('attachments_sender_state_idx').on(t.senderId, t.state),
    index('attachments_state_created_idx').on(t.state, t.createdAt),
    index('attachments_linked_to_idx').on(t.linkedTo),
  ],
)

// ─────────────────────────────────────────────────────────────
// devices - one install ID and one protocol device ID per linked device.
// ─────────────────────────────────────────────────────────────

export const devices = sqliteTable(
  'devices',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(), // uuid v7 client-generated, stable per install
    protocolDeviceId: integer('protocol_device_id').notNull().default(1),
    historyComplete: integer('history_complete', { mode: 'boolean' }).notNull().default(true),
    historyUnavailable: integer('history_unavailable').notNull().default(0),
    platform: text('platform', { enum: ['ios', 'android', 'web'] }).notNull(),
    lastActiveAt: integer('last_active_at', { mode: 'timestamp' }),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.deviceId] }),
    unique('devices_user_protocol_device_unique').on(t.userId, t.protocolDeviceId),
  ],
)

export type Device = typeof devices.$inferSelect
export type NewDevice = typeof devices.$inferInsert

// Short-lived encrypted device provisioning handshakes survive server restarts.
export const deviceLinkSessions = sqliteTable(
  'device_link_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ownerInstallId: text('owner_install_id').notNull(),
    ownerPublicKey: text('owner_public_key').notNull(),
    newInstallId: text('new_install_id'),
    newPublicKey: text('new_public_key'),
    platform: text('platform', { enum: ['web', 'android'] }),
    encryptedMessage: text('encrypted_message'),
    deviceId: integer('device_id').notNull(),
    status: text('status').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [
    unique('device_link_sessions_device_unique').on(t.userId, t.deviceId),
    index('device_link_sessions_user_idx').on(t.userId),
    index('device_link_sessions_expiry_idx').on(t.expiresAt),
  ],
)

// A logout revokes only that JWT, without ending other linked devices' sessions.
export const revokedTokens = sqliteTable(
  'revoked_tokens',
  {
    jti: text('jti').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [index('revoked_tokens_expiry_idx').on(t.expiresAt)],
)

// Public Signal SDK relay state. Device secret keys and ratchet sessions stay on
// the client; the server only stores public prekeys and opaque envelopes.
export const relayIdentities = sqliteTable(
  'relay_identities',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: integer('device_id').notNull().default(1),
    installId: text('install_id').notNull(),
    registrationId: integer('registration_id').notNull(),
    x25519PublicKey: text('x25519_public_key').notNull(),
    ed25519PublicKey: text('ed25519_public_key').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.deviceId] }),
    unique('relay_identities_user_install_unique').on(t.userId, t.installId),
  ],
)

export const relayPrekeys = sqliteTable(
  'relay_prekeys',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: integer('device_id').notNull().default(1),
    type: text('type', {
      enum: ['ecPreKey', 'ecSignedPreKey', 'kemOneTimePreKey', 'kemLastResortPreKey'],
    }).notNull(),
    keyId: integer('key_id').notNull(),
    publicKey: text('public_key').notNull(),
    signature: text('signature'),
    consumed: integer('consumed', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.deviceId, t.type, t.keyId] }),
    index('relay_prekeys_available_idx').on(t.userId, t.deviceId, t.type, t.consumed),
  ],
)

export const messageEnvelopes = sqliteTable(
  'message_envelopes',
  {
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    targetUserId: text('target_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetDeviceId: integer('target_device_id').notNull().default(1),
    sourceUserId: text('source_user_id').references(() => users.id),
    sourceDeviceId: integer('source_device_id'),
    ciphertext: text('ciphertext').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.targetUserId, t.targetDeviceId] }),
    index('message_envelopes_target_idx').on(t.targetUserId, t.targetDeviceId),
  ],
)

// ─────────────────────────────────────────────────────────────
// contacts (friends)
// ─────────────────────────────────────────────────────────────

export const contacts = sqliteTable(
  'contacts',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    contactUserId: text('contact_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    aliasCiphertext: text('alias_ciphertext'),
    aliasRevision: integer('alias_revision').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.contactUserId] }),
    index('contacts_user_idx').on(t.userId),
    index('contacts_contact_user_idx').on(t.contactUserId),
  ],
)

export type Contact = typeof contacts.$inferSelect
export type NewContact = typeof contacts.$inferInsert

// Dedicated public avatar blobs; unreferenced/pending rows are swept after an hour.
export const profileAvatars = sqliteTable('profile_avatars', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  url: text('url').notNull().unique(),
  createdAt: integer('created_at').notNull(),
})

export const friendRequests = sqliteTable(
  'friend_requests',
  {
    senderId: text('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    recipientId: text('recipient_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.senderId, t.recipientId] }),
    index('friend_requests_recipient_idx').on(t.recipientId),
  ],
)

export const ignoredUsers = sqliteTable(
  'ignored_users',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ignoredUserId: text('ignored_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.ignoredUserId] }),
    index('ignored_users_ignored_idx').on(t.ignoredUserId),
  ],
)
