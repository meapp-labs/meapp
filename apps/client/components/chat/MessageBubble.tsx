import { MaterialIcons } from '@expo/vector-icons'
import { memo } from 'react'
import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/common/Text'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { theme } from '@/theme/theme'
import type { Message } from '@meapp/shared'

export type BaseMessage = Message

type MessageProps = {
  message: Message
  time: string
}

const timeFormatter = new Intl.DateTimeFormat('default', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
})

export const MessageBubble = {
  Received: memo(function ReceivedMessage({ message, time }: MessageProps) {
    const { isDesktop, width } = useBreakpoint()
    return (
      <View style={[styles.messageGroupContainer, isDesktop && { maxWidth: width * 0.35 }]}>
        <MaterialIcons name="face" color={theme.colors.text} size={34} />
        <View style={styles.messageTextWrapper}>
          <Text selectable style={styles.receivedMessageContainer}>
            {message.text}
          </Text>
        </View>
        <Text style={styles.time}>{time}</Text>
      </View>
    )
  }),
  Sent: memo(function SentMessage({ message, time }: MessageProps) {
    const { isDesktop, width } = useBreakpoint()
    return (
      <View
        style={[
          styles.messageGroupContainer,
          isDesktop && { maxWidth: width * 0.35 },
          { alignSelf: 'flex-end' },
        ]}
      >
        <Text style={styles.time}>{time}</Text>
        <View style={styles.messageTextWrapper}>
          <Text selectable style={styles.sentMessageContainer}>
            {message.text}
          </Text>
        </View>
      </View>
    )
  }),
  Wrapper: memo(function MessageWrapper({
    message,
    prevTimestamp,
    currentUsername,
  }: {
    message: Message
    prevTimestamp: string | undefined
    currentUsername: string
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
          <MessageBubble.Sent message={message} time={time} />
        ) : (
          <MessageBubble.Received message={message} time={time} />
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
})
