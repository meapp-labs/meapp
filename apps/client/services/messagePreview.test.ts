import { expect, test } from 'bun:test'
import { messagePreview } from './messagePreview'

test('media-only previews show the decrypted attachment kind instead of unavailable', () => {
  for (const [kind, label] of [
    ['image', 'Image'],
    ['gif', 'GIF'],
    ['video', 'Video'],
    ['audio', 'Audio file'],
    ['file', 'File'],
  ] as const) {
    expect(messagePreview({ media: [{ kind }] }, 'sent')).toBe(`${label} was sent`)
    expect(messagePreview({ media: [{ kind }] }, 'received')).toBe(`${label} was received`)
  }
})

test('multiple attachments use plural or mixed-media previews', () => {
  for (const direction of ['sent', 'received'] as const) {
    expect(messagePreview({ media: [{ kind: 'image' }, { kind: 'image' }] }, direction)).toBe(
      `Images were ${direction}`,
    )
    expect(messagePreview({ media: [{ kind: 'gif' }, { kind: 'gif' }] }, direction)).toBe(
      `GIFs were ${direction}`,
    )
    expect(messagePreview({ media: [{ kind: 'video' }, { kind: 'video' }] }, direction)).toBe(
      `Videos were ${direction}`,
    )
    expect(messagePreview({ media: [{ kind: 'image' }, { kind: 'gif' }] }, direction)).toBe(
      `Attachments were ${direction}`,
    )
  }
})

test('text and captions retain their preview; missing decrypted content stays unavailable', () => {
  expect(messagePreview({ text: 'Hello' })).toBe('Hello')
  expect(messagePreview({ text: 'A caption', media: [{ kind: 'image' }] })).toBe('A caption')
  expect(messagePreview({})).toBeNull()
  expect(messagePreview({ media: [] })).toBeNull()
})
