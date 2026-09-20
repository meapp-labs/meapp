// Re-export all Zod-inferred types as the canonical type source.
// Add hand-written types below only when they cannot be expressed as Zod schemas.
export type {
  AddContactInput,
  Attachment,
  Conversation,
  CreateConversationInput,
  GetMessagesQuery,
  LoginInput,
  LoginType,
  Message,
  CreateMessageInput,
  MessageWsIncoming,
  MessageWsOutgoing,
  MessagesResponse,
  Platform,
  PushTokenInput,
  RegisterInput,
  RegisterType,
  Room,
  CreateRoomInput,
  SendMessageInput,
  SendMessageRequest,
  User,
} from '../schemas/index.ts'

// ─────────────────────────────────────────────────────────────
// API response envelope
// ─────────────────────────────────────────────────────────────

export type ApiError = {
  code: string
  message: string
  statusCode: number
  details?: Record<string, unknown>
}

export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: ApiError }
