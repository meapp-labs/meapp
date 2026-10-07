import { expect, it } from 'bun:test'
import { apiEndpoint, endpoint } from './endpoints'

it('builds canonical URLs and preserves query encoding and configured base paths', () => {
  expect(
    endpoint('https://example.test/chat/', 'api/profiles', {
      username: 'A & B',
      missing: undefined,
    }),
  ).toBe('https://example.test/chat/api/profiles?username=A+%26+B')
  expect(apiEndpoint('https://example.test', '/ws/ticket')).toBe('https://example.test/ws/ticket')
  expect(apiEndpoint('https://example.test', 'health')).toBe('https://example.test/health')
  expect(apiEndpoint('https://example.test', 'conversations')).toBe(
    apiEndpoint('https://example.test', '/api/conversations'),
  )
})
