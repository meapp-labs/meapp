import { Colors } from '@/constants/Colors';
import { View, type ViewProps } from 'react-native';

export type ThemedViewProps = ViewProps;

export function ThemedView({ style, ...otherProps }: ThemedViewProps) {
    return (
        <View
            style={[{ backgroundColor: Colors.background }, style]}
            {...otherProps}
        />
    );
}
