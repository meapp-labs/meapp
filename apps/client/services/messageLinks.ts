export type MessagePart = { text: string; url?: string }

function webUrl(value: string): string | undefined {
  try {
    const url = new URL(/^www\./i.test(value) ? `https://${value}` : value)
    if ((url.protocol === 'https:' || url.protocol === 'http:') && url.hostname) {
      return url.href
    }
  } catch {
    // Invalid URLs remain ordinary, selectable message text.
  }
  return undefined
}

/** Recognize Markdown links and bare web URLs without interpreting other Markdown. */
export function parseMessageLinks(text: string): MessagePart[] {
  const parts: MessagePart[] = []
  const pattern =
    /\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)|(?<![\w@])(?:https?:\/\/|www\.)[^\s<>]+/gi
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const start = match.index
    const markdown = match[1] !== undefined
    let raw = markdown ? (match[2] ?? '') : match[0]
    if (!markdown) {
      raw = raw.replace(/[.,!?;:'"\]}]+$/, '')
      // Keep balanced parentheses in URLs, but leave sentence parentheses outside.
      while (raw.endsWith(')') && raw.split(')').length > raw.split('(').length) {
        raw = raw.slice(0, -1)
      }
    }
    const url = webUrl(raw)
    if (!url) continue
    if (start > cursor) parts.push({ text: text.slice(cursor, start) })
    parts.push({ text: markdown ? (match[1] ?? raw) : raw, url })
    cursor = start + (markdown ? match[0].length : raw.length)
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) })
  return parts
}

export function standaloneMessageLink(parts: MessagePart[]): MessagePart | undefined {
  const content = parts.filter((part) => part.text.trim().length > 0)
  return content.length === 1 && content[0]?.url ? content[0] : undefined
}
