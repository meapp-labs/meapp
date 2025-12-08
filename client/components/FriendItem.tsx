import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Friend } from '@/components/FriendsScreen';
import { Text } from '@/components/common/Text';
import { useFriendStore } from '@/lib/stores';
import { useGetMessages } from '@/services/messages';
import { theme } from '@/theme/theme';

type FriendItemProps = {
  item: Friend;
};

function FriendItem({ item: listFriend }: FriendItemProps) {
  const [hovered, setHovered] = useState<boolean>(false);
  const { selectedFriend, setSelectedFriend } = useFriendStore();
  const { data } = useGetMessages({
    selectedFriendName: listFriend.name,
    enabled: false,
  });

  const lastMessage = data?.lastMessage;
  return (
    <Pressable
      onPress={() => {
        if (listFriend.name !== selectedFriend?.name)
          setSelectedFriend(listFriend);
      }}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[
        styles.friendItem,
        hovered && styles.friendItemHovered,
        selectedFriend?.name === listFriend.name && styles.friendItemPressed,
      ]}
    >
      <View style={styles.messageBoxContainer}>
        <MaterialIcons name="face" size={38} color={theme.colors.text} />
        <View style={styles.messageBox}>
          <Text>{listFriend.name}</Text>
          {lastMessage && (
            <Text>
              {lastMessage.text.length > 15
                ? lastMessage.text.slice(0, 15).trim().concat('...')
                : lastMessage.text}
            </Text>
          )}
        </View>
        {lastMessage && (
          <Text style={styles.timestamp}>{lastMessage.date.toString()}</Text>
        )}
      </View>
    </Pressable>
  );
}

export default FriendItem;

const styles = StyleSheet.create({
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
});
