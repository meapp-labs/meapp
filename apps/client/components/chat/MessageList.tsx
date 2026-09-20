import React from 'react'
import { ActivityIndicator, FlatList } from 'react-native'

import { Loader } from '@/components/Loader'
import { MessageBubble } from '@/components/chat/MessageBubble'
import { useAuthStore } from '@/lib/stores'
import { useGetMessages } from '@/services/messages'
import type { Message } from '@/types/models'

type ChatProps = {
  conversationId: string
}

export function MessageList({ conversationId }: ChatProps) {
  const { username } = useAuthStore()

  const { data, isPending, isSuccess, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useGetMessages({
      conversationId,
    })

  // Flatten all pages into a single message array and reverse
  const messages = React.useMemo(() => {
    if (!data?.pages) return []
    return data.pages.flatMap((page) => [...page.messages].reverse())
  }, [data])

  const handleLoadMore = React.useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  if (isPending) return <Loader text="Loading messages..." />

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
        />
      )}
      keyExtractor={(item) => item.id ?? String(item.sequence ?? item.index ?? Math.random())}
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
