import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

// ─────────────────────────────────────────────────────────────
// users
// ─────────────────────────────────────────────────────────────

export const users = sqliteTable('users', {
  id: text('id').primaryKey(), // UUID v4
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  platform: text('platform', { enum: ['ios', 'android', 'web'] }),
  pushToken: text('push_token'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert

// ─────────────────────────────────────────────────────────────
// sessions
// ─────────────────────────────────────────────────────────────

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(), // UUID v4
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
)

export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert

// ─────────────────────────────────────────────────────────────
// conversations
// ─────────────────────────────────────────────────────────────

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(), // UUID v4
  name: text('name'), // null for 1-on-1 DMs
  isGroup: integer('is_group', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export type Conversation = typeof conversations.$inferSelect
export type NewConversation = typeof conversations.$inferInsert

// ─────────────────────────────────────────────────────────────
// participants  (conversation members)
// ─────────────────────────────────────────────────────────────

export const participants = sqliteTable(
  'participants',
  {
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: integer('joined_at', { mode: 'timestamp_ms' }).notNull(),
    // last message index the user has read
    lastReadIndex: integer('last_read_index').notNull().default(0),
  },
  (t) => [
    unique('participants_pk').on(t.conversationId, t.userId),
    index('participants_conversation_idx').on(t.conversationId),
    index('participants_user_idx').on(t.userId),
  ],
)

export type Participant = typeof participants.$inferSelect
export type NewParticipant = typeof participants.$inferInsert

// ─────────────────────────────────────────────────────────────
// messages
// ─────────────────────────────────────────────────────────────

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(), // UUID v4
    /** Monotonically increasing index within the conversation */
    index: integer('index').notNull(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    fromUserId: text('from_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type', {
      enum: ['text', 'image', 'file', 'audio', 'video', 'system'],
    })
      .notNull()
      .default('text'),
    text: text('text').notNull(),
    /** JSON-encoded reactions map: { "👍": ["userId1", "userId2"] } */
    reactions: text('reactions'),
    /** JSON-encoded metadata object */
    metadata: text('metadata'),
    threadId: text('thread_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    editedAt: integer('edited_at', { mode: 'timestamp_ms' }),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('messages_conversation_idx').on(t.conversationId),
    index('messages_conversation_index_idx').on(t.conversationId, t.index),
    index('messages_from_user_idx').on(t.fromUserId),
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
    id: text('id').primaryKey(), // UUID v4
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
