import { useQueryClient } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { memo, useEffect, useState } from 'react'
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native'
import Toast from 'react-native-toast-message'

import { UserAvatar } from '@/components/UserAvatar'
import { Text } from '@/components/common/Text'
import { deleteMedia, loadMedia } from '@/services/media'
import { parseMessageLinks, standaloneMessageLink } from '@/services/messageLinks'
import { useContactPresentation, useOwnProfile } from '@/services/profiles'
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
  quote?: React.ReactNode
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
    const controller = new AbortController()
    setUri(null)
    setFailed(false)
    let originalLoaded = false
    if (descriptor.variants.some((variant) => variant.name === 'thumb')) {
      void loadMedia(descriptor, 'thumb', { signal: controller.signal })
        .then((value) => {
          if (live && !originalLoaded) setUri(value)
        })
        .catch(() => undefined)
    }
    void loadMedia(descriptor, 'orig', { signal: controller.signal })
      .then((value) => {
        originalLoaded = true
        if (live) setUri(value)
      })
      .catch(() => {
        if (live) setFailed(true)
      })
    return () => {
      live = false
      controller.abort()
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

function MessageMedia({ message, own = false }: { message: Message; own?: boolean }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const remove = (id: string) => {
    const perform = async () => {
      setBusy(true)
      try {
        await deleteMedia(id)
        await queryClient.invalidateQueries()
      } catch (error) {
        Toast.show({
          type: 'error',
          text1: 'Could not delete attachment',
          text2: error instanceof Error ? error.message : 'Try again',
        })
      } finally {
        setBusy(false)
      }
    }
    const explanation =
      'Remove this attachment from the chat and schedule storage deletion? Previously saved copies, keys and CDN caches may remain.'
    if (Platform.OS === 'web') {
      if (window.confirm(explanation)) void perform()
    } else
      Alert.alert('Delete attachment?', explanation, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void perform() },
      ])
  }
  return (
    <>
      {message.media?.map((raw) =>
        message.unavailableAttachmentIds?.includes(raw.id) ? (
          <Text key={raw.id}>Attachment deleted or expired</Text>
        ) : (
          <View key={raw.id} style={{ gap: 6 }}>
            <MediaPreview raw={raw} />
            {own && (
              <Pressable disabled={busy} accessibilityRole="button" onPress={() => remove(raw.id)}>
                <Text style={{ fontSize: 12 }}>Delete attachment</Text>
              </Pressable>
            )}
          </View>
        ),
      )}
    </>
  )
}

export const MessageBubble = {
  Received: memo(function ReceivedMessage({ message, time, maxWidth, quote }: BubbleLayoutProps) {
    const contact = useContactPresentation(message.userId ?? message.from ?? '', !!message.userId)
    return (
      <View style={[styles.messageGroupContainer, maxWidth != null && { maxWidth }]}>
        <UserAvatar uri={contact.profile?.avatarUrl} size={34} label={contact.name} />
        <View style={styles.messageTextWrapper}>
          <Text style={theme.typography.caption}>
            {contact.name} · @{contact.profile?.username ?? message.from}
          </Text>
          <View
            style={[styles.receivedMessageContainer, isLinkOnly(message) && styles.linkContainer]}
          >
            {quote}
            <MessageMedia message={message} />
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
  Sent: memo(function SentMessage({ message, time, maxWidth, quote }: BubbleLayoutProps) {
    return (
      <View
        style={[
          styles.messageGroupContainer,
          maxWidth != null && { maxWidth },
          { alignSelf: 'flex-end' },
        ]}
      >
        <View style={styles.messageMetadata}>
          <Text style={styles.time}>{time}</Text>
          {message.sequence === undefined && (
            <Text style={styles.status} accessibilityLabel="Message is sending">
              Sending…
            </Text>
          )}
        </View>
        <View style={styles.messageTextWrapper}>
          <View style={[styles.sentMessageContainer, isLinkOnly(message) && styles.linkContainer]}>
            {quote}
            <MessageMedia message={message} own />
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
    quote,
  }: {
    message: Message
    quote?: React.ReactNode
    prevTimestamp: string | undefined
    currentUsername: string
    bubbleMaxWidth: number | null
  }) {
    const own = useOwnProfile()
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
        {(
          message.userId && own.data
            ? message.userId === own.data.id
            : sender === currentUsername
        ) ? (
          <MessageBubble.Sent
            message={message}
            time={time}
            maxWidth={bubbleMaxWidth}
            quote={quote}
          />
        ) : (
          <MessageBubble.Received
            message={message}
            time={time}
            maxWidth={bubbleMaxWidth}
            quote={quote}
          />
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
  messageMetadata: {
    alignItems: 'center',
    gap: 2,
  },
  status: {
    fontSize: 10,
    lineHeight: 14,
    color: theme.colors.textSecondary,
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
