import { MaterialIcons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { memo, useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/common/Text'
import { loadMedia } from '@/services/media'
import { parseMessageLinks, standaloneMessageLink } from '@/services/messageLinks'
import { theme } from '@/theme/theme'
import type { MediaDescriptor, Message } from '@meapp/shared'
import { FileAttachment } from './FileAttachment'
import { MessageText } from './MessageText'

export type BaseMessage = Message

const timeFormatter = new Intl.DateTimeFormat('default', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
})

type BubbleLayoutProps = {
  message: Message
  time: string
  /** Passed down from the list so each bubble doesn't call useWindowDimensions. */
  maxWidth: number | null
}

function isLinkOnly(message: Message) {
  return (
    !message.media?.length &&
    !!message.text &&
    !!standaloneMessageLink(parseMessageLinks(message.text))
  )
}

function ImagePreview({ raw: descriptor }: { raw: MediaDescriptor }) {
  const [uri, setUri] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    setUri(null)
    setFailed(false)
    let originalLoaded = false
    if (descriptor.variants.some((variant) => variant.name === 'thumb')) {
      void loadMedia(descriptor, 'thumb')
        .then((value) => {
          if (live && !originalLoaded) setUri(value)
        })
        .catch(() => undefined)
    }
    void loadMedia(descriptor)
      .then((value) => {
        originalLoaded = true
        if (live) setUri(value)
      })
      .catch(() => {
        if (live) setFailed(true)
      })
    return () => {
      live = false
    }
  }, [descriptor])
  if (failed && !uri) return <Text style={styles.mediaStatus}>Image unavailable</Text>
  return (
    <Image
      source={uri ? { uri } : null}
      style={[
        uri ? styles.mediaImage : styles.mediaPlaceholder,
        { aspectRatio: (descriptor.width ?? 1) / (descriptor.height ?? 1) },
      ]}
      contentFit="contain"
      placeholder={descriptor.blurhash ? { blurhash: descriptor.blurhash } : null}
      recyclingKey={descriptor.id}
      transition={150}
      cachePolicy="none"
      accessibilityLabel="Shared image"
    />
  )
}

function MediaPreview({ raw }: { raw: MediaDescriptor }) {
  return raw.kind === 'image' || raw.kind === 'gif' ? (
    <ImagePreview raw={raw} />
  ) : (
    <FileAttachment descriptor={raw} />
  )
}

export const MessageBubble = {
  Received: memo(function ReceivedMessage({ message, time, maxWidth }: BubbleLayoutProps) {
    return (
      <View style={[styles.messageGroupContainer, maxWidth != null && { maxWidth }]}>
        <MaterialIcons name="face" color={theme.colors.text} size={34} />
        <View style={styles.messageTextWrapper}>
          <View
            style={[styles.receivedMessageContainer, isLinkOnly(message) && styles.linkContainer]}
          >
            {message.media?.map((raw) => (
              <MediaPreview key={raw.id} raw={raw} />
            ))}
            {message.text ? (
              <MessageText text={message.text} />
            ) : !message.media?.length ? (
              <Text>Encrypted message unavailable on this device</Text>
            ) : null}
          </View>
        </View>
        <Text style={styles.time}>{time}</Text>
      </View>
    )
  }),
  Sent: memo(function SentMessage({ message, time, maxWidth }: BubbleLayoutProps) {
    return (
      <View
        style={[
          styles.messageGroupContainer,
          maxWidth != null && { maxWidth },
          { alignSelf: 'flex-end' },
        ]}
      >
        <Text style={styles.time}>{time}</Text>
        <View style={styles.messageTextWrapper}>
          <View style={[styles.sentMessageContainer, isLinkOnly(message) && styles.linkContainer]}>
            {message.media?.map((raw) => (
              <MediaPreview key={raw.id} raw={raw} />
            ))}
            {message.text ? (
              <MessageText text={message.text} />
            ) : !message.media?.length ? (
              <Text>Encrypted message unavailable on this device</Text>
            ) : null}
          </View>
        </View>
      </View>
    )
  }),
  Wrapper: memo(function MessageWrapper({
    message,
    prevTimestamp,
    currentUsername,
    bubbleMaxWidth,
  }: {
    message: Message
    prevTimestamp: string | undefined
    currentUsername: string
    bubbleMaxWidth: number | null
  }) {
    const rawTimestamp =
      message.timestamp || (message.createdAt ? String(message.createdAt) : undefined)
    const date = rawTimestamp ? new Date(rawTimestamp) : new Date()
    const prevDate = prevTimestamp ? new Date(prevTimestamp) : null

    const time = timeFormatter.format(date)
    const messageDate = dateFormatter.format(date)

    const isDifferentDay =
      !prevDate ||
      prevDate.getFullYear() !== date.getFullYear() ||
      prevDate.getMonth() !== date.getMonth() ||
      prevDate.getDate() !== date.getDate()

    const sender = message.from || message.userId || ''

    return (
      <>
        {sender === currentUsername ? (
          <MessageBubble.Sent message={message} time={time} maxWidth={bubbleMaxWidth} />
        ) : (
          <MessageBubble.Received message={message} time={time} maxWidth={bubbleMaxWidth} />
        )}
        {isDifferentDay && <Text style={styles.messageDate}>{messageDate}</Text>}
      </>
    )
  }),
}

const styles = StyleSheet.create({
  messageDate: {
    alignSelf: 'center',
    ...theme.typography.caption,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.xs,
  },
  messageGroupContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: theme.spacing.sm,
    gap: theme.spacing.sm,
    marginVertical: theme.spacing.xs,
  },
  messageTextWrapper: {
    flexShrink: 1,
  },
  time: {
    ...theme.typography.caption,
    alignSelf: 'center',
    color: 'gray',
  },
  sentMessageContainer: {
    backgroundColor: theme.colors.surface,
    borderBottomRightRadius: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: 20,
  },
  receivedMessageContainer: {
    backgroundColor: theme.colors.card,
    borderBottomLeftRadius: theme.spacing.sm,
    borderRadius: 20,
    padding: theme.spacing.md,
  },
  mediaImage: { width: 240, maxHeight: 320, borderRadius: 12 },
  linkContainer: { padding: theme.spacing.sm, borderRadius: 12 },
  mediaPlaceholder: { width: 240, maxHeight: 320, backgroundColor: '#555', borderRadius: 12 },
  mediaStatus: { color: theme.colors.text },
})
