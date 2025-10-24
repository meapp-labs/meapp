import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { Logout } from '@/components/Logout';
import DeleteFriend from '@/components/chat/DeleteFriend';
import { RemoveIcon } from '@/components/chat/RemoveIcon';
import { Text } from '@/components/common/Text';
import TopMenu from '@/components/forms/TopMenu';
import UserSettings from '@/components/settings/UserSettings';
import useBreakpoint from '@/hooks/useBreakpoint';
import { useFriendStore } from '@/lib/stores';
import { useGetMessages } from '@/services/messages';
import { useGetFriends } from '@/services/others';
import { theme } from '@/theme/theme';

export type Friend = {
  name: string;
};

function LastMessage({ friendName }: { friendName: string }) {
  const { data } = useGetMessages({
    selectedFriendName: friendName,
    enabled: false,
  });

  return data?.lastMessageText ? (
    <Text style={{ ...theme.typography.caption }} numberOfLines={1}>
      {data.lastMessageText}
    </Text>
  ) : null;
}

export default function FriendsScreen() {
  const { selectedFriend, setSelectedFriend } = useFriendStore();
  const { isMobile, isDesktop } = useBreakpoint();

  const [hovered, setHovered] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [removeId, setRemoveId] = useState<string | null>(null);

  const handleChange = (pressed: string | null, removed: string | null) => {
    setSelectedFriend(pressed ? { name: pressed } : null);
    setRemoveId(removed);
  };

  const { data: others = [], isPending } = useGetFriends();

  const items: Friend[] = others.map((name) => ({
    name,
  }));

  const renderFriend = ({ item: listFriend }: { item: Friend }) => (
    <>
      <Pressable
        onPress={() => {
          if (listFriend.name !== selectedFriend?.name)
            setSelectedFriend(listFriend);
          setRemoveId(null);
        }}
        onHoverIn={() => setHovered(listFriend.name)}
        onHoverOut={() => setHovered(null)}
        style={[
          styles.friendItem,
          hovered === listFriend.name && styles.friendItemHovered,
          selectedFriend?.name === listFriend.name && styles.friendItemPressed,
        ]}
      >
        <View style={styles.messageBoxContainer}>
          <MaterialIcons name="face" size={38} color={theme.colors.text} />
          <View style={styles.messageBox}>
            <Text>{listFriend.name}</Text>
            <LastMessage friendName={listFriend.name} />
          </View>
          <Text style={styles.timestamp}>10 min </Text>
          {isDesktop && selectedFriend?.name === listFriend.name && (
            <RemoveIcon item={listFriend} setRemoveId={setRemoveId} />
          )}
        </View>
      </Pressable>
      {removeId === listFriend.name && (
        <DeleteFriend friend={listFriend.name} onChange={handleChange} />
      )}
    </>
  );

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
          renderItem={renderFriend}
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
  friendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    marginHorizontal: theme.spacing.sm,
    marginVertical: theme.spacing.xs,
    borderRadius: theme.spacing.sm,
    borderColor: theme.colors.surface,
    borderWidth: 1,
  },

  friendItemHovered: {
    borderColor: theme.colors.secondary,
  },
  friendItemPressed: {
    backgroundColor: theme.colors.card,
  },
  buttons: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    margin: theme.spacing.md,
    alignItems: 'center',
  },
  messageBox: {
    flex: 1,
    flexShrink: 1,
    flexDirection: 'column',
    margin: theme.spacing.sm,
  },
  messageBoxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    padding: theme.spacing.sm,
  },
  timestamp: {
    ...theme.typography.caption,
    marginRight: theme.spacing.xs,
  },
  topMenu: {
    alignItems: 'center',
    flexDirection: 'row',
    marginHorizontal: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
});
