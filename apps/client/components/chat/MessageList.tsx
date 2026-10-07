import { useReactions } from '@/services/reactions'
import { threadLabel, visibleMessages } from '@/services/threadPresentation'
import { MaterialIcons } from '@expo/vector-icons'
import React from 'react'
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Pressable } from 'react-native'
import Toast from 'react-native-toast-message'
import { MessageActions, MessageInteraction, ReactionPills, ReplyQuote } from './MessageActions'
import { useReplyDraft } from './replyDraft'
import { useThreadWindow } from './threadWindowStore'

import { Loader } from '@/components/Loader'
import { MessageBubble } from '@/components/chat/MessageBubble'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useMessageAcknowledgements } from '@/hooks/useMessageAcknowledgements'
import { useAuthStore } from '@/lib/stores'
import { useGetMessages } from '@/services/messages'
import { type UnreadBoundary, updateUnreadBoundary } from '@/services/unreadBoundary'
import { theme } from '@/theme/theme'
import type { Message } from '@meapp/shared'

type ChatProps = {
  conversationId: string
  threadRootId?: string | undefined
}

export function MessageList({ conversationId, threadRootId }: ChatProps) {
  const { username } = useAuthStore()
  const threadWindow = useThreadWindow()
  const replyToMessage = (message: Message) => {
    const rootId = threadRootId ?? message.threadRootId ?? message.id
    selectReply(conversationId, message, rootId)
    if (!threadRootId) threadWindow.open(conversationId, rootId)
  }
  const list = React.useRef<FlatList<Message>>(null)
  const [selected, setSelected] = React.useState<Message | null>(null)
  const [showPeople, setShowPeople] = React.useState(false)
  const [targetId, setTargetId] = React.useState<string | null>(null)
  const [highlighted, setHighlighted] = React.useState<string | null>(null)
  const reactions = useReactions(conversationId)
  const selectReply = useReplyDraft((state) => state.select)
  const react = (messageId: string, emoji: import('@meapp/shared').ReactionOperation['emoji']) => {
    void reactions.react({ messageId, emoji }).catch((error: unknown) =>
      Toast.show({
        type: 'error',
        text1: 'Reaction not saved',
        text2: error instanceof Error ? error.message : 'Try again when connected',
      }),
    )
  }
  const { isDesktop, width } = useBreakpoint()

  const {
    data,
    isPending,
    isSuccess,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useGetMessages({
    conversationId,
    threadRootId,
  })

  // Each history page is ascending, but pages arrive newest to oldest.
  // Sort across pages before reversing for the inverted FlatList.
  const messages = React.useMemo(() => {
    if (!data?.pages) return []
    return visibleMessages(
      data.pages.flatMap((page) => page.messages),
      threadRootId,
      data.pages[0]?.threadRoot,
    )
  }, [data, threadRootId])
  const summaries = data?.pages[0]?.threadSummaries ?? {}
  const unreadThreads = Object.values(summaries)
    .filter((summary) => summary.unreadCount > 0)
    .sort((a, b) => b.lastReplySequence - a.lastReplySequence)
  React.useEffect(() => {
    // Durable stream pages can contain only thread replies. Keep loading until
    // the main timeline has a useful window of original messages.
    if (!threadRootId && messages.length < 16 && hasNextPage && !isFetchingNextPage)
      void fetchNextPage()
  }, [threadRootId, messages.length, hasNextPage, isFetchingNextPage, fetchNextPage])
  React.useEffect(() => {
    if (!targetId) return
    const index = messages.findIndex((message) => message.id === targetId)
    if (index >= 0) {
      list.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 })
      setHighlighted(targetId)
      setTargetId(null)
    } else if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
    else if (!hasNextPage) {
      setTargetId(null)
      Toast.show({ type: 'info', text1: 'Original message unavailable on this device' })
    }
  }, [targetId, messages, hasNextPage, isFetchingNextPage, fetchNextPage])
  React.useEffect(() => {
    if (!highlighted) return
    const timer = setTimeout(() => setHighlighted(null), 2000)
    return () => clearTimeout(timer)
  }, [highlighted])
  React.useEffect(() => {
    if (!conversationId) return
    setSelected(null)
    setTargetId(null)
  }, [conversationId])
  const onViewableItemsChanged = useMessageAcknowledgements(
    conversationId,
    messages,
    Boolean(threadRootId) || threadWindow.roomId !== conversationId || !threadWindow.rootId,
  )
  const session = React.useRef<{ key: string; boundary: UnreadBoundary | null }>({
    key: '',
    boundary: null,
  })
  const key = `${conversationId}:${username}:${threadRootId ?? 'main'}`
  if (session.current.key !== key) session.current = { key, boundary: null }
  if (isSuccess)
    session.current.boundary = updateUnreadBoundary(
      session.current.boundary,
      messages,
      username,
      data.pages[0]?.firstUnreadSequence ?? null,
    )
  const unreadSequence = session.current.boundary?.sequence ?? null
  // Fetch enough history to include the private reading landmark.
  React.useEffect(() => {
    const oldest = messages
      .filter((m) => m.sequence !== undefined && (!threadRootId || m.threadRootId === threadRootId))
      .at(-1)?.sequence
    if (
      unreadSequence !== null &&
      oldest !== undefined &&
      oldest > unreadSequence &&
      hasNextPage &&
      !isFetchingNextPage
    )
      void fetchNextPage()
  }, [messages, unreadSequence, hasNextPage, isFetchingNextPage, fetchNextPage, threadRootId])
  const viewabilityConfig = React.useRef({
    itemVisiblePercentThreshold: 60,
    minimumViewTime: 600,
  }).current

  const handleLoadMore = React.useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  if (isPending) return <Loader text="Loading messages..." />

  if (isError) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>Failed to load messages</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => void refetch()}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    )
  }

  if (!isSuccess) return null

  return (
    <>
      {!threadRootId && unreadThreads[0] && (
        <Pressable
          onPress={() => threadWindow.open(conversationId, unreadThreads[0]?.rootId ?? '')}
          accessibilityRole="button"
          style={styles.threadActivity}
        >
          <MaterialIcons name="forum" size={18} color={theme.colors.primary} />
          <Text style={styles.threadLabel}>
            {unreadThreads.reduce((total, summary) => total + summary.unreadCount, 0)} unread thread
            replies
          </Text>
          <Text style={styles.threadHint}>Open latest</Text>
        </Pressable>
      )}
      <FlatList<Message>
        ref={list}
        onScrollToIndexFailed={(info) => {
          list.current?.scrollToOffset({
            offset: info.averageItemLength * info.index,
            animated: true,
          })
        }}
        inverted
        maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 80 }}
        data={messages}
        extraData={{ unreadSequence, reactions: reactions.data, highlighted }}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        renderItem={({ item, index }) => (
          <View style={item.id === highlighted ? styles.highlight : undefined}>
            {threadRootId && item.id === threadRootId && (
              <View style={styles.originalLabel}>
                <MaterialIcons name="push-pin" size={16} color={theme.colors.primary} />
                <Text style={styles.threadHint}>Original message</Text>
              </View>
            )}
            {item.sequence === unreadSequence && (
              <View style={styles.unreadDivider}>
                <View style={styles.unreadLine} />
                <Text style={styles.unreadLabel}>New messages</Text>
                <View style={styles.unreadLine} />
              </View>
            )}
            <MessageInteraction
              enabled={item.sequence !== undefined && !item.ciphertext}
              onReply={() => replyToMessage(item)}
              onOpen={() => {
                setShowPeople(false)
                setSelected(item)
              }}
            >
              <MessageBubble.Wrapper
                message={item}
                quote={
                  item.replyTo ? (
                    <ReplyQuote
                      target={messages.find((message) => message.id === item.replyTo)}
                      onPress={() => setTargetId(item.replyTo ?? null)}
                    />
                  ) : undefined
                }
                prevTimestamp={
                  messages[index + 1]?.timestamp ||
                  (messages[index + 1]?.createdAt
                    ? String(messages[index + 1]?.createdAt)
                    : undefined)
                }
                currentUsername={username}
                bubbleMaxWidth={threadRootId ? null : isDesktop ? width * 0.35 : null}
              />
            </MessageInteraction>
            {!threadRootId && summaries[item.id] && (
              <Pressable
                style={styles.threadBadge}
                accessibilityRole="button"
                accessibilityLabel={`${threadLabel(summaries[item.id])}. Open thread`}
                onPress={() => threadWindow.open(conversationId, item.id)}
              >
                <MaterialIcons name="forum" size={16} color={theme.colors.primary} />
                <Text style={styles.threadLabel}>{threadLabel(summaries[item.id])}</Text>
                <Text style={styles.threadHint}>View thread</Text>
                {Boolean(summaries[item.id]?.unreadCount) && <View style={styles.unreadDot} />}
              </Pressable>
            )}
            <ReactionPills
              entries={reactions.data?.entries.filter((entry) => entry.messageId === item.id) ?? []}
              username={username}
              disabled={reactions.pending || reactions.isPending || reactions.isError}
              onReact={(emoji) => react(item.id, emoji)}
              onOpen={() => {
                setShowPeople(true)
                setSelected(item)
              }}
            />
          </View>
        )}
        keyExtractor={(item, index) =>
          item.id ??
          item.clientId ??
          (item.sequence !== undefined
            ? String(item.sequence)
            : item.index !== undefined
              ? String(item.index)
              : `msg-${index}`)
        }
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={true}
        maxToRenderPerBatch={10}
        windowSize={21}
        initialNumToRender={15}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          isFetchingNextPage ? <ActivityIndicator style={{ padding: 16 }} /> : null
        }
      />
      {threadRootId && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Jump to latest reply"
          style={styles.latest}
          onPress={() => list.current?.scrollToOffset({ offset: 0, animated: true })}
        >
          <MaterialIcons name="arrow-downward" size={16} color={theme.colors.primary} />
          <Text style={styles.threadHint}>Latest replies</Text>
        </Pressable>
      )}
      <MessageActions
        inThread={Boolean(threadRootId)}
        {...(!threadRootId && selected
          ? { onViewThread: () => threadWindow.open(conversationId, selected.id) }
          : {})}
        showPeople={showPeople}
        statusText={
          reactions.isError
            ? 'Reactions unavailable. Your message is still available.'
            : reactions.isPending
              ? 'Loading reactions…'
              : undefined
        }
        {...(reactions.isError
          ? {
              onRetry: () => {
                void reactions.refetch()
              },
            }
          : {})}
        message={selected}
        entries={reactions.data?.entries.filter((entry) => entry.messageId === selected?.id) ?? []}
        username={username}
        pending={reactions.pending || reactions.isPending || reactions.isError}
        onClose={() => setSelected(null)}
        onReply={() => {
          if (selected) replyToMessage(selected)
        }}
        onReact={(emoji) => {
          if (selected) react(selected.id, emoji)
        }}
      />
    </>
  )
}

const styles = StyleSheet.create({
  threadActivity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#F5BA3012',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderSecondary,
  },
  threadBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 52,
    paddingVertical: 9,
    flexWrap: 'wrap',
  },
  threadLabel: { fontSize: 12, fontWeight: '700', color: theme.colors.primary },
  threadHint: { fontSize: 12, color: theme.colors.textSecondary },
  unreadDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.primary },
  originalLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderSecondary,
  },
  latest: { flexDirection: 'row', gap: 6, alignSelf: 'center', padding: 8, marginTop: 4 },
  highlight: { backgroundColor: '#F5BA3022', borderRadius: 12 },
  unreadDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginVertical: 12,
  },
  unreadLine: { flex: 1, height: 1, backgroundColor: '#E5B94F' },
  unreadLabel: { fontSize: 12, fontWeight: '700', color: '#E5B94F' },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.lg,
  },
  errorText: {
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.error,
    marginBottom: theme.spacing.md,
  },
  retryButton: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: 8,
  },
  retryText: {
    color: '#ffffff',
    fontWeight: '600',
  },
})
