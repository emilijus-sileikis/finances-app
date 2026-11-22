import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { FinanceProvider } from '@/db/FinanceContext';
import { Colors } from '@/theme/colors';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <FinanceProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: Colors.bg },
          }}
        >
          <Stack.Screen name="(tabs)" />
        </Stack>
      </FinanceProvider>
    </SafeAreaProvider>
  );
}
