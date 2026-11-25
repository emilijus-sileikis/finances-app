import React, { useEffect } from 'react';
import Constants from 'expo-constants';
import { router, Stack } from 'expo-router';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BiometricLockGate } from '@/components/BiometricLockGate';
import { FinanceProvider, useFinances } from '@/db/FinanceContext';

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

function ThemedAppShell() {
  const { resolvedTheme, colors } = useFinances();

  return (
    <BiometricLockGate>
      <ShareIntentNavigator />
      <StatusBar style={resolvedTheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" />
      </Stack>
    </BiometricLockGate>
  );
}

export default function RootLayout() {
  return (
    <ShareIntentProvider options={{ disabled: isExpoGo, resetOnBackground: true }}>
      <SafeAreaProvider>
        <FinanceProvider>
          <ThemedAppShell />
        </FinanceProvider>
      </SafeAreaProvider>
    </ShareIntentProvider>
  );
}
