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
    deviceId: text('device_id'), // nullable in N, NOT NULL in N+1
    sequence: integer('sequence').notNull(), // Monotonic per room, gaps possible after conflict/retry
    text: text('text'), // nullable in N (dual-write), dropped in N+2
    ciphertext: text('ciphertext'), // base64 Signal protocol body, nullable in N
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
// devices (V10 - per-install device registry, 1 device per user in V10.0)
// ─────────────────────────────────────────────────────────────

export const devices = sqliteTable(
  'devices',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(), // uuid v7 client-generated, stable per install
    platform: text('platform', { enum: ['ios', 'android', 'web'] }).notNull(),
    lastActiveAt: integer('last_active_at', { mode: 'timestamp' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.deviceId] })],
)

export type Device = typeof devices.$inferSelect
export type NewDevice = typeof devices.$inferInsert

// ─────────────────────────────────────────────────────────────
// identity_keys (V10 - public identity keys for fingerprinting/safety number)
// ─────────────────────────────────────────────────────────────

export const identityKeys = sqliteTable(
  'identity_keys',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    identityKeyPublic: text('identity_key_public').notNull(), // base64 X25519 public (32 bytes)
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.deviceId] }), index('idx_identity_user').on(t.userId)],
)

export type IdentityKey = typeof identityKeys.$inferSelect
export type NewIdentityKey = typeof identityKeys.$inferInsert

// ─────────────────────────────────────────────────────────────
// prekey_bundles (V10 - Signal prekeys incl. PQ (ML-KEM-768) hybrid)
// ─────────────────────────────────────────────────────────────

export const prekeyBundles = sqliteTable(
  'prekey_bundles',
  {
    id: text('id').primaryKey(), // uuidv7
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    prekeyId: integer('prekey_id').notNull(), // 0..2^24-1
    prekeyPublic: text('prekey_public').notNull(), // base64 X25519
    signedPrekeyId: integer('signed_prekey_id').notNull(),
    signedPrekeyPublic: text('signed_prekey_public').notNull(), // base64 X25519
    signedPrekeySignature: text('signed_prekey_signature').notNull(), // base64 Ed25519 sig
    signedPrekeyExpiresAt: integer('signed_prekey_expires_at', { mode: 'timestamp' }).notNull(),
    // PQ hybrid (PQXDH)
    kyberPrekeyId: integer('kyber_prekey_id').notNull(),
    kyberPrekeyPublic: text('kyber_prekey_public').notNull(), // base64 ML-KEM-768 (~1184 bytes)
    kyberPrekeySignature: text('kyber_prekey_signature').notNull(), // base64 Ed25519 sig
    isLastResort: integer('is_last_resort', { mode: 'boolean' }).notNull().default(false),
    used: integer('used', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    unique('uq_device_prekey').on(t.userId, t.deviceId, t.prekeyId),
    unique('uq_device_kyber').on(t.userId, t.deviceId, t.kyberPrekeyId),
    index('idx_prekey_fetch').on(t.userId, t.deviceId, t.used, t.isLastResort),
    index('idx_prekey_expiry').on(t.signedPrekeyExpiresAt),
  ],
)

export type PrekeyBundle = typeof prekeyBundles.$inferSelect
export type NewPrekeyBundle = typeof prekeyBundles.$inferInsert

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
