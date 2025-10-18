const colors = {
  primary: '#F5BA30', // Xanthous - CTAs, interactive elements, brand
  secondary: '#D97706', // Deep Amber - hover states, pressed buttons
  background: '#000000', // Pure Black - main app background (OLED)
  backgroundSecondary: '#0A0A0A', // Near Black - modals, overlays
  surface: '#121212', // Surface Level 1 - cards, message bubbles
  card: '#1E1E1E', // Surface Level 2 - elevated cards, navigation
  text: '#FAFAFA', // Primary text - headings, body text
  textSecondary: '#9CA3AF', // Secondary text - timestamps, metadata
  border: '#374151', // Primary borders - dividers, outlines
  borderSecondary: '#1F2937', // Subtle borders - internal separators
  error: '#EF4444', // Error red - destructive actions, errors
  success: '#10B981', // Success green - confirmations, online status
  warning: '#F59E0B', // Warning (same as primary) - cautions, pending
  textTertiary: '#6B7280', // Disabled text, placeholders
  surfaceElevated: '#2A2A2A', // Surface Level 3 - dropdowns, tooltips
  info: '#3B82F6', // Blue for links, informational messages
  overlay: 'rgba(0, 0, 0, 0.60)', // Modal backdrop dimming
  primaryHover: '#FBBF24', // Lighter amber for hover interactions
  primaryDisabled: '#78350F', // Disabled amber state
};

const typography = {
  h1: { fontSize: 28 },
  h2: { fontSize: 22 },
  body: { fontSize: 16 },
  caption: { fontSize: 12 },
};

const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const theme = {
  colors,
  typography,
  spacing,
};
