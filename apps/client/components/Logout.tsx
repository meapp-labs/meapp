import { MaterialIcons } from '@expo/vector-icons'
import { TouchableOpacity } from 'react-native'

import { AuthStorage } from '@/lib/authStorage'
import { useAuthStore, useConversationStore } from '@/lib/stores'
import { useLogoutUser } from '@/services/auth'
import { ConversationStorage, RememberMeStorage } from '@/services/storage'
import { theme } from '@/theme/theme'

export function Logout() {
  const { setSelectedConversationId } = useConversationStore()
  const { setUsername } = useAuthStore()

  const { mutate: logout } = useLogoutUser({
    onSuccess: () => {
      void AuthStorage.clear()
      void RememberMeStorage.clear()
      void ConversationStorage.clear()
      setSelectedConversationId(null)
      setUsername('')
    },
  })
  return (
    <TouchableOpacity onPress={() => logout()}>
      <MaterialIcons name="logout" size={24} color={theme.colors.text} />
    </TouchableOpacity>
  )
}
