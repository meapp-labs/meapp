import React, { useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    StyleSheet,
    TouchableOpacity,
    View,
} from 'react-native';
import Button from '@/components/common/Button';
import { Text } from '@/components/common/Text';
import { theme } from '@/theme/theme';
import { logoutUser } from '@/services/auth';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useGetOthers } from '@/services/others';
import AddFriend from './forms/AddFriend';
import DeleteFriend from './DeleteFriend';
import Ionicons from '@expo/vector-icons/Ionicons';
import { usePressedStore } from '@/stores/pressedFriendStore';
import { queryClient } from '@/lib/queryInit';
import { QueryKeys } from '@/lib/queryKeys';

export type Friend = {
    id: string;
    name: string;
};

export default function FriendsScreen() {
    const [hovered, setHovered] = useState<string | null>(null);
    const { pressed, setPressed } = usePressedStore();
    const [removeId, setRemoveId] = useState<string | null>(null);

    const { mutate: logout } = useMutation({
        mutationFn: logoutUser,
        onSuccess: () => {
            router.replace('/login');
            queryClient.removeQueries({ queryKey: [QueryKeys.GET_OTHERS] });
            queryClient.removeQueries({ queryKey: ['messages'] });
        },
    });

    const handleChange = (pressed: string | null, removed: string | null) => {
        setPressed(pressed ? { id: '', name: pressed } : null);
        setRemoveId(removed);
    };

    const { data: others = [], isPending } = useGetOthers();

    const items: Friend[] = others.map((name, index) => ({
        id: index.toString(),
        name,
    }));

    const renderFriend = ({ item }: { item: Friend }) => (
        <>
            <Pressable
                onPress={() =>
                    queryClient.refetchQueries({ queryKey: ['messages'] })
                }
                onPressIn={() => {
                    setPressed(item);
                    setRemoveId(null);
                }}
                onHoverIn={() => setHovered(item.id)}
                onHoverOut={() => setHovered(null)}
                style={[
                    styles.friendItem,
                    hovered === item.id && styles.friendItemHovered,
                    pressed?.id === item.id && styles.friendItemPressed,
                ]}
            >
                <View
                    style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        flex: 1,
                        paddingHorizontal: theme.spacing.md,
                    }}
                >
                    <Text
                        style={{ flex: 1, paddingVertical: theme.spacing.xs }}
                    >
                        {item.name}
                    </Text>
                    {pressed?.id === item.id && (
                        <TouchableOpacity onPress={() => setRemoveId(item.id)}>
                            <Ionicons
                                name="person-remove"
                                size={22}
                                color="white"
                            />
                        </TouchableOpacity>
                    )}
                </View>
            </Pressable>
            {removeId === item.id && (
                <DeleteFriend friend={item.name} onChange={handleChange} />
            )}
        </>
    );

    return (
        <View style={styles.friendList}>
            <View style={styles.headerContainer}>
                <Text style={styles.contactHeader}>Contacts</Text>
            </View>
            <View>
                <AddFriend />
            </View>
            {isPending ? (
                <ActivityIndicator />
            ) : (
                <FlatList
                    data={items}
                    renderItem={renderFriend}
                    keyExtractor={(item) => item.id}
                />
            )}

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
        margin: theme.spacing.sm,
        marginHorizontal: theme.spacing.sm,
        borderRadius: theme.spacing.sm,
        borderColor: theme.colors.surface,
        borderWidth: 1,
        paddingVertical: theme.spacing.md,
    },

    friendItemHovered: {
        borderColor: theme.colors.secondary,
    },
    friendItemPressed: {
        backgroundColor: theme.colors.card,
    },
    logoutButton: {
        margin: theme.spacing.sm,
    },
});
