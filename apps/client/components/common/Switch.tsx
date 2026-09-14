import React from 'react';
import {
  Switch as RNSwitch,
  StyleSheet,
  SwitchProps,
  TouchableOpacity,
  ViewStyle,
} from 'react-native';

import { Text } from '@/components/common/Text';
import { theme } from '@/theme/theme';

interface CustomSwitchProps
  extends Omit<SwitchProps, 'trackColor' | 'thumbColor'> {
  label?: string;
  labelPosition?: 'left' | 'right';
  style?: ViewStyle;
}

export default function Switch({
  value,
  onValueChange,
  disabled = false,
  label,
  labelPosition = 'right',
  style,
  ...props
}: CustomSwitchProps) {
  const handleToggle = () => {
    if (!disabled && onValueChange) {
      void onValueChange(!value);
    }
  };

  const switchElement = (
    <RNSwitch
      value={value}
      onValueChange={onValueChange}
      trackColor={{
        false: theme.colors.border,
        true: theme.colors.secondary,
      }}
      thumbColor={value ? theme.colors.primary : theme.colors.text}
      disabled={disabled}
      {...props}
    />
  );

  if (!label) {
    return switchElement;
  }

  return (
    <TouchableOpacity
      style={[styles.container, style]}
      onPress={handleToggle}
      disabled={disabled}
      activeOpacity={0.7}
    >
      {labelPosition === 'left' && <Text style={styles.label}>{label}</Text>}
      {switchElement}
      {labelPosition === 'right' && <Text style={styles.label}>{label}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  label: {
    ...theme.typography.body,
  },
});
