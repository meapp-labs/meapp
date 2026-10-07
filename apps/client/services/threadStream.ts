import type { Message, MessagesResponse } from '@meapp/shared'

export type RoomSyncCursor = { after: number; audience: string }

/** Process the complete room stream even when the current view hides threads. */
export async function synchronizeRoomStream(
  saved: RoomSyncCursor | null,
  io: {
    fetchPage: (after: number, audience?: string) => Promise<MessagesResponse>
    decrypt: (message: Message) => Promise<unknown>
    save: (cursor: RoomSyncCursor) => Promise<void>
    onFailure: (error: unknown) => void
  },
) {
  let after = saved?.after ?? 0
  let checkpoint = after
  let audience = saved?.audience
  let failed = false
  let page: MessagesResponse
  do {
    page = await io.fetchPage(after, audience)
    if (audience && audience !== page.historyAudienceVersion) {
      checkpoint = 0
      failed = false
    }
    audience = page.historyAudienceVersion
    for (const message of page.messages) {
      try {
        await io.decrypt(message)
      } catch (error) {
        // New members can encounter unaddressed historical markers. An addressed
        // failure holds the durable checkpoint so history repair can retry it.
        if (message.envelopeAvailable) {
          failed = true
          io.onFailure(error)
        }
      }
      if (!failed && message.sequence !== undefined) checkpoint = message.sequence
    }
    after = page.nextAfter ?? page.messages.at(-1)?.sequence ?? after
    await io.save({ after: checkpoint, audience: audience ?? '0:0' })
  } while (page.hasMore)
}
