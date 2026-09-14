// ─────────────────────────────────────────────────────────────
// Message Types
// ─────────────────────────────────────────────────────────────

export type MessageType =
  | 'text'
  | 'image'
  | 'file'
  | 'audio'
  | 'video'
  | 'system';

export type Attachment = {
  id: string;
  url: string;
  type: 'image' | 'file' | 'audio' | 'video';
  name?: string;
  size?: number;
  mimeType?: string;
};

export type Message = {
  /** Unique message ID (UUID) */
  id: string;
  /** Username of sender */
  from: string;
  /** Message content */
  text: string;
  /** Message type for different content kinds */
  type: MessageType;
  /** ISO timestamp when sent */
  timestamp: string;
  /** ISO timestamp if edited (optional) */
  editedAt?: string;
  /** ISO timestamp if deleted - soft delete (optional) */
  deletedAt?: string;
  /** Thread parent message ID - if this message is a thread reply */
  threadId?: string;
  /** Number of replies in thread - only on parent message */
  threadReplyCount?: number;
  /** Emoji reactions: { "👍": ["alice", "bob"], "❤️": ["charlie"] } */
  reactions?: Record<string, string[]>;
  /** File attachments for media messages */
  attachments?: Attachment[];
  /** Extensible metadata for future features */
  metadata?: Record<string, unknown>;
};

// ─────────────────────────────────────────────────────────────
// Conversation Types
// ─────────────────────────────────────────────────────────────

export type Conversation = {
  /** Unique conversation ID (UUID) */
  id: string;
  /** List of participant usernames */
  participants: string[];
  /** Whether this is a group conversation */
  isGroup: boolean;
  /** Custom name */
  name?: string;
  /** Group avatar URL (only for groups) */
  avatarUrl?: string;
  /** ISO timestamp when created */
  createdAt: string;
  /** ISO timestamp of last message (for sorting) */
  lastMessageAt?: string;
  /** Preview of last message for conversation list */
  lastMessagePreview?: string;
  /** Username of last message sender */
  lastMessageFrom?: string;
  /** Per-user read state: { "alice": 42, "bob": 40 } = last read message index */
  readState?: Record<string, number>;
  /** Users who have muted notifications */
  mutedBy?: string[];
  /** Users who have archived this conversation */
  archivedBy?: string[];
  /** Users who have pinned this conversation */
  pinnedBy?: string[];
  /** Username of conversation creator (for groups) */
  createdBy?: string;
  /** Extensible metadata for future features */
  metadata?: Record<string, unknown>;
};
