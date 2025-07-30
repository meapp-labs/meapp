import { StyleSheet, View } from 'react-native';
import { PropsWithChildren } from 'react';

export default function CenteredContainer({ children }: PropsWithChildren) {
    return <View style={styles.container}>{children}</View>;
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
