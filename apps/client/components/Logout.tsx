import { MaterialIcons } from '@expo/vector-icons'
import { TouchableOpacity } from 'react-native'

import { useLogoutUser } from '@/services/auth'
import { theme } from '@/theme/theme'

export function Logout() {
  const { mutate: logout } = useLogoutUser()
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel="Sign out"
      onPress={() => logout()}
      style={{
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
      }}
    >
      <MaterialIcons name="logout" size={24} color={theme.colors.text} />
    </TouchableOpacity>
  )
}
