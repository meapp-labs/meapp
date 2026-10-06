import type { Message } from '@meapp/shared'

export function canAcknowledgeMessage(message: Message, username: string) {
  return Boolean(
    message.id &&
      message.sequence !== undefined &&
      message.from !== username &&
      message.type !== 'undecryptable' &&
      !message.ciphertext &&
      (message.text || message.media?.length),
  )
}

export function receiptForeground(appState: string | null, visibility = 'visible', focused = true) {
  return appState === 'active' && visibility === 'visible' && focused
}
