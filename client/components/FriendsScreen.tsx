import React, { useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, View } from 'react-native';
import Button from '@/components/common/Button';
import { Text } from '@/components/common/Text';
import { theme } from '@/theme/theme';
import { logoutUser } from '@/services/auth';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';

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
    const { mutate: logout } = useMutation({
        mutationFn: logoutUser,
        onSuccess: () => {
            router.replace('/(auth)/login');
        },
    });
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
            <Image style={styles.avatar} source={{ uri: item.avatar }} />
            <Text>{item.name}</Text>
        </Pressable>
    );

    return (
        <View style={styles.friendList}>
            <View style={styles.headerContainer}>
                <Text style={styles.contactHeader}>Contacts</Text>
            </View>
            <FlatList
                data={mockOthers}
                renderItem={renderFriend}
                keyExtractor={(item) => item.id}
            />
            <View style={styles.logoutButton}>
                <Button variant="secondary" title="Logout" onPress={logout} />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    headerContainer: {
        alignSelf: 'center',
        borderBottomWidth: 1,
        borderColor: theme.colors.card,
        width: '90%',
        marginBottom: theme.spacing.xs,
    },
    contactHeader: {
        ...theme.typography.h2,
        marginVertical: theme.spacing.md,
        alignSelf: 'center',
    },
    friendList: {
        flex: 1 / 6,
        backgroundColor: theme.colors.surface,
        margin: theme.spacing.sm,
        borderRadius: theme.spacing.sm,
    },
    friendItem: {
        alignItems: 'center',
        flexDirection: 'row',
        margin: theme.spacing.xs,
        borderRadius: theme.spacing.sm,
        borderColor: theme.colors.surface,
        borderWidth: 1,
        paddingVertical: theme.spacing.xs,
    },
    avatar: {
        width: 50,
        height: 50,
        borderRadius: 25,
        marginHorizontal: 15,
    },

    friendItemHovered: {
        borderColor: theme.colors.secondary,
    },
    friendItemPressed: {
        backgroundColor: theme.colors.card,
    },
    logoutButton: { margin: theme.spacing.sm },
});
