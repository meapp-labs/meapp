import { theme } from '@/theme/theme'
import type { ExternalMessageLinkProps } from './ExternalMessageLink'

export function ExternalMessageLink({ url, standalone, children }: ExternalMessageLinkProps) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${url}`}
      style={{
        color: theme.colors.primary,
        textDecoration: standalone ? 'none' : 'underline',
        display: standalone ? 'block' : 'inline',
        overflowWrap: 'anywhere',
      }}
    >
      {children}
    </a>
  )
}
