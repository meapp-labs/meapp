import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState } from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';

import { UserAvatar } from '@/components/UserAvatar';
import { Keys } from '@/lib/keys';
import { queryClient } from '@/lib/queryInit';
import { useAddFriend } from '@/services/others';
import { theme } from '@/theme/theme';

import { Text } from '../common/Text';

export default function TopMenu() {
  const [inputData, setInputData] = useState('');

  const {
    mutate: handlePress,
    isError,
    isSuccess,
    error,
    reset,
  } = useAddFriend({
    onSuccess: () =>
      void queryClient.refetchQueries({ queryKey: [Keys.Query.GET_FRIENDS] }),
  });

  return (
    <View style={styles.container}>
      <View style={styles.innerContainer}>
        <UserAvatar />
        <View style={styles.inputContainer}>
          <TextInput
            value={inputData}
            placeholder="Enter username..."
            placeholderTextColor={theme.colors.textSecondary}
            style={styles.textInput}
            onChangeText={setInputData}
          />

          <TouchableOpacity
            style={styles.searchIcon}
            onPress={() => {
              handlePress(inputData, {
                onSettled: () => {
                  setTimeout(() => reset(), 5000);
                },
              });
            }}
          >
            <MaterialIcons name="search" size={24} color={theme.colors.text} />
          </TouchableOpacity>
        </View>
      </View>
      {isError && (
        <Text style={[styles.response, { color: theme.colors.error }]}>
          {
            //this revealed that some error responses are fucked up e.g. input too short
            `${error?.response?.data?.message ?? 'Something went wrong.'}`
          }
        </Text>
      )}
      {isSuccess && (
        <Text style={[styles.response, { color: theme.colors.success }]}>
          Contact successfully added.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'column',
    flex: 1,
  },
  innerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  inputContainer: {
    flexDirection: 'row',
    flex: 1,
    justifyContent: 'center',
    gap: theme.spacing.sm,
    marginVertical: theme.spacing.md,
    marginHorizontal: theme.spacing.sm,
  },
  responseContainer: {
    marginVertical: theme.spacing.sm,
  },
  textInput: {
    flexGrow: 1,
    color: theme.colors.text,
    backgroundColor: theme.colors.card,
    padding: theme.spacing.md,
    borderRadius: theme.spacing.lg,
  },
  response: {
    color: theme.colors.success,
    textAlign: 'center',
    ...theme.typography.caption,
    paddingBottom: theme.spacing.sm,
  },
  addButton: {
    borderRadius: theme.spacing.sm,
    padding: theme.spacing.sm,
  },
  searchIcon: {
    alignSelf: 'center',
    position: 'absolute',
    right: theme.spacing.md,
  },
});
