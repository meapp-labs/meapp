import { expect, test } from 'bun:test'
import { linkPresentation } from './linkPresentation'

test('common destinations get useful labels and content icons', () => {
  for (const [url, title, icon] of [
    ['https://youtu.be/video?t=30', 'YouTube', 'play-circle-outline'],
    ['https://www.youtube.com/shorts/video', 'YouTube Short', 'play-circle-outline'],
    ['https://youtube.com/playlist?list=123', 'YouTube playlist', 'play-circle-outline'],
    ['https://open.spotify.com/intl-pl/track/123', 'Spotify track', 'music-note'],
    ['https://open.spotify.com/playlist/123', 'Spotify playlist', 'music-note'],
    ['https://music.apple.com/pl/album/example/123', 'Apple Music', 'music-note'],
    ['https://soundcloud.com/artist/song', 'SoundCloud', 'music-note'],
    ['https://github.com/owner/repo/pull/42', 'owner/repo · PR #42', 'code'],
    ['https://github.com/owner/repo/issues/12', 'owner/repo · Issue #12', 'code'],
    ['https://github.com/owner/repo', 'owner/repo', 'code'],
    ['https://en.wikipedia.org/wiki/Chat_application', 'Chat application', 'article'],
    ['https://maps.app.goo.gl/123', 'Google Maps', 'place'],
    ['https://www.google.com/maps/search/Paris', 'Google Maps', 'place'],
    ['https://maps.apple.com/?q=Paris', 'Apple Maps', 'place'],
    ['https://discord.gg/example', 'Discord invite', 'chat'],
    ['https://discord.com/invite/example', 'Discord invite', 'chat'],
    ['https://www.reddit.com/r/programming/comments/123', 'Reddit · r/programming', 'chat'],
    ['https://www.instagram.com/reel/123', 'Instagram Reel', 'photo-camera'],
    ['https://www.tiktok.com/@creator/video/123', 'TikTok', 'play-circle-outline'],
    ['https://www.twitch.tv/creator', 'Twitch', 'play-circle-outline'],
    ['https://vimeo.com/123', 'Vimeo', 'play-circle-outline'],
    ['https://x.com/user/status/123', 'X', 'people'],
    ['https://twitter.com/user/status/123', 'X', 'people'],
    ['https://www.facebook.com/post/123', 'Facebook', 'people'],
    ['https://www.linkedin.com/in/user', 'LinkedIn', 'people'],
  ] as const) {
    expect(linkPresentation(url)).toMatchObject({ title, icon })
  }
})

test('branding requires a matching hostname and always exposes the real destination', () => {
  for (const host of ['notyoutube.com', 'youtube.com.example.org', 'github.com.evil.test']) {
    expect(linkPresentation(`https://${host}/path`)).toEqual({
      title: host,
      icon: 'link',
      destination: `${host}/path`,
    })
  }
  expect(linkPresentation('https://youtube.com@evil.test/video').title).toBe('evil.test')
  expect(linkPresentation('https://m.youtube.com/watch?v=123&t=30').destination).toBe(
    'm.youtube.com/watch',
  )
  expect(linkPresentation('https://example.com:8443/')).toEqual({
    title: 'example.com',
    icon: 'link',
    destination: 'example.com:8443',
  })
})

test('malformed encoded Wikipedia titles use a readable fallback', () => {
  expect(linkPresentation('https://en.wikipedia.org/wiki/%E0%A4%A').title).toBe('Wikipedia')
})
