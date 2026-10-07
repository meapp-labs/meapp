import { expect, test } from 'bun:test'
import type { Message, MessagesResponse } from '@meapp/shared'
import { type RoomSyncCursor, synchronizeRoomStream } from './threadStream'

const message = (sequence: number, addressed = true): Message => ({
  id: `m${sequence}`,
  sequence,
  ciphertext: 'encrypted',
  type: 'text',
  envelopeAvailable: addressed,
  ...(sequence > 1 ? { threadRootId: 'm1' } : {}),
})
const page = (messages: Message[], hasMore = false, audience = '0:0'): MessagesResponse => ({
  messages,
  hasMore,
  totalCount: messages.length,
  firstUnreadSequence: null,
  historyAudienceVersion: audience,
  nextAfter: messages.at(-1)?.sequence ?? 0,
})

test('offline catch-up processes hidden thread pages in sequence before saving the cursor', async () => {
  const seen: number[] = []
  const cursors: RoomSyncCursor[] = []
  const requests: number[] = []
  await synchronizeRoomStream(null, {
    fetchPage: async (after) => {
      requests.push(after)
      return after === 0 ? page([message(1), message(2)], true) : page([message(3), message(4)])
    },
    decrypt: async (entry) => {
      seen.push(entry.sequence ?? 0)
    },
    save: async (cursor) => {
      cursors.push(cursor)
    },
    onFailure: () => {
      throw new Error('Unexpected failure')
    },
  })
  expect(requests).toEqual([0, 2])
  expect(seen).toEqual([1, 2, 3, 4])
  expect(cursors.map((cursor) => cursor.after)).toEqual([2, 4])
})

test('an addressed decryption failure retains a retry cursor across later pages', async () => {
  const cursors: RoomSyncCursor[] = []
  let failures = 0
  await synchronizeRoomStream(null, {
    fetchPage: async (after) =>
      after === 0 ? page([message(1), message(2)], true) : page([message(3), message(4)]),
    decrypt: async (entry) => {
      if (entry.sequence === 2) throw new Error('History needs repair')
    },
    save: async (cursor) => {
      cursors.push(cursor)
    },
    onFailure: () => {
      failures++
    },
  })
  expect(failures).toBe(1)
  expect(cursors.map((cursor) => cursor.after)).toEqual([1, 1])
})

test('legitimate linked history resets an old cursor and unaddressed markers do not block progress', async () => {
  const cursors: RoomSyncCursor[] = []
  await synchronizeRoomStream(
    { after: 50, audience: '0:0' },
    {
      fetchPage: async (after, audience) => {
        expect(after).toBe(50)
        expect(audience).toBe('0:0')
        return page([message(1, false), message(2)], false, '2:80')
      },
      decrypt: async (entry) => {
        if (!entry.envelopeAvailable) throw new Error('Not addressed to this device')
      },
      save: async (cursor) => {
        cursors.push(cursor)
      },
      onFailure: () => {
        throw new Error('Unaddressed markers are expected')
      },
    },
  )
  expect(cursors).toEqual([{ after: 2, audience: '2:80' }])
})
