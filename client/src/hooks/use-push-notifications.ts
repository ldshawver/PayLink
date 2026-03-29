import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/queryClient";

type PushPermissionState = "prompt" | "granted" | "denied" | "unsupported";

function isNativeApp(): boolean {
  return !!(window as any).Capacitor?.isNativePlatform?.();
}

function getPlatform(): string {
  const cap = (window as any).Capacitor;
  if (cap?.getPlatform) return cap.getPlatform();
  return "web";
}

export function usePushNotifications() {
  const [permissionState, setPermissionState] = useState<PushPermissionState>("prompt");
  const [token, setToken] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const registrationListenerAdded = useRef(false);

  useEffect(() => {
    if (isNativeApp()) {
      setPermissionState("prompt");
    } else if ("Notification" in window) {
      setPermissionState(Notification.permission as PushPermissionState);
    } else {
      setPermissionState("unsupported");
    }
  }, []);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      if (isNativeApp()) {
        const PushNotifications = (window as any).Capacitor?.Plugins?.PushNotifications;
        if (!PushNotifications) return false;

        const result = await PushNotifications.requestPermissions();
        if (result.receive === "granted") {
          setPermissionState("granted");
          return true;
        }
        setPermissionState("denied");
        return false;
      }

      if ("Notification" in window) {
        const result = await Notification.requestPermission();
        setPermissionState(result as PushPermissionState);
        return result === "granted";
      }

      return false;
    } catch {
      return false;
    }
  }, []);

  const registerToken = useCallback(async () => {
    if (isRegistering) return;
    setIsRegistering(true);
    try {
      if (isNativeApp()) {
        const PushNotifications = (window as any).Capacitor?.Plugins?.PushNotifications;
        if (!PushNotifications) return;

        if (!registrationListenerAdded.current) {
          registrationListenerAdded.current = true;
          PushNotifications.addListener("registration", async (regToken: { value: string }) => {
            setToken(regToken.value);
            await apiRequest("POST", "/api/device-tokens", {
              token: regToken.value,
              platform: getPlatform(),
            });
          });
        }
        await PushNotifications.register();
      } else if ("serviceWorker" in navigator && "PushManager" in window) {
        const registration = await navigator.serviceWorker.ready;
        const existingSub = await registration.pushManager.getSubscription();
        if (existingSub) {
          const subToken = JSON.stringify(existingSub);
          setToken(subToken);
          await apiRequest("POST", "/api/device-tokens", {
            token: subToken,
            platform: "web",
          });
        }
      }
    } catch (err) {
      console.error("Push registration failed:", err);
    } finally {
      setIsRegistering(false);
    }
  }, [isRegistering]);

  const unregisterToken = useCallback(async () => {
    if (!token) return;
    try {
      await apiRequest("DELETE", "/api/device-tokens", { token });
      setToken(null);
    } catch (err) {
      console.error("Push unregistration failed:", err);
    }
  }, [token]);

  const setupPushListeners = useCallback(() => {
    if (!isNativeApp()) return () => {};

    const PushNotifications = (window as any).Capacitor?.Plugins?.PushNotifications;
    if (!PushNotifications) return () => {};

    const receivedListener = PushNotifications.addListener(
      "pushNotificationReceived",
      (notification: any) => {
        console.log("Push notification received:", notification);
      }
    );

    const actionListener = PushNotifications.addListener(
      "pushNotificationActionPerformed",
      (action: any) => {
        console.log("Push notification action:", action);
        const data = action?.notification?.data;
        if (data?.actionUrl) {
          window.location.hash = data.actionUrl;
        }
      }
    );

    return () => {
      receivedListener?.then?.((l: any) => l.remove?.());
      actionListener?.then?.((l: any) => l.remove?.());
    };
  }, []);

  return {
    permissionState,
    token,
    isRegistering,
    isNativeApp: isNativeApp(),
    requestPermission,
    registerToken,
    unregisterToken,
    setupPushListeners,
  };
}
