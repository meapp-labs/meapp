import { z } from 'zod'
export const notificationSettingsSchema = z.strictObject({
  messages: z.boolean(),
  friendRequests: z.boolean(),
  quietHours: z.boolean(),
  quietStart: z.number().int().min(0).max(1439),
  quietEnd: z.number().int().min(0).max(1439),
  timeZone: z
    .string()
    .max(100)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value })
        return true
      } catch {
        return false
      }
    }, 'Use a valid IANA time zone'),
})
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>
export const defaultNotificationSettings: NotificationSettings = {
  messages: true,
  friendRequests: true,
  quietHours: false,
  quietStart: 1320,
  quietEnd: 480,
  timeZone: 'UTC',
}
export const conversationMuteSchema = z.strictObject({ muted: z.boolean() })
export function notificationsQuiet(settings: NotificationSettings, date = new Date()): boolean {
  if (!settings.quietHours) return false
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: settings.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const minute =
    Number(parts.find((p) => p.type === 'hour')?.value) * 60 +
    Number(parts.find((p) => p.type === 'minute')?.value)
  const { quietStart: start, quietEnd: end } = settings
  return (
    start === end ||
    (start < end ? minute >= start && minute < end : minute >= start || minute < end)
  )
}
