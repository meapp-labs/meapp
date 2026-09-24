import { expect, it } from 'bun:test'
import { chatTimestampIso } from './dbTime.ts'

it('normalizes both legacy millisecond and current second SQLite timestamps', () => {
  const iso = '2026-09-24T12:34:56.000Z'
  const milliseconds = Date.parse(iso)
  const seconds = milliseconds / 1000

  expect(chatTimestampIso(milliseconds)).toBe(iso)
  expect(chatTimestampIso(seconds)).toBe(iso)
  expect(chatTimestampIso(new Date(milliseconds * 1000))).toBe(iso)
  expect(chatTimestampIso(new Date(milliseconds))).toBe(iso)
})
