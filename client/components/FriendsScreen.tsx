import React, { useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/common/Text';

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
            <Text style={styles.friendName}>{item.name}</Text>
        </Pressable>
    );

    return (
        <View style={styles.container}>
            <Text
                style={{
                    textAlign: 'center',
                    marginVertical: 20,
                    fontSize: 20,
                    fontWeight: 'bold',
                }}
            >
                Contacts
            </Text>
            <FlatList
                style={{
                    borderTopWidth: 1,
                    borderTopColor: '#2c2c2e',
                    paddingTop: 5,
                }}
                data={mockOthers}
                renderItem={renderFriend}
                keyExtractor={(item) => item.id}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    friendItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 5,
        borderRadius: 10,
        marginHorizontal: 10,
        marginVertical: 5,
    },
    avatar: {
        width: 50,
        height: 50,
        borderRadius: 25,
        marginRight: 15,
        marginLeft: 15,
    },
    friendName: {
        fontSize: 15,
    },
    friendItemHovered: {
        backgroundColor: '#2C2C2E',
    },
    friendItemPressed: {
        backgroundColor: '#49494d',
    },
});
