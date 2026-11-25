import React, { useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFinances } from '@/db/FinanceContext';
import type { ThemeColors } from '@/theme/colors';

export default function TabsLayout() {
  const { t, colors: Colors } = useFinances();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, Platform.OS === 'android' ? 10 : 12);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.border,
          borderTopWidth: 1,
          height: 58 + bottomPad,
          paddingBottom: bottomPad,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t.tabOverview,
          tabBarIcon: ({ color, size }) => (
            <Ionicons
              name="pie-chart-outline"
              size={size}
              color={typeof color === 'string' ? color : Colors.textMuted}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="expenses"
        options={{
          title: t.tabExpenses,
          tabBarIcon: ({ color, size }) => (
            <Ionicons
              name="receipt-outline"
              size={size}
              color={typeof color === 'string' ? color : Colors.textMuted}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: t.tabScan,
          tabBarIcon: ({ focused }) => (
            <View
              style={[
                styles.scanBadge,
                focused && { backgroundColor: Colors.primaryDark, transform: [{ scale: 1.05 }] },
              ]}
            >
              <Ionicons name="scan-outline" size={22} color={Colors.white} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="budgets"
        options={{
          title: t.tabBudgets,
          tabBarIcon: ({ color, size }) => (
            <Ionicons
              name="wallet-outline"
              size={size}
              color={typeof color === 'string' ? color : Colors.textMuted}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="insights"
        options={{
          title: t.tabSave,
          tabBarIcon: ({ color, size }) => (
            <Ionicons
              name="bulb-outline"
              size={size}
              color={typeof color === 'string' ? color : Colors.textMuted}
            />
          ),
        }}
      />
    </Tabs>
  );
}

const createStyles = (Colors: ThemeColors) =>
  StyleSheet.create({
    scanBadge: {
      width: 40,
      height: 32,
      borderRadius: 12,
      backgroundColor: Colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
