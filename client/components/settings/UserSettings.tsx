import { theme } from '@/theme/theme';
import {
    Modal,
    View,
    StyleSheet,
    Pressable,
    ScrollView,
    TouchableHighlight,
} from 'react-native';
import { Text } from '@/components/common/Text';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { useState } from 'react';
import { Notifications } from './Notifications';

type UserSettingsProps = {
    showSettings: boolean;
    setShowSettings: (value: boolean) => void;
};

const optionsPlaceholder: {
    name: string;
    icon: React.ComponentProps<typeof MaterialIcons>['name'];
    component?: React.ComponentType;
}[] = [
    { name: 'Personal Info', icon: 'person-outline' },
    { name: 'Emails & Password', icon: 'key' },
    {
        name: 'Notifications',
        icon: 'mark-chat-unread',
        component: Notifications,
    },
    { name: 'Blocked Users', icon: 'block' },
    { name: 'Account Settings', icon: 'settings' },
];
export default function UserSettings({
    showSettings,
    setShowSettings,
}: UserSettingsProps) {
    const [pressed, setPressed] = useState<string | null>('Notifications');
    const selected = optionsPlaceholder.find((opt) => opt.name === pressed);
    return (
        <>
            <TouchableHighlight onPress={() => setShowSettings(true)}>
                <MaterialIcons
                    name="settings"
                    size={28}
                    color={theme.colors.text}
                />
            </TouchableHighlight>
            {showSettings && (
                <Modal
                    visible={showSettings}
                    animationType="slide"
                    onRequestClose={() => setShowSettings(false)}
                    transparent={true}
                >
                    <View style={styles.container}>
                        <View style={[styles.content, styles.shadow]}>
                            <ScrollView
                                style={[
                                    styles.innerContainer,
                                    styles.containerBorder,
                                ]}
                            >
                                <Text style={styles.optionsHeader}>
                                    User profile management
                                </Text>
                                <ScrollView
                                    style={{ flex: 1 }}
                                    contentContainerStyle={{
                                        paddingBottom: theme.spacing.md,
                                    }}
                                    showsVerticalScrollIndicator={true}
                                >
                                    {optionsPlaceholder.map((item) => (
                                        <Pressable
                                            key={item.name}
                                            style={[
                                                styles.option,
                                                pressed === item.name &&
                                                    styles.optionPressed,
                                            ]}
                                            onPress={() =>
                                                setPressed(item.name)
                                            }
                                        >
                                            <View style={styles.iconsWtext}>
                                                <MaterialIcons
                                                    name={item.icon}
                                                    size={20}
                                                    color={
                                                        pressed === item.name
                                                            ? theme.colors
                                                                  .secondary
                                                            : 'white'
                                                    }
                                                />
                                                <Text
                                                    style={{
                                                        color:
                                                            pressed ===
                                                            item.name
                                                                ? theme.colors
                                                                      .secondary
                                                                : 'white',
                                                    }}
                                                >
                                                    {item.name}
                                                </Text>
                                            </View>
                                        </Pressable>
                                    ))}
                                </ScrollView>
                            </ScrollView>
                            {selected && (
                                <ScrollView style={styles.innerContainer}>
                                    <View style={styles.headerContainer}>
                                        <Text style={styles.selectedHeader}>
                                            {selected.name}
                                        </Text>
                                        <Pressable
                                            onPress={() =>
                                                setShowSettings(false)
                                            }
                                        >
                                            <MaterialIcons
                                                name="close"
                                                size={32}
                                                color="white"
                                            />
                                        </Pressable>
                                    </View>
                                    {selected.component && (
                                        <selected.component />
                                    )}
                                </ScrollView>
                            )}
                        </View>
                    </View>
                </Modal>
            )}
        </>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.background,
    },
    shadow: {
        shadowColor: theme.colors.secondary,
        shadowOpacity: 0.5,
        shadowRadius: 15,
        shadowOffset: {
            width: 0,
            height: 0,
        },
    },
    content: {
        margin: theme.spacing.lg,
        flex: 1,
        flexDirection: 'row',
        borderRadius: theme.spacing.lg,
        borderColor: theme.colors.secondary,
        borderWidth: 1,
        backgroundColor: theme.colors.background,
    },
    optionsHeader: {
        ...theme.typography.h2,
        fontWeight: 'bold',
        marginBottom: theme.spacing.lg,
        marginRight: theme.spacing.lg,
    },
    innerContainer: {
        margin: theme.spacing.md,
        padding: theme.spacing.md,
    },
    option: {
        padding: theme.spacing.sm,
        alignSelf: 'flex-start',
    },
    iconsWtext: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: theme.spacing.sm,
    },
    containerBorder: {
        borderRightWidth: 1,
        borderColor: theme.colors.surface,
    },
    optionPressed: {
        backgroundColor: theme.colors.surface,
        borderRadius: theme.spacing.md,
        color: theme.colors.surface,
    },
    selectedHeader: {
        ...theme.typography.h1,
        fontWeight: 'bold',
    },
    headerContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        borderBottomWidth: 1,
        borderColor: theme.colors.surface,
        paddingBottom: theme.spacing.md,
        marginBottom: theme.spacing.md,
    },
});
