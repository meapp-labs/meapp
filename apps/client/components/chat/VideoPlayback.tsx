import { VideoView, useVideoPlayer } from 'expo-video'

export function VideoPlayback({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri)
  return (
    <VideoView
      player={player}
      nativeControls
      style={{ width: 260, height: 200 }}
      fullscreenOptions={{ enable: true }}
    />
  )
}
