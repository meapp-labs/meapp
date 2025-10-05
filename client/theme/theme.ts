const colors = {
  primary: '#2962FF', // Vibrant electric blue (buttons, key actions)
  secondary: '#7C4DFF', // Soft amethyst purple (secondary actions)
  background: '#121212', // True black background
  backgroundSecondary: '#f0f0f0',
  surface: '#1E1E1E', // Slightly elevated surfaces
  card: '#363636ff', // Cards/modals (higher elevation)
  text: '#E0E0E0', // Primary text (high contrast)
  textSecondary: '#9E9E9E', // Secondary text (60% opacity)
  border: '#424242', // Subtle borders/dividers
  borderSecondary: '#747474',
  error: '#be4730ff', // Coral red
  success: '#69F0AE', // Mint green
  warning: '#FFD740', // Amber yellow
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
