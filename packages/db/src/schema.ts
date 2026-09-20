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
// sessions
// ─────────────────────────────────────────────────────────────

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
)

export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert

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
// messages (V8 FINAL - FIX #4 idempotency, FIX #6 monotonic sequence with gaps allowed)
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
    sequence: integer('sequence').notNull(), // FIX #6: Monotonic per room, gaps possible after conflict/retry
    text: text('text').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    unique('messages_user_client_unique').on(t.userId, t.clientId),
    unique('messages_room_sequence_unique').on(t.roomId, t.sequence), // ensures no duplicates, gaps possible after conflict/retry
    index('idx_room_sequence').on(t.roomId, t.sequence),
    index('messages_room_idx').on(t.roomId),
    index('messages_user_idx').on(t.userId),
  ],
)

export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert

// ─────────────────────────────────────────────────────────────
// attachments
// ─────────────────────────────────────────────────────────────

export const attachments = sqliteTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['image', 'file', 'audio', 'video'] }).notNull(),
    url: text('url').notNull(),
    name: text('name'),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),
  },
  (t) => [index('attachments_message_idx').on(t.messageId)],
)

export type Attachment = typeof attachments.$inferSelect
export type NewAttachment = typeof attachments.$inferInsert

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
