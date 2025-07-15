import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import styles from '@/styles';
import React, { useState } from 'react';
import { FlatList, Image, Pressable } from 'react-native';

const mockOthers = [
    {
        id: '1',
        name: 'Alice',
        avatar: 'https://i.pravatar.cc/150?u=a042581f4e29026704d',
    },
    {
        id: '2',
        name: 'Bob',
        avatar: 'https://i.pravatar.cc/150?u=a042581f4e29026704e',
    },
    {
        id: '3',
        name: 'Charlie',
        avatar: 'https://i.pravatar.cc/150?u=a042581f4e29026704f',
    },
    {
        id: '4',
        name: 'David',
        avatar: 'https://i.pravatar.cc/150?u=a042581f4e29026704g',
    },
    {
        id: '5',
        name: 'Eve',
        avatar: 'https://i.pravatar.cc/150?u=a042581f4e29026704h',
    },
];

export default function FriendsScreen() {
    const [hovered, setHovered] = useState<string | null>(null);
    const [pressed, setPressed] = useState<string | null>(null);

    const renderFriend = ({
        item,
    }: {
        item: { id: string; name: string; avatar: string };
    }) => (
        <Pressable
            onPressIn={() => setPressed(item.id)}
            onHoverIn={() => setHovered(item.id)}
            onHoverOut={() => setHovered(null)}
            style={[
                styles.friendItem,
                hovered === item.id && styles.friendItemHovered,
                pressed === item.id && styles.friendItemPressed,
            ]}
        >
            <Image source={{ uri: item.avatar }} style={styles.avatar} />
            <ThemedText style={styles.friendName}>{item.name}</ThemedText>
        </Pressable>
    );

    return (
        <ThemedView style={{ flex: 1 }}>
            <ThemedText
                type="subtitle"
                style={{
                    textAlign: 'center',
                    paddingVertical: 15,
                    borderBottomWidth: 1,
                    borderBottomColor: '#2c2c2e',
                    marginBottom: 5,
                }}
            >
                Contacts
            </ThemedText>
            <FlatList
                data={mockOthers}
                renderItem={renderFriend}
                keyExtractor={(item) => item.id}
            />
        </ThemedView>
    );
}
