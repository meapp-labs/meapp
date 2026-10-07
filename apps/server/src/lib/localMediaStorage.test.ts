import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { env } from './config.ts'
import {
  handleLocalMedia,
  localDelete,
  localHead,
  localObjectPath,
  localSignedPut,
} from './localMediaStorage.ts'

const previous = { directory: env.MEDIA_LOCAL_DIRECTORY, url: env.MEDIA_LOCAL_PUBLIC_URL }
let directory = ''
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'meapp-local-media-'))
  env.MEDIA_LOCAL_DIRECTORY = directory
  env.MEDIA_LOCAL_PUBLIC_URL = 'http://127.0.0.1:3001'
})
afterAll(async () => {
  env.MEDIA_LOCAL_DIRECTORY = previous.directory
  env.MEDIA_LOCAL_PUBLIC_URL = previous.url
  // Only this test's freshly-created absolute temp directory is removed.
  if (directory.startsWith(join(tmpdir(), 'meapp-local-media-')))
    await rm(directory, { recursive: true, force: true })
})
const key = () => `cap/${crypto.randomUUID().replaceAll('-', '')}/orig.enc`
const put = (url: string, bytes: Uint8Array) =>
  handleLocalMedia(
    new Request(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(bytes),
    }),
  )

test('local signed uploads are immutable and public capability reads return exact ciphertext', async () => {
  const object = key()
  const bytes = new Uint8Array(1024 * 1024).fill(42)
  const url = localSignedPut(object, 60, bytes.length, 'application/octet-stream')
  expect((await put(url, bytes)).status).toBe(201)
  expect(await localHead(object)).toBe(bytes.length)
  expect((await put(url, new Uint8Array(bytes.length))).status).toBe(412)
  const response = await handleLocalMedia(new Request(`http://localhost/${object}`))
  expect(response.headers.get('content-type')).toBe('application/octet-stream')
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
  await localDelete(object)
  expect(await localHead(object)).toBeNull()
  expect((await handleLocalMedia(new Request(`http://localhost/${object}`))).status).toBe(404)
})
test('local authorization binds path, size, MIME, expiry and rejects truncation / overflow', async () => {
  const object = key()
  const url = localSignedPut(object, 60, 100, 'application/octet-stream')
  expect((await put(url.replace(object, key()), new Uint8Array(100))).status).toBe(403)
  expect((await put(url.replace('size=100', 'size=101'), new Uint8Array(101))).status).toBe(403)
  expect(
    (await put(localSignedPut(object, -1, 100, 'application/octet-stream'), new Uint8Array(100)))
      .status,
  ).toBe(403)
  expect((await put(url, new Uint8Array(99))).status).toBe(400)
  expect((await put(url, new Uint8Array(101))).status).toBe(413)
  expect(await localHead(object)).toBeNull()
  expect(await readdir(join(directory, 'cap', object.split('/')[1] as string))).toEqual([])
  expect(() => localObjectPath('../outside')).toThrow()
})
test('concurrent local uploads publish only one complete object', async () => {
  const object = key()
  const url = localSignedPut(object, 60, 100, 'application/octet-stream')
  const responses = await Promise.all([
    put(url, new Uint8Array(100).fill(1)),
    put(url, new Uint8Array(100).fill(2)),
  ])
  expect(responses.map((r) => r.status).sort()).toEqual([201, 412])
  const stored = new Uint8Array(
    await (await handleLocalMedia(new Request(`http://localhost/${object}`))).arrayBuffer(),
  )
  expect(stored.every((byte) => byte === stored[0])).toBe(true)
})
