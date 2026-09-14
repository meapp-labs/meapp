import { Text as DefaultText, TextProps } from 'react-native';

import { theme } from '@/theme/theme';

export const Text = (props: TextProps) => {
  const { style, ...otherProps } = props;

  return (
    <DefaultText
      style={[{ color: theme.colors.text }, style]}
      {...otherProps}
    />
  );
};
