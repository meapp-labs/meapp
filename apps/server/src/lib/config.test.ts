import { expect, test } from 'bun:test'
import { serverEnvSchema } from './config'

const media = {
  R2_ACCOUNT_ID: 'a'.repeat(32),
  R2_ACCESS_KEY_ID: 'test-access',
  R2_SECRET_ACCESS_KEY: 'test-secret',
  R2_BUCKET: 'media-test',
  R2_PUBLIC_URL: 'https://media.example.test',
}

test('media configuration is optional but partial credentials fail startup validation', () => {
  expect(serverEnvSchema.safeParse({}).success).toBe(true)
  expect(serverEnvSchema.safeParse(media).success).toBe(true)
  expect(serverEnvSchema.safeParse({ R2_BUCKET: 'media-test' }).success).toBe(false)
})

test('media quota defaults to 2 GB and remains configurable', () => {
  expect(serverEnvSchema.parse({}).MEDIA_USER_QUOTA_BYTES).toBe(2 * 1024 * 1024 * 1024)
  expect(serverEnvSchema.parse({ MEDIA_USER_QUOTA_BYTES: '123' }).MEDIA_USER_QUOTA_BYTES).toBe(123)
})
test('public media configuration rejects malformed endpoints and unsafe URL components', () => {
  for (const url of [
    'not a url',
    'http://media.example.test',
    'https://user:password@media.example.test',
    'https://media.example.test/path',
    'https://media.example.test?token=test',
    'https://media.example.test#fragment',
  ]) {
    expect(serverEnvSchema.safeParse({ ...media, R2_PUBLIC_URL: url }).success).toBe(false)
  }
  expect(serverEnvSchema.safeParse({ ...media, R2_ACCOUNT_ID: 'bad/account' }).success).toBe(false)
  expect(serverEnvSchema.safeParse({ ...media, R2_BUCKET: '../other' }).success).toBe(false)
})
