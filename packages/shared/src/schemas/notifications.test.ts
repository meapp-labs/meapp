import { expect, test } from 'bun:test'
import {
  defaultNotificationSettings,
  notificationSettingsSchema,
  notificationsQuiet,
} from './notifications'
test('quiet hours respect midnight, exclusive end, equal times and DST zones', () => {
  const settings = { ...defaultNotificationSettings, quietHours: true, timeZone: 'Europe/Warsaw' }
  expect(notificationsQuiet(settings, new Date('2026-10-07T20:00:00Z'))).toBe(true)
  expect(notificationsQuiet(settings, new Date('2026-10-08T06:00:00Z'))).toBe(false)
  expect(notificationsQuiet(settings, new Date('2026-12-08T06:59:00Z'))).toBe(true)
  expect(notificationsQuiet(settings, new Date('2026-12-08T07:00:00Z'))).toBe(false)
  expect(
    notificationsQuiet(
      { ...settings, quietStart: 600, quietEnd: 660 },
      new Date('2026-10-07T08:00:00Z'),
    ),
  ).toBe(true)
  expect(notificationsQuiet({ ...settings, quietStart: 0, quietEnd: 0 })).toBe(true)
  expect(notificationsQuiet({ ...settings, quietHours: false })).toBe(false)
  expect(notificationSettingsSchema.safeParse({ ...settings, timeZone: 'invalid' }).success).toBe(
    false,
  )
})
