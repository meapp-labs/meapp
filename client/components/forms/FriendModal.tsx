import { View, TouchableOpacity } from 'react-native';
import { Text } from '../common/Text';
import { theme } from '@/theme/theme';

const modalOptions = [
    { id: '1', title: 'Delete from contacts' },
    { id: '2', title: 'Some option' },
    { id: '3', title: 'Some other option' },
];

export default function FriendModal() {
    return (
        <View style={{ gap: theme.spacing.md }}>
            {modalOptions.map((item) => (
                <TouchableOpacity
                    style={{
                        borderBottomWidth: 1,
                        borderColor: theme.colors.secondary,
                    }}
                    onPress={() => console.log('JOHN STAMP')}
                >
                    <Text style={theme.typography.h2}>{item.title}</Text>
                </TouchableOpacity>
            ))}
        </View>
    );
}

//const styles = StyleSheet.create({});
