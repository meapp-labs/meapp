const colors = {
  primary: '#F5BA30', // Xanthous - CTAs, interactive elements, brand
  secondary: '#D97706', // Deep Amber - hover states, pressed buttons
  background: '#0C0F14', // Main canvas
  backgroundSecondary: '#10141B', // Navigation and overlays
  surface: '#161B24', // Cards and inputs
  card: '#1D2430', // Elevated surfaces
  text: '#F3F4F6', // Primary text
  textSecondary: '#A5AFBF', // Supporting text
  border: '#394354', // Input borders
  borderSecondary: '#252D3A', // Subtle dividers
  error: '#EF4444', // Error red - destructive actions, errors
  success: '#10B981', // Success green - confirmations, online status
  warning: '#F59E0B', // Warning (same as primary) - cautions, pending
  textTertiary: '#6B7280', // Disabled text, placeholders
  surfaceElevated: '#293344', // Dropdowns and tooltips
  info: '#3B82F6', // Blue for links, informational messages
  overlay: 'rgba(0, 0, 0, 0.60)', // Modal backdrop dimming
  primaryHover: '#FBBF24', // Lighter amber for hover interactions
  primaryDisabled: '#78350F', // Disabled amber state
}

const typography = {
  h1: { fontSize: 28, lineHeight: 36 },
  h2: { fontSize: 22, lineHeight: 30 },
  body: { fontSize: 16, lineHeight: 24 },
  caption: { fontSize: 12, lineHeight: 18 },
}

const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
}

export const theme = {
  colors,
  typography,
  spacing,
}
