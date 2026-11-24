import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { Ionicons } from '@expo/vector-icons';
import { useFinances } from '@/db/FinanceContext';
import { Colors } from '@/theme/colors';

const BACKGROUND_GRACE_MS = 15_000;

export function BiometricLockGate({ children }: { children: React.ReactNode }) {
  const { ready, t, biometricLockEnabled, appLocked, setAppLocked } = useFinances();
  const [authError, setAuthError] = useState<string | null>(null);
  const authInFlightRef = useRef(false);
  const backgroundedAtRef = useRef<number | null>(null);

  const runAuthPrompt = useCallback(async () => {
    if (authInFlightRef.current) return;
    authInFlightRef.current = true;
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !enrolled) {
        // Never trap the user if biometrics were disabled at OS level
        setAppLocked(false);
        setAuthError(null);
        return;
      }

      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: t.biometricUnlockPrompt,
        cancelLabel: t.cancel,
        disableDeviceFallback: false,
      });

      if (res.success) {
        setAppLocked(false);
        setAuthError(null);
      } else {
        setAuthError(t.biometricFailedHint);
      }
    } catch {
      setAuthError(t.biometricFailedHint);
    } finally {
      authInFlightRef.current = false;
    }
  }, [setAppLocked, t]);

  // Auto-prompt once whenever the gate enters locked state
  useEffect(() => {
    if (!ready || !biometricLockEnabled || !appLocked) return;
    const timer = setTimeout(() => {
      void runAuthPrompt();
    }, 220);
    return () => clearTimeout(timer);
  }, [ready, biometricLockEnabled, appLocked, runAuthPrompt]);

  // Re-lock when returning from background after grace period
  useEffect(() => {
    if (!biometricLockEnabled) {
      backgroundedAtRef.current = null;
      return;
    }

    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background') {
        backgroundedAtRef.current = Date.now();
      } else if (nextState === 'active') {
        const bgAt = backgroundedAtRef.current;
        backgroundedAtRef.current = null;
        if (bgAt !== null && Date.now() - bgAt >= BACKGROUND_GRACE_MS) {
          setAppLocked(true);
        }
      }
    });

    return () => sub.remove();
  }, [biometricLockEnabled, setAppLocked]);

  const showOverlay = ready && biometricLockEnabled && appLocked;

  return (
    <View style={styles.root}>
      {children}
      {showOverlay && (
        <View style={styles.overlay}>
          <View style={styles.card}>
            <Image
              source={require('../../assets/icon.png')}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.title}>{t.appTitle}</Text>
            <Text style={styles.subtitle}>{t.biometricLockedSub}</Text>

            {authError && <Text style={styles.errorText}>{authError}</Text>}

            <Pressable onPress={() => void runAuthPrompt()} style={styles.unlockBtn}>
              <Ionicons name="finger-print-outline" size={20} color={Colors.white} />
              <Text style={styles.unlockBtnText}>{t.biometricUnlockBtn}</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    zIndex: 9999,
  },
  card: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: Colors.surface,
    borderRadius: 24,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
  },
  logo: {
    width: 76,
    height: 76,
    borderRadius: 20,
    marginBottom: 4,
  },
  title: {
    color: Colors.text,
    fontSize: 22,
    fontWeight: '800',
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  errorText: {
    color: Colors.warning,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 2,
  },
  unlockBtn: {
    marginTop: 10,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 14,
  },
  unlockBtnText: {
    color: Colors.white,
    fontSize: 15,
    fontWeight: '800',
  },
});
