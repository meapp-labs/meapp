import { expect, test } from 'bun:test'
import { MEDIA_MAX_BYTES } from '@meapp/shared'
import { attachmentCacheName, droppedMediaTypes, safeAttachmentName } from './droppedMedia'

test('dropped images preserve GIFs and recognize files with missing browser MIME types', () => {
  expect(
    droppedMediaTypes([
      { name: 'photo.png', type: 'image/png', size: 10 },
      { name: 'animation.GIF', type: '', size: 10 },
    ]),
  ).toEqual(['image/png', 'image/gif'])
})

test('empty, oversized and excess files are rejected as a whole', () => {
  expect(droppedMediaTypes([{ name: 'large.zip', type: '', size: MEDIA_MAX_BYTES - 28 }])).toEqual([
    'application/zip',
  ])
  for (const files of [
    [],
    [{ name: 'image.png', type: 'image/png', size: 0 }],
    [{ name: 'image.png', type: 'image/png', size: MEDIA_MAX_BYTES - 27 }],
    Array.from({ length: 5 }, () => ({ name: 'image.png', type: 'image/png', size: 10 })),
  ])
    expect(() => droppedMediaTypes(files)).toThrow()
})

test('all extensions including MP4, MP3, ZIP, HTML and unknown binary files are accepted', () => {
  expect(
    droppedMediaTypes([
      { name: 'movie.mp4', type: 'application/octet-stream', size: 10 },
      { name: 'track.mp3', type: '', size: 10 },
      { name: 'archive.zip', type: '', size: 10 },
      { name: 'payload.custom', type: '', size: 10 },
    ]),
  ).toEqual(['video/mp4', 'audio/mpeg', 'application/zip', 'application/octet-stream'])
  expect(droppedMediaTypes([{ name: 'page.html', type: 'text/html', size: 10 }])).toEqual([
    'text/html',
  ])
  expect(droppedMediaTypes([{ name: 'bad', type: 'bad\r\nheader', size: 10 }])).toEqual([
    'application/octet-stream',
  ])
})

test('cache paths use safe extensions and attachment names remove paths and control characters', () => {
  const id = crypto.randomUUID()
  expect(attachmentCacheName(id, 'application/zip', 'backup.zip')).toBe(`${id}.zip`)
  expect(attachmentCacheName(id, 'text/html', '../foo.longextensionlongextension')).toBe(
    `${id}.bin`,
  )
  expect(safeAttachmentName('../foo\\bar\n.zip')).toBe('.._foo_bar_.zip')
})
