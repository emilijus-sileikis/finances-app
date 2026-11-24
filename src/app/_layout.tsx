import React, { useEffect } from 'react';
import Constants from 'expo-constants';
import { router, Stack } from 'expo-router';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BiometricLockGate } from '@/components/BiometricLockGate';
import { FinanceProvider } from '@/db/FinanceContext';
import { Colors } from '@/theme/colors';

const isExpoGo = Constants.appOwnership === 'expo';

function ShareIntentNavigator() {
  const { hasShareIntent } = useShareIntentContext();

  useEffect(() => {
    if (hasShareIntent) {
      router.replace('/scan');
    }
  }, [hasShareIntent]);

  return null;
}

export default function RootLayout() {
  return (
    <ShareIntentProvider options={{ disabled: isExpoGo, resetOnBackground: true }}>
      <SafeAreaProvider>
        <FinanceProvider>
          <BiometricLockGate>
            <ShareIntentNavigator />
            <StatusBar style="light" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: Colors.bg },
              }}
            >
              <Stack.Screen name="(tabs)" />
            </Stack>
          </BiometricLockGate>
        </FinanceProvider>
      </SafeAreaProvider>
    </ShareIntentProvider>
  );
}
