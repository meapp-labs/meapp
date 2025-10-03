import React, { useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    StyleSheet,
    View,
} from 'react-native';
import { Text } from '@/components/common/Text';
import { theme } from '@/theme/theme';
import { useGetFriends } from '@/services/others';
import TopMenu from '@/components/forms/TopMenu';
import DeleteFriend from '@/components/chat/DeleteFriend';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { usePressedStore } from '@/lib/stores';
import { queryClient } from '@/lib/queryInit';
import { Keys } from '@/lib/keys';
import UserSettings from '@/components/settings/UserSettings';
import { Logout } from '@/components/Logout';
import { RemoveIcon } from '@/components/chat/RemoveIcon';
import useBreakpoint from '@/hooks/useBreakpoint';

export type Friend = {
    name: string;
};

export default function FriendsScreen() {
    const { pressed, setPressed } = usePressedStore();
    const [hovered, setHovered] = useState<string | null>(null);
    const [showSettings, setShowSettings] = useState<boolean>(false);
    const [removeId, setRemoveId] = useState<string | null>(null);
    const { isMobile, isDesktop } = useBreakpoint();

    const handleChange = (pressed: string | null, removed: string | null) => {
        setPressed(pressed ? { name: pressed } : null);
        setRemoveId(removed);
    };

    const { data: others = [], isPending } = useGetFriends();

    const items: Friend[] = others.map((name) => ({
        name,
    }));

    const renderFriend = ({ item }: { item: Friend }) => (
        <>
            <Pressable
                onPress={() => {
                    queryClient.refetchQueries({
                        queryKey: [Keys.Query.GET_MESSAGES],
                    });
                }}
                onPressIn={() => {
                    setPressed(item);
                    setRemoveId(null);
                }}
                onHoverIn={() => setHovered(item.name)}
                onHoverOut={() => setHovered(null)}
                style={[
                    styles.friendItem,
                    hovered === item.name && styles.friendItemHovered,
                    pressed?.name === item.name && styles.friendItemPressed,
                ]}
            >
                <View style={styles.messageBoxContainer}>
                    <MaterialIcons
                        name="face"
                        size={38}
                        color={theme.colors.text}
                    />
                    <View style={styles.messageBox}>
                        <Text>{item.name}</Text>
                        <Text style={{ ...theme.typography.caption }}>
                            We NEED to play Nightreign...
                        </Text>
                    </View>
                    <Text style={styles.timestamp}>10 min </Text>
                    {isDesktop && pressed?.name === item.name && (
                        <RemoveIcon item={item} setRemoveId={setRemoveId} />
                    )}
                </View>
            </Pressable>
            {removeId === item.name && (
                <DeleteFriend friend={item.name} onChange={handleChange} />
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
