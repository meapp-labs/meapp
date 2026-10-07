import { Button } from '@/components/common/Button'
import { Switch } from '@/components/common/Switch'
import { Text } from '@/components/common/Text'
import { useNotificationSettings } from '@/services/notificationPreferences'
import { theme } from '@/theme/theme'
import { notificationSettingsSchema } from '@meapp/shared'
import { useEffect, useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
const timeText = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
function timeMinutes(value: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Enter times as HH:MM')
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
}
export function Notifications() {
  const settings = useNotificationSettings()
  const [start, setStart] = useState('22:00')
  const [end, setEnd] = useState('08:00')
  const [zone, setZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [message, setMessage] = useState('')
  useEffect(() => {
    if (settings.data) {
      setStart(timeText(settings.data.quietStart))
      setEnd(timeText(settings.data.quietEnd))
      setZone(settings.data.timeZone)
    }
  }, [settings.data])
  const save = async (patch: Partial<NonNullable<typeof settings.data>>) => {
    if (!settings.data) return
    setMessage('')
    try {
      await settings.update.mutateAsync(
        notificationSettingsSchema.parse({ ...settings.data, ...patch }),
      )
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save notification settings')
    }
  }
  return (
    <View style={styles.container}>
      <Text style={styles.description}>
        Push preferences apply across your devices. Mute individual chats from their menu. Muting
        keeps messages and unread counts.
      </Text>
      {!settings.data && (
        <Text style={styles.description}>
          {settings.isError ? 'Unable to load preferences.' : 'Loading…'}
        </Text>
      )}
      {settings.isError && (
        <Button
          title="Retry"
          onPress={() => {
            void settings.refetch()
          }}
        />
      )}
      {settings.data && (
        <>
          <View style={styles.card}>
            {(
              [
                ['messages', 'Message notifications'],
                ['friendRequests', 'Friend requests'],
                ['quietHours', 'Quiet hours'],
              ] as const
            ).map(([key, label]) => (
              <View key={key} style={styles.preference}>
                <Text style={styles.preferenceLabel}>{label}</Text>
                <Switch
                  accessibilityLabel={label}
                  value={settings.data?.[key]}
                  disabled={settings.update.isPending}
                  onValueChange={(value) => {
                    void save({ [key]: value })
                  }}
                />
              </View>
            ))}
          </View>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Quiet hours schedule</Text>
            <Text style={styles.description}>
              Use 24-hour time. Matching start and end times silence notifications all day.
            </Text>
            <View style={styles.timeRow}>
              <View style={styles.timeField}>
                <Text style={styles.label}>Starts at</Text>
                <TextInput
                  accessibilityLabel="Quiet hours start"
                  value={start}
                  onChangeText={setStart}
                  placeholder="22:00"
                  placeholderTextColor={theme.colors.textTertiary}
                  style={styles.input}
                />
              </View>
              <View style={styles.timeField}>
                <Text style={styles.label}>Ends at</Text>
                <TextInput
                  accessibilityLabel="Quiet hours end"
                  value={end}
                  onChangeText={setEnd}
                  placeholder="08:00"
                  placeholderTextColor={theme.colors.textTertiary}
                  style={styles.input}
                />
              </View>
            </View>
            <Text style={styles.label}>Time zone</Text>
            <TextInput
              accessibilityLabel="Quiet hours time zone"
              autoCapitalize="none"
              value={zone}
              onChangeText={setZone}
              placeholder="Europe/Warsaw"
              placeholderTextColor={theme.colors.textTertiary}
              style={styles.input}
            />
          </View>
          <Button
            title="Save quiet hours"
            loading={settings.update.isPending}
            onPress={() => {
              try {
                void save({
                  quietStart: timeMinutes(start),
                  quietEnd: timeMinutes(end),
                  timeZone: zone.trim(),
                })
              } catch (error) {
                setMessage(error instanceof Error ? error.message : 'Invalid time')
              }
            }}
          />
        </>
      )}
      {!!message && (
        <Text style={styles.message} accessibilityLiveRegion="polite">
          {message}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: 20 },
  description: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 23 },
  card: {
    gap: 16,
    padding: 18,
    borderRadius: 18,
    backgroundColor: theme.colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: theme.colors.borderSecondary,
  },
  preference: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 44,
  },
  preferenceLabel: { flex: 1, fontSize: 14, fontWeight: '500', lineHeight: 22 },
  sectionTitle: { fontSize: 16, fontWeight: '600' },
  label: { fontSize: 13, fontWeight: '500', color: theme.colors.textSecondary },
  timeRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  timeField: { flex: 1, minWidth: 100, gap: 8 },
  input: {
    color: theme.colors.text,
    fontSize: 15,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    padding: 14,
    minHeight: 50,
  },
  message: { color: theme.colors.error, fontSize: 14, lineHeight: 22 },
})
