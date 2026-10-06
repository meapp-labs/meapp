import { Text } from '@/components/common/Text'
import { linkPresentation } from '@/services/linkPresentation'
import { parseMessageLinks, standaloneMessageLink } from '@/services/messageLinks'
import { theme } from '@/theme/theme'
import { MaterialIcons } from '@expo/vector-icons'
import { StyleSheet, View } from 'react-native'
import { ExternalMessageLink } from './ExternalMessageLink'

export function MessageText({ text }: { text: string }) {
  const parts = parseMessageLinks(text)
  const link = standaloneMessageLink(parts)
  if (link?.url) {
    const presentation = linkPresentation(link.url)
    const label = /^(?:https?:\/\/|www\.)/i.test(link.text) ? presentation.title : link.text
    return (
      <ExternalMessageLink url={link.url} standalone>
        <View style={styles.card}>
          <MaterialIcons name={presentation.icon} size={20} color={theme.colors.primary} />
          <View style={styles.details}>
            <Text style={styles.title} numberOfLines={1}>
              {label}
            </Text>
            <Text style={styles.url} numberOfLines={1} ellipsizeMode="middle">
              {presentation.destination}
            </Text>
          </View>
          <MaterialIcons name="open-in-new" size={14} color={theme.colors.textSecondary} />
        </View>
      </ExternalMessageLink>
    )
  }
  return (
    <Text selectable>
      {parts.map((part, index) =>
        part.url ? (
          <ExternalMessageLink key={`${index}:${part.url}`} url={part.url}>
            {part.text}
          </ExternalMessageLink>
        ) : (
          part.text
        ),
      )}
    </Text>
  )
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, maxWidth: 260 },
  details: { flexShrink: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 13, fontWeight: '600' },
  url: { color: theme.colors.textSecondary, fontSize: 11 },
})
