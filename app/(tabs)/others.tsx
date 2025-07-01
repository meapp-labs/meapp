import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import React from 'react';
import {
  FlatList,
  Image,
  StyleSheet,
  View
} from 'react-native';

const mockOthers = [
  { id: '1', name: 'Alice', avatar: 'https://i.pravatar.cc/150?u=a042581f4e29026704d' },
  { id: '2', name: 'Bob', avatar: 'https://i.pravatar.cc/150?u=a042581f4e29026704e' },
  { id: '3', name: 'Charlie', avatar: 'https://i.pravatar.cc/150?u=a042581f4e29026704f' },
  { id: '4', name: 'David', avatar: 'https://i.pravatar.cc/150?u=a042581f4e29026704g' },
  { id: '5', name: 'Eve', avatar: 'https://i.pravatar.cc/150?u=a042581f4e29026704h' },
];

export default function FriendsScreen() {
  const renderFriend = ({ item }: { item: { name: string; avatar: string } }) => (
    <View style={styles.friendItem}>
      <Image source={{ uri: item.avatar }} style={styles.avatar} />
      <ThemedText style={styles.friendName}>{item.name}</ThemedText>
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      <FlatList
        data={mockOthers}
        renderItem={renderFriend}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.friendList}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 50,
  },
  friendList: {
    paddingHorizontal: 10,
  },
  friendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#2C2C2E',
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 15,
  },
  friendName: {
    fontSize: 18,
  },
});