import { useWindowDimensions } from 'react-native';

const useBreakpoint = () => {
  const { width } = useWindowDimensions();

  return {
    width,
    isDesktop: width >= 1024,
    isTablet: width > 768 && width < 1023,
    isMobile: width <= 767,
  };
};

export default useBreakpoint;
