import React, { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';

import ConversationItem from '@/components/ConversationItem';
import { Logout } from '@/components/Logout';
import AddFriend from '@/components/chat/AddFriend';
import CreateGroup from '@/components/chat/CreateGroup';
import TopMenu from '@/components/forms/TopMenu';
import UserSettings from '@/components/settings/UserSettings';
import useBreakpoint from '@/hooks/useBreakpoint';
import { useAuthStore } from '@/lib/stores';
import { useGetConversations } from '@/services/conversations';
import { theme } from '@/theme/theme';
import type { Conversation } from '@/types/models';

export default function FriendsScreen() {
  const { isMobile } = useBreakpoint();
  const { username: currentUsername } = useAuthStore();
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { data: conversations = [], isPending } = useGetConversations();

  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;

    const query = searchQuery.toLowerCase();
    return conversations.filter((c) => {
      // Check conversation name (custom name or group name)
      if (c.name?.toLowerCase().includes(query)) return true;

      // Check participants (excluding current user)
      const others = c.participants.filter((p) => p !== currentUsername);
      return others.some((p) => p.toLowerCase().includes(query));
    });
  }, [conversations, searchQuery, currentUsername]);

  return (
    <View style={[styles.friendList, isMobile && { flex: 1 }]}>
      <View style={styles.topMenu}>
        <TopMenu searchQuery={searchQuery} onSearchChange={setSearchQuery} />
      </View>
      {isPending ? (
        <ActivityIndicator />
      ) : (
        <FlatList<Conversation>
          data={filteredConversations}
          renderItem={({ item }) => <ConversationItem conversation={item} />}
          keyExtractor={(item) => item.id}
        />
      )}

      <View style={styles.buttons}>
        <UserSettings
          showSettings={showSettings}
          setShowSettings={setShowSettings}
        />
        <AddFriend />
        <CreateGroup />
        <Logout />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  friendList: {
    backgroundColor: theme.colors.surface,
  },
  buttons: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    margin: theme.spacing.md,
    alignItems: 'center',
  },
  topMenu: {
    alignItems: 'center',
    flexDirection: 'row',
    marginHorizontal: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
});
