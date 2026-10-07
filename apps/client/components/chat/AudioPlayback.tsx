import { theme } from '@/theme/theme'
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { Pressable, Text, View } from 'react-native'

export function AudioPlayback({ uri }: { uri: string }) {
  const player = useAudioPlayer(uri)
  const status = useAudioPlayerStatus(player)
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: theme.colors.text }}>
        {Math.floor(status.currentTime)} / {Math.floor(status.duration)} s
      </Text>
      <View style={{ flexDirection: 'row', gap: 20 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={status.playing ? 'Pause audio' : 'Play audio'}
          onPress={async () => {
            if (status.playing) player.pause()
            else {
              if (
                status.didJustFinish ||
                (status.duration > 0 && status.currentTime >= status.duration)
              )
                await player.seekTo(0)
              player.play()
            }
          }}
        >
          <Text style={{ color: theme.colors.text }}>{status.playing ? 'Pause' : 'Play'}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            player.pause()
            void player.seekTo(0)
          }}
        >
          <Text style={{ color: theme.colors.text }}>Restart</Text>
        </Pressable>
      </View>
    </View>
  )
}
