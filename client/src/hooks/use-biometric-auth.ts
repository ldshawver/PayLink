import { useCallback, useState, useEffect } from "react";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";

function isNativeApp(): boolean {
  return !!(window as any).Capacitor?.isNativePlatform?.();
}

const BIOMETRIC_ENABLED_KEY = "paylink_biometric_enabled";
const RESTORE_TOKEN_KEY = "paylink_restore_token";

async function nativeKeychainGet(key: string): Promise<string | null> {
  if (!isNativeApp()) return localStorage.getItem(key);
  const SecureStorage = (window as any).Capacitor?.Plugins?.SecureStoragePlugin;
  if (SecureStorage) {
    try {
      const result = await SecureStorage.get({ key });
      return result?.value || null;
    } catch {
      return null;
    }
  }
  return localStorage.getItem(key);
}

async function nativeKeychainSet(key: string, value: string): Promise<void> {
  if (!isNativeApp()) {
    localStorage.setItem(key, value);
    return;
  }
  const SecureStorage = (window as any).Capacitor?.Plugins?.SecureStoragePlugin;
  if (SecureStorage) {
    try {
      await SecureStorage.set({ key, value });
      return;
    } catch { /* fallback */ }
  }
  localStorage.setItem(key, value);
}

async function nativeKeychainRemove(key: string): Promise<void> {
  if (!isNativeApp()) {
    localStorage.removeItem(key);
    return;
  }
  const SecureStorage = (window as any).Capacitor?.Plugins?.SecureStoragePlugin;
  if (SecureStorage) {
    try {
      await SecureStorage.remove({ key });
      return;
    } catch { /* fallback */ }
  }
  localStorage.removeItem(key);
}

export function useBiometricAuth() {
  const [isAvailable, setIsAvailable] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [biometricType, setBiometricType] = useState<string>("Biometric");

  useEffect(() => {
    checkAvailability();
    checkEnabled();
  }, []);

  const checkAvailability = useCallback(async () => {
    if (isNativeApp()) {
      const BiometricAuth = (window as any).Capacitor?.Plugins?.BiometricAuth;
      if (BiometricAuth) {
        try {
          const result = await BiometricAuth.checkBiometry();
          setIsAvailable(result.isAvailable);
          setBiometricType(result.biometryType === 1 ? "Face ID" : result.biometryType === 2 ? "Touch ID" : "Biometric");
          return;
        } catch { /* fallback */ }
      }
      const NativeBiometric = (window as any).Capacitor?.Plugins?.NativeBiometric;
      if (NativeBiometric) {
        try {
          const result = await NativeBiometric.isAvailable();
          setIsAvailable(result.isAvailable);
          setBiometricType(result.biometryType === 1 ? "Face ID" : "Fingerprint");
          return;
        } catch { /* fallback */ }
      }
    }
    setIsAvailable(false);
    setBiometricType("Biometric");
  }, []);

  const checkEnabled = useCallback(async () => {
    const enabled = await nativeKeychainGet(BIOMETRIC_ENABLED_KEY);
    setIsEnabled(enabled === "true");
  }, []);

  const authenticate = useCallback(async (): Promise<boolean> => {
    if (!isAvailable) return false;
    setIsAuthenticating(true);
    try {
      const BiometricAuth = (window as any).Capacitor?.Plugins?.BiometricAuth;
      if (BiometricAuth) {
        await BiometricAuth.authenticate({
          reason: "Unlock PayLink",
          title: "Authenticate",
        });
        return true;
      }
      const NativeBiometric = (window as any).Capacitor?.Plugins?.NativeBiometric;
      if (NativeBiometric) {
        await NativeBiometric.verifyIdentity({
          reason: "Unlock PayLink",
          title: "Authenticate",
        });
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      setIsAuthenticating(false);
    }
  }, [isAvailable]);

  const enableBiometric = useCallback(async (_userId: string) => {
    try {
      const res = await apiRequest("POST", "/api/auth/issue-restore-token");
      const { restoreToken } = await res.json();
      await nativeKeychainSet(BIOMETRIC_ENABLED_KEY, "true");
      await nativeKeychainSet(RESTORE_TOKEN_KEY, restoreToken);
      setIsEnabled(true);
    } catch (err) {
      console.error("Failed to enable biometric:", err);
      throw err;
    }
  }, []);

  const disableBiometric = useCallback(async () => {
    await nativeKeychainRemove(BIOMETRIC_ENABLED_KEY);
    await nativeKeychainRemove(RESTORE_TOKEN_KEY);
    setIsEnabled(false);
  }, []);

  const restoreSession = useCallback(async (): Promise<boolean> => {
    if (!isEnabled || !isAvailable) return false;
    const authenticated = await authenticate();
    if (!authenticated) return false;

    const restoreToken = await nativeKeychainGet(RESTORE_TOKEN_KEY);
    if (!restoreToken) return false;

    try {
      const res = await apiRequest("POST", "/api/auth/token-restore", { restoreToken });
      const userData = await res.json();
      queryClient.setQueryData(["/api/auth/me"], userData);
      return true;
    } catch {
      await disableBiometric();
      return false;
    }
  }, [isEnabled, isAvailable, authenticate, disableBiometric]);

  return {
    isAvailable,
    isEnabled,
    isAuthenticating,
    biometricType,
    isNativeApp: isNativeApp(),
    authenticate,
    enableBiometric,
    disableBiometric,
    restoreSession,
  };
}
