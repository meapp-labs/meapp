import { index, integer, primaryKey, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

// ─────────────────────────────────────────────────────────────
// users (V8 FINAL)
// ─────────────────────────────────────────────────────────────

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').unique(),
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

// ─────────────────────────────────────────────────────────────
// rooms (conversations) (V8 FINAL)
// ─────────────────────────────────────────────────────────────

export const rooms = sqliteTable('rooms', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
})

export type Room = typeof rooms.$inferSelect
export type NewRoom = typeof rooms.$inferInsert

// Alias conversations to rooms for compatibility
export const conversations = rooms
export type Conversation = Room
export type NewConversation = NewRoom

// ─────────────────────────────────────────────────────────────
// room_members (participants) (V8 FINAL)
// ─────────────────────────────────────────────────────────────

export const roomMembers = sqliteTable(
  'room_members',
  {
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

// Alias participants to roomMembers
export const participants = roomMembers
export type Participant = RoomMember
export type NewParticipant = NewRoomMember

// ─────────────────────────────────────────────────────────────
// messages (V10 EXPAND - E2E columns nullable, plaintext text kept for N)
// ─────────────────────────────────────────────────────────────

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull(),
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
    index('messages_room_idx').on(t.roomId),
    index('messages_user_idx').on(t.userId),
  ],
)

export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert

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
