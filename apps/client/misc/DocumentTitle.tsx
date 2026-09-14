import Head from 'expo-router/head';
import { Platform } from 'react-native';

export function DocumentTitle({ title }: { title: string }) {
  return (
    Platform.OS === 'web' && (
      <Head>
        <title>{`MeApp - ${title}`}</title>
      </Head>
    )
  );
}
