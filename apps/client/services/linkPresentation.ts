export type LinkPresentation = {
  title: string
  destination: string
  icon:
    | 'link'
    | 'play-circle-outline'
    | 'music-note'
    | 'code'
    | 'article'
    | 'place'
    | 'chat'
    | 'people'
    | 'photo-camera'
}

/** Local presentation only: never fetch previews from a decrypted message's destination. */
export function linkPresentation(value: string): LinkPresentation {
  const url = new URL(value)
  const host = url.hostname.toLowerCase()
  const path = url.pathname.split('/').filter(Boolean)
  const is = (...domains: string[]) =>
    domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
  let title = host.replace(/^www\./, '')
  let icon: LinkPresentation['icon'] = 'link'

  if (is('youtube.com', 'youtu.be')) {
    title =
      path[0] === 'shorts'
        ? 'YouTube Short'
        : path[0] === 'playlist'
          ? 'YouTube playlist'
          : 'YouTube'
    icon = 'play-circle-outline'
  } else if (is('spotify.com')) {
    const kind = path.find((part) =>
      ['track', 'album', 'playlist', 'episode', 'show'].includes(part),
    )
    title = kind ? `Spotify ${kind}` : 'Spotify'
    icon = 'music-note'
  } else if (is('music.apple.com', 'soundcloud.com')) {
    title = is('soundcloud.com') ? 'SoundCloud' : 'Apple Music'
    icon = 'music-note'
  } else if (is('github.com')) {
    const repo = path.length >= 2 ? `${path[0]}/${path[1]}` : ''
    const kind = path[2] === 'pull' ? 'PR' : path[2] === 'issues' ? 'Issue' : ''
    title = kind && /^\d+$/.test(path[3] ?? '') ? `${repo} · ${kind} #${path[3]}` : repo || 'GitHub'
    icon = 'code'
  } else if (is('wikipedia.org')) {
    try {
      title =
        path[0] === 'wiki' && path[1] ? decodeURIComponent(path[1]).replace(/_/g, ' ') : 'Wikipedia'
    } catch {
      title = 'Wikipedia'
    }
    icon = 'article'
  } else if (
    is('maps.google.com', 'maps.app.goo.gl', 'maps.apple.com') ||
    (is('google.com') && path[0] === 'maps') ||
    (is('goo.gl') && path[0] === 'maps')
  ) {
    title = is('maps.apple.com') ? 'Apple Maps' : 'Google Maps'
    icon = 'place'
  } else if (is('discord.gg', 'discord.com')) {
    title = is('discord.gg') || path[0] === 'invite' ? 'Discord invite' : 'Discord'
    icon = 'chat'
  } else if (is('reddit.com', 'redd.it')) {
    title = path[0] === 'r' && path[1] ? `Reddit · r/${path[1]}` : 'Reddit'
    icon = 'chat'
  } else if (is('instagram.com')) {
    title = path[0] === 'reel' ? 'Instagram Reel' : 'Instagram'
    icon = 'photo-camera'
  } else if (is('tiktok.com', 'twitch.tv', 'vimeo.com')) {
    title = is('tiktok.com') ? 'TikTok' : is('twitch.tv') ? 'Twitch' : 'Vimeo'
    icon = 'play-circle-outline'
  } else if (is('x.com', 'twitter.com', 'facebook.com', 'fb.watch', 'linkedin.com')) {
    title = is('x.com', 'twitter.com') ? 'X' : is('linkedin.com') ? 'LinkedIn' : 'Facebook'
    icon = 'people'
  }

  // Keep the actual host visible even for branded or shortened links; open the original URL.
  return { title, icon, destination: `${url.host}${url.pathname === '/' ? '' : url.pathname}` }
}
