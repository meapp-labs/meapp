import type { SequenceResult } from '@meapp/db'
import { type Message, wireMessageSchema } from '@meapp/shared'
import { chatTimestampIso } from './dbTime.ts'

export function buildDeliveredMessage(
  result: SequenceResult,
  fields: Omit<Message, 'id' | 'sequence' | 'index' | 'createdAt' | 'timestamp' | 'type'>,
): Message {
  const timestamp = chatTimestampIso(result.createdAt)
  return wireMessageSchema.parse({
    ...fields,
    id: result.id,
    sequence: result.sequence,
    index: result.sequence,
    createdAt: timestamp,
    timestamp,
    type: 'text',
  })
}

/** Thread replies announce a change without exposing their content to the whole room. */
export function messageRoomEvent(message: Message): string {
  return JSON.stringify(
    message.threadRootId
      ? { type: 'thread-changed', payload: { roomId: message.roomId } }
      : { type: 'message', payload: message },
  )
}
