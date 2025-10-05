import { Text } from '@/components/common/Text';
import { theme } from '@/theme/theme';
import { View, StyleSheet, Switch } from 'react-native';
import { useState } from 'react';

declare module 'react-native' {
  interface SwitchProps {
    activeThumbColor?: string;
  }
}

export function Notifications() {
  const [isEnabled, setIsEnabled] = useState<Record<string, boolean>>({});

  const handleToggle = (id: string) => {
    setIsEnabled((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  return (
    <View>
      <Text style={styles.placeholderLabel}>Account notifications</Text>
      <Text style={styles.placeholderDesc}>{placeholderDesc}</Text>
      {placeholderOptions.map((item) => (
        <View key={item.label} style={styles.optionHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.itemLabel}>{item.label}</Text>
            <Text style={styles.itemDescription}>{item.description}</Text>
          </View>
          <Switch
            style={{ alignSelf: 'center' }}
            trackColor={{
              false: theme.colors.borderSecondary,
              true: theme.colors.secondary,
            }}
            activeThumbColor={
              isEnabled[item.label] ? theme.colors.text : theme.colors.card
            }
            thumbColor={
              isEnabled[item.label] ? theme.colors.text : theme.colors.card
            }
            value={!!isEnabled[item.label]}
            onValueChange={() => handleToggle(item.label)}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  optionHeader: {
    flexDirection: 'row',
    borderColor: theme.colors.surface,
    borderBottomWidth: 1,
  },
  placeholderLabel: {
    ...theme.typography.h2,
    marginBottom: theme.spacing.sm,
  },
  placeholderDesc: {
    marginBottom: theme.spacing.lg,
    maxWidth: '95%',
  },
  itemLabel: {
    ...theme.typography.body,
    marginVertical: theme.spacing.sm,
  },
  itemDescription: {
    marginBottom: theme.spacing.md,
  },
});

const placeholderDesc =
  'We will send you notifications to inform you of any updates and/or changes as events occur for you or your business in MeApp. Select which notifications you want to receive below:';

const placeholderOptions: { label: string; description: string }[] = [
  {
    label: 'Accounting',
    description: 'When accounting and bookkeeping needs your attention.',
  },
  {
    label: 'Sales',
    description:
      'When relevant sales-related activity occurs such as when an invoice is overdue.',
  },
  {
    label: 'Payments',
    description:
      "When you've been paid or need to be notified to keep your MeApp payments operating.",
  },
  {
    label: 'Purchases',
    description:
      "When receipts exports are ready and when receipts you've emailed to MeApp need to be posted into accounting.",
  },
  {
    label: 'Bills',
    description: 'When you need to be reminded of upcoming and/or late bills.',
  },
];
