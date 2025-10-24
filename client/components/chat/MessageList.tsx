import React from 'react';
import { ActivityIndicator, FlatList } from 'react-native';

import { Loader } from '@/components/Loader';
import MessageBubble, { BaseMessage } from '@/components/chat/MessageBubble';
import { useAuthStore } from '@/lib/stores';
import { useGetMessages } from '@/services/messages';

type ChatProps = {
  selectedFriendName: string;
};

export function MessageList({ selectedFriendName }: ChatProps) {
  const { username } = useAuthStore();

  const {
    data,
    isPending,
    isSuccess,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useGetMessages({
    selectedFriendName,
  });

  // Flatten all pages into a single message array and reverse
  const messages = React.useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flatMap((page) => [...page.messages].reverse());
  }, [data]);

  React.useEffect(() => {
    if (isSuccess && messages.length < 16 && messages.length > 0) {
      void refetch();
    }
  }, [isSuccess, messages.length, refetch]);

  const handleLoadMore = React.useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (isPending) return <Loader text="Loading messages..." />;

  if (!isSuccess) return null;

  return (
    <FlatList<BaseMessage>
      inverted
      data={messages}
      renderItem={({ item, index }) => (
        <MessageBubble.Wrapper
          message={item}
          prevTimestamp={messages[index + 1] && messages[index + 1]?.timestamp}
          currentUsername={username}
        />
      )}
      keyExtractor={(item) => item.index}
      showsVerticalScrollIndicator={false}
      removeClippedSubviews={true}
      maxToRenderPerBatch={10}
      windowSize={21}
      initialNumToRender={15}
      onEndReached={handleLoadMore}
      onEndReachedThreshold={0.5}
      ListFooterComponent={
        isFetchingNextPage ? (
          <ActivityIndicator style={{ padding: 16 }} />
        ) : null
      }
    />
  );
}
