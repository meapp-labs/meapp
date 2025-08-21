import React, { useState } from 'react';
import {
    FlatList,
    Image,
    Modal,
    Pressable,
    StyleSheet,
    View,
} from 'react-native';
import Button from '@/components/common/Button';
import { Text } from '@/components/common/Text';
import { theme } from '@/theme/theme';
import { logoutUser } from '@/services/auth';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import MoreIcon from './forms/MoreIcon';
import FriendModal from './forms/FriendModal';
import { mockOthers } from '../misc/mockOthers';

export default function FriendsScreen() {
    const [hovered, setHovered] = useState<string | null>(null);
    const [pressed, setPressed] = useState<string | null>(null);
    const [showModal, setShowModal] = useState(false);
    const { mutate: logout } = useMutation({
        mutationFn: logoutUser,
        onSuccess: () => {
            router.replace('/login');
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
            <View
                style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    flex: 1,
                }}
            >
                <Image style={styles.avatar} source={{ uri: item.avatar }} />
                <Text>{item.name}</Text>
            </View>
            {(hovered === item.id || pressed === item.id) && (
                <MoreIcon setShowModal={setShowModal} />
            )}
            <Pressable onPress={() => setShowModal(false)}>
                <Modal
                    animationType="fade"
                    visible={showModal}
                    transparent
                    onRequestClose={() => setShowModal(false)}
                >
                    <View style={styles.modalContainer}>
                        <Pressable style={styles.border}>
                            <View style={styles.modalBox}>
                                <FriendModal />
                            </View>
                        </Pressable>
                    </View>
                </Modal>
            </Pressable>
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
        marginHorizontal: theme.spacing.sm,
        borderRadius: theme.spacing.sm,
        borderColor: theme.colors.surface,
        borderWidth: 1,
        paddingVertical: theme.spacing.sm,
    },
    avatar: {
        width: 50,
        height: 50,
        borderRadius: 25,
        marginHorizontal: theme.spacing.md,
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
    modalContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalBox: {
        backgroundColor: theme.colors.background,
    },
    border: {
        borderWidth: 1,
        borderColor: theme.colors.secondary,
        borderRadius: 25,
        padding: theme.spacing.md,
        cursor: 'auto',
    },
});
