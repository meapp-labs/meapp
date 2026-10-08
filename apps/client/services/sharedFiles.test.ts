import { expect, test } from 'bun:test'
import type { MediaDescriptor, Message } from '@meapp/shared'
import { collectSharedFiles, filterSharedFiles } from './sharedFiles'

const attachment = (
  id: string,
  kind: MediaDescriptor['kind'],
  fileName: string,
): MediaDescriptor => ({
  v: 1,
  id,
  kind,
  fileName,
  base: 'cap/test',
  key: 'test',
  variants: [],
})
const photo = attachment('photo', 'image', 'ＨＯＬＩＤＡＹ.webp')
const document = attachment('document', 'file', 'Budget.pdf')
const gif = attachment('gif', 'gif', 'Reaction.gif')
const message: Message = {
  id: 'one',
  type: 'text',
  from: 'Alice',
  text: 'Summer plans',
  timestamp: '2026-06-10T12:00:00Z',
  sequence: 2,
  media: [photo, document],
}

test('attachment search matches individual filenames and combines sender, caption and type filters', () => {
  const files = collectSharedFiles([message])
  expect(
    filterSharedFiles(files, 'holiday alice', 'photos').map((file) => file.descriptor.id),
  ).toEqual(['photo'])
  expect(filterSharedFiles(files, 'budget', 'all').map((file) => file.descriptor.id)).toEqual([
    'document',
  ])
  expect(filterSharedFiles(files, 'summer', 'all')).toHaveLength(2)
  expect(filterSharedFiles(files, 'budget', 'photos')).toEqual([])
  expect(filterSharedFiles(files, 'bob', 'all')).toEqual([])
  expect(filterSharedFiles(files, '2026-06', 'file')).toHaveLength(1)
})

test('collection deduplicates overlapping history, excludes unavailable messages and orders dates newest first', () => {
  const older: Message = {
    id: 'older',
    type: 'text',
    sequence: 1,
    timestamp: '2025-01-01T12:00:00Z',
    media: [gif],
  }
  const hidden: Message = {
    id: 'hidden',
    type: 'undecryptable',
    media: [attachment('hidden', 'file', 'Secret.pdf')],
  }
  const files = collectSharedFiles([older, message, message, hidden])
  expect(files.map((file) => file.descriptor.id)).toEqual(['photo', 'document', 'gif'])
  expect(files.map((file) => file.month)).toEqual(['2026-06', '2026-06', '2025-01'])
  expect(filterSharedFiles(files, '', 'photos')).toHaveLength(2)
})

test('missing or invalid timestamps remain browsable without invalid date labels', () => {
  expect(collectSharedFiles([{ ...message, timestamp: 'invalid' }])[0]?.day).toBe('unknown')
  expect(collectSharedFiles([{ ...message, timestamp: undefined }])[0]?.month).toBe('unknown')
})
