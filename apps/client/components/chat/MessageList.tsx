import React from 'react'
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import { Loader } from '@/components/Loader'
import { MessageBubble } from '@/components/chat/MessageBubble'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useAuthStore } from '@/lib/stores'
import { useGetMessages } from '@/services/messages'
import { theme } from '@/theme/theme'
import type { Message } from '@meapp/shared'

type ChatProps = {
  conversationId: string
}

export function MessageList({ conversationId }: ChatProps) {
  const { username } = useAuthStore()
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
  })

  // Each history page is ascending, but pages arrive newest to oldest.
  // Sort across pages before reversing for the inverted FlatList.
  const messages = React.useMemo(() => {
    if (!data?.pages) return []
    return data.pages
      .flatMap((page) => page.messages)
      .sort((a, b) => Number(a.sequence ?? a.index ?? 0) - Number(b.sequence ?? b.index ?? 0))
      .reverse()
  }, [data])

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
    <FlatList<Message>
      inverted
      data={messages}
      renderItem={({ item, index }) => (
        <MessageBubble.Wrapper
          message={item}
          prevTimestamp={
            messages[index + 1]?.timestamp ||
            (messages[index + 1]?.createdAt ? String(messages[index + 1]?.createdAt) : undefined)
          }
          currentUsername={username}
          bubbleMaxWidth={isDesktop ? width * 0.35 : null}
        />
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
  )
}

const styles = StyleSheet.create({
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
