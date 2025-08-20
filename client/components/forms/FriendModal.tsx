import { FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from '../common/Text';
import { theme } from '@/theme/theme';

type ItemData = {
    id: string;
    title: string;
};

type ItemProps = {
    item: ItemData;
    onPress: () => void;
};

const DATA: ItemData[] = [
    { id: '1', title: 'Delete from contacts' },
    { id: '2', title: 'Some option' },
    { id: '3', title: 'Some other option' },
];
const Item = ({ item, onPress }: ItemProps) => (
    <TouchableOpacity
        style={{ borderBottomWidth: 1, borderColor: theme.colors.secondary }}
        onPress={onPress}
    >
        <Text style={theme.typography.h2}>{item.title}</Text>
    </TouchableOpacity>
);
export default function FriendModal() {
    const renderItem = ({ item }: { item: ItemData }) => {
        return <Item item={item} onPress={() => console.log('wtf')} />;
    };
    return (
        <FlatList
            data={DATA}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
        ></FlatList>
    );
}

//const styles = StyleSheet.create({});
