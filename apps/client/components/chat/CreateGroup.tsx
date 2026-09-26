import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'

import { Text } from '@/components/common/Text'
import { type GroupCandidate, getGroupCandidates } from '@/lib/groupCandidates'
import { useAuthStore, useConversationStore } from '@/lib/stores'
import { useCreateConversation, useGetConversations } from '@/services/conversations'
import { useGetFriends } from '@/services/others'
import { ConversationStorage } from '@/services/storage'
import { theme } from '@/theme/theme'

export function CreateGroup({ onClose }: { onClose: () => void }) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [groupName, setGroupName] = useState('')
  const currentUsername = useAuthStore((state) => state.username)
  const setSelectedConversationId = useConversationStore((state) => state.setSelectedConversationId)
  const { data: friends = [], isPending: friendsPending, isError: friendsError } = useGetFriends()
  const {
    data: conversations = [],
    isPending: conversationsPending,
    isError: conversationsError,
  } = useGetConversations()
  const createGroup = useCreateConversation()

  const people = useMemo(
    () => getGroupCandidates(friends, conversations, currentUsername),
    [friends, conversations, currentUsername],
  )

  const filteredPeople = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return query
      ? people.filter((person) => person.username.toLocaleLowerCase().includes(query))
      : people
  }, [people, search])

  const close = () => {
    if (createGroup.isPending) return
    onClose()
  }

  const togglePerson = (username: string) => {
    setSelected((previous) =>
      previous.includes(username)
        ? previous.filter((person) => person !== username)
        : [...previous, username],
    )
  }

  const canCreate = groupName.trim().length > 0 && selected.length >= 2 && !createGroup.isPending
  const create = () => {
    if (!canCreate) return
    createGroup.mutate(
      { type: 'group', participants: selected, name: groupName.trim() },
      {
        onSuccess: (conversation) => {
          setSelectedConversationId(conversation.id)
          void ConversationStorage.save(conversation.id)
          onClose()
        },
      },
    )
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to chats"
          style={styles.back}
          onPress={close}
        >
          <MaterialIcons name="arrow-back" size={22} color={theme.colors.text} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>New group</Text>
          <Text style={styles.subtitle}>Friends and people from your chats</Text>
        </View>
      </View>

      <View style={styles.form}>
        <Text style={styles.label}>Group name</Text>
        <TextInput
          accessibilityLabel="Group name"
          value={groupName}
          onChangeText={setGroupName}
          maxLength={100}
          placeholder="Give your group a name"
          placeholderTextColor={theme.colors.textTertiary}
          style={styles.input}
          returnKeyType="done"
        />

        <View style={styles.peopleHeader}>
          <Text style={styles.label}>Add people</Text>
          <Text style={styles.count}>{selected.length} selected</Text>
        </View>
        <View style={styles.searchBox}>
          <MaterialIcons name="search" size={20} color={theme.colors.textSecondary} />
          <TextInput
            accessibilityLabel="Search people"
            value={search}
            onChangeText={setSearch}
            placeholder="Search friends and chats"
            placeholderTextColor={theme.colors.textTertiary}
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {search.length > 0 && (
            <Pressable accessibilityLabel="Clear search" onPress={() => setSearch('')}>
              <MaterialIcons name="close" size={19} color={theme.colors.textSecondary} />
            </Pressable>
          )}
        </View>

        {selected.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
            {selected.map((username) => (
              <Pressable
                key={username}
                accessibilityLabel={`Remove ${username}`}
                style={styles.chip}
                onPress={() => togglePerson(username)}
              >
                <Text style={styles.chipText}>{username}</Text>
                <MaterialIcons name="close" size={16} color={theme.colors.primary} />
              </Pressable>
            ))}
          </ScrollView>
        )}

        <FlatList<GroupCandidate>
          data={filteredPeople}
          keyExtractor={(person) => person.username}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const isSelected = selected.includes(item.username)
            return (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isSelected }}
                accessibilityLabel={`${item.username}, ${item.isFriend ? 'friend' : 'chat contact'}`}
                style={[styles.person, isSelected && styles.personSelected]}
                onPress={() => togglePerson(item.username)}
              >
                <View style={styles.avatar}>
                  <MaterialIcons name="person" size={21} color={theme.colors.textSecondary} />
                </View>
                <View style={styles.personCopy}>
                  <Text style={styles.personName}>{item.username}</Text>
                  <Text style={styles.personType}>
                    {item.isFriend ? 'Friend' : 'From your chats'}
                  </Text>
                </View>
                <MaterialIcons
                  name={isSelected ? 'check-circle' : 'radio-button-unchecked'}
                  size={23}
                  color={isSelected ? theme.colors.primary : theme.colors.textTertiary}
                />
              </Pressable>
            )
          }}
          ListEmptyComponent={
            friendsPending || conversationsPending ? (
              <ActivityIndicator style={styles.empty} color={theme.colors.primary} />
            ) : (
              <Text style={styles.empty}>
                {search
                  ? 'No people match your search.'
                  : friendsError || conversationsError
                    ? 'Could not load people. Close and try again.'
                    : 'No friends or chats found yet.'}
              </Text>
            )
          }
        />
      </View>

      <View style={styles.footer}>
        <Text style={styles.hint}>Choose at least two people to make a group.</Text>
        {createGroup.error && (
          <Text style={styles.error}>
            {createGroup.error.response?.data?.message ?? createGroup.error.message}
          </Text>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create group"
          disabled={!canCreate}
          style={[styles.createButton, !canCreate && styles.disabled]}
          onPress={create}
        >
          <Text style={styles.createText}>
            {createGroup.isPending ? 'Creating…' : 'Create group'}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderSecondary,
  },
  back: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: theme.colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: { flex: 1 },
  title: { color: theme.colors.text, fontSize: 20, fontWeight: '700' },
  subtitle: { color: theme.colors.textSecondary, marginTop: 2, fontSize: 12 },
  form: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.lg,
  },
  label: { color: theme.colors.text, fontWeight: '600', marginBottom: theme.spacing.sm },
  input: {
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    color: theme.colors.text,
    paddingHorizontal: theme.spacing.md,
    fontSize: 15,
  },
  peopleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: theme.spacing.lg,
  },
  count: { color: theme.colors.textSecondary, fontSize: 13 },
  searchBox: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing.md,
  },
  searchInput: { flex: 1, minWidth: 0, color: theme.colors.text, fontSize: 14 },
  chips: { flexGrow: 0, marginTop: theme.spacing.md },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginRight: theme.spacing.sm,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: theme.colors.card,
  },
  chipText: { color: theme.colors.primary, fontSize: 13 },
  list: { flex: 1, minHeight: 0, marginTop: theme.spacing.sm },
  listContent: { paddingBottom: theme.spacing.sm },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 54,
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: 12,
  },
  personSelected: { backgroundColor: theme.colors.card },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceElevated,
  },
  personCopy: { flex: 1 },
  personName: { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
  personType: { color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 },
  empty: { color: theme.colors.textSecondary, textAlign: 'center', padding: theme.spacing.xl },
  footer: {
    padding: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderSecondary,
  },
  hint: { color: theme.colors.textSecondary, fontSize: 12, marginBottom: theme.spacing.md },
  error: { color: theme.colors.error, fontSize: 13, marginBottom: theme.spacing.md },
  createButton: {
    height: 46,
    borderRadius: 12,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createText: { color: '#111', fontWeight: '700' },
  disabled: { opacity: 0.45 },
})
