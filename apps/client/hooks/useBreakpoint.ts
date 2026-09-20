import { useWindowDimensions } from 'react-native'

export const useBreakpoint = () => {
  const { width } = useWindowDimensions()

  return {
    width,
    isDesktop: width >= 1024,
    isTablet: width >= 768 && width < 1024,
    isMobile: width < 768,
  }
}
