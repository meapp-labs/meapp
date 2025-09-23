import {
    View,
    TouchableOpacity,
    Modal,
    Pressable,
    StyleSheet,
} from 'react-native';
import { Text } from '../common/Text';
import { theme } from '@/theme/theme';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

export type Props = {
    setShowModal: (value: boolean) => void;
    showModal: boolean;
};

const modalOptions = [
    { id: '1', title: 'Delete from contacts' },
    { id: '2', title: 'Some option' },
    { id: '3', title: 'Some other option' },
    { id: '4', title: 'PRESS ESC TO CLOSE, for now' },
];

export default function Attachment({ showModal, setShowModal }: Props) {
    return (
        <>
            <TouchableOpacity onPress={() => setShowModal(true)}>
                <MaterialIcons
                    name="attach-file"
                    size={24}
                    color={theme.colors.text}
                />
            </TouchableOpacity>

            <Modal
                animationType="fade"
                visible={showModal}
                transparent
                onRequestClose={() => setShowModal(false)}
            >
                <View style={styles.modalContainer}>
                    <Pressable style={styles.border}>
                        <View style={styles.modalBox}>
                            <View style={{ gap: theme.spacing.md }}>
                                {modalOptions.map((item) => (
                                    <TouchableOpacity
                                        key={item.id}
                                        style={{
                                            borderBottomWidth: 1,
                                            borderColor: theme.colors.secondary,
                                        }}
                                    >
                                        <Text style={theme.typography.h2}>
                                            {item.title}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>
                    </Pressable>
                </View>
            </Modal>
        </>
    );
}

const styles = StyleSheet.create({
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
