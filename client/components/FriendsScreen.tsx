import React, { useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';

import FriendItem from '@/components/FriendItem';
import { Logout } from '@/components/Logout';
import TopMenu from '@/components/forms/TopMenu';
import UserSettings from '@/components/settings/UserSettings';
import useBreakpoint from '@/hooks/useBreakpoint';
import { useGetFriends } from '@/services/others';
import { theme } from '@/theme/theme';

export type Friend = {
  name: string;
};

export default function FriendsScreen() {
  const { isMobile } = useBreakpoint();
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const { data: others = [], isPending } = useGetFriends();

  const items: Friend[] = others.map((name) => ({
    name,
  }));

  return (
    <View style={[styles.friendList, isMobile && { flex: 1 }]}>
      <View style={styles.topMenu}>
        <TopMenu />
      </View>
      {isPending ? (
        <ActivityIndicator />
      ) : (
        <FlatList
          data={items}
          renderItem={({ item }) => <FriendItem item={item} />}
          keyExtractor={(item) => item.name}
        />
      )}

      <View style={styles.buttons}>
        <UserSettings
          showSettings={showSettings}
          setShowSettings={setShowSettings}
        />
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
