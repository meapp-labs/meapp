import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/common/Text';

export default function NotFoundScreen() {
    return (
        <>
            <View style={styles.container}>
                <Text>This screen does not exist.</Text>
            </View>
        </>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
    },
});
