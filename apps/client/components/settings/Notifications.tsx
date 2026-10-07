import { Button } from '@/components/common/Button'
import { Text } from '@/components/common/Text'
import { useNotificationSettings } from '@/services/notificationPreferences'
import { theme } from '@/theme/theme'
import { notificationSettingsSchema } from '@meapp/shared'
import { useEffect, useState } from 'react'
import { Switch, TextInput, View } from 'react-native'
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
  const inputStyle = {
    color: theme.colors.text,
    borderWidth: 1,
    borderColor: theme.colors.secondary,
    borderRadius: 6,
    padding: 10,
  }
  return (
    <View style={{ gap: 16 }}>
      <Text>
        Push preferences apply across your devices. Mute individual chats from their menu. Muting
        keeps messages and unread counts.
      </Text>
      {!settings.data && (
        <Text>{settings.isError ? 'Unable to load preferences.' : 'Loading…'}</Text>
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
          {(
            [
              ['messages', 'Message notifications'],
              ['friendRequests', 'Friend requests'],
              ['quietHours', 'Quiet hours'],
            ] as const
          ).map(([key, label]) => (
            <View
              key={key}
              style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}
            >
              <Text>{label}</Text>
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
          <Text>
            Quiet hours start and end (24-hour time). Equal times silence notifications all day.
          </Text>
          <TextInput
            accessibilityLabel="Quiet hours start"
            value={start}
            onChangeText={setStart}
            style={inputStyle}
          />
          <TextInput
            accessibilityLabel="Quiet hours end"
            value={end}
            onChangeText={setEnd}
            style={inputStyle}
          />
          <Text>Time zone, for example Europe/Warsaw</Text>
          <TextInput
            accessibilityLabel="Quiet hours time zone"
            autoCapitalize="none"
            value={zone}
            onChangeText={setZone}
            style={inputStyle}
          />
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
      {!!message && <Text accessibilityLiveRegion="polite">{message}</Text>}
    </View>
  )
}
