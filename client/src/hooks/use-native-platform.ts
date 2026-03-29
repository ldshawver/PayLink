import { useCallback, useEffect, useRef } from "react";

function isNativeApp(): boolean {
  return !!(window as any).Capacitor?.isNativePlatform?.();
}

export function useStatusBar() {
  const setStyle = useCallback(async (style: "dark" | "light" | "default") => {
    if (!isNativeApp()) return;
    const StatusBar = (window as any).Capacitor?.Plugins?.StatusBar;
    if (!StatusBar) return;
    try {
      await StatusBar.setStyle({ style: style === "dark" ? "DARK" : style === "light" ? "LIGHT" : "DEFAULT" });
    } catch { /* not supported */ }
  }, []);

  const setBackgroundColor = useCallback(async (color: string) => {
    if (!isNativeApp()) return;
    const StatusBar = (window as any).Capacitor?.Plugins?.StatusBar;
    if (!StatusBar) return;
    try {
      await StatusBar.setBackgroundColor({ color });
    } catch { /* not supported */ }
  }, []);

  return { setStyle, setBackgroundColor };
}

export function useKeyboardManager() {
  useEffect(() => {
    if (!isNativeApp()) return;
    const Keyboard = (window as any).Capacitor?.Plugins?.Keyboard;
    if (!Keyboard) return;

    const showListener = Keyboard.addListener("keyboardWillShow", (info: any) => {
      document.body.style.setProperty("--keyboard-height", `${info.keyboardHeight}px`);
      document.documentElement.classList.add("keyboard-open");
    });
    const hideListener = Keyboard.addListener("keyboardWillHide", () => {
      document.body.style.setProperty("--keyboard-height", "0px");
      document.documentElement.classList.remove("keyboard-open");
    });

    return () => {
      showListener?.then?.((l: any) => l.remove?.());
      hideListener?.then?.((l: any) => l.remove?.());
    };
  }, []);
}

export function useHaptics() {
  const impact = useCallback(async (style: "light" | "medium" | "heavy" = "light") => {
    if (!isNativeApp()) return;
    const Haptics = (window as any).Capacitor?.Plugins?.Haptics;
    if (!Haptics) return;
    try {
      await Haptics.impact({
        style: style === "heavy" ? "HEAVY" : style === "medium" ? "MEDIUM" : "LIGHT",
      });
    } catch { /* not supported */ }
  }, []);

  const notification = useCallback(async (type: "success" | "warning" | "error" = "success") => {
    if (!isNativeApp()) return;
    const Haptics = (window as any).Capacitor?.Plugins?.Haptics;
    if (!Haptics) return;
    try {
      await Haptics.notification({
        type: type === "error" ? "ERROR" : type === "warning" ? "WARNING" : "SUCCESS",
      });
    } catch { /* not supported */ }
  }, []);

  return { impact, notification };
}

export function usePageTransition() {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousPath = useRef<string>("");

  const animateTransition = useCallback((currentPath: string) => {
    if (!containerRef.current) return;
    if (previousPath.current === currentPath) return;

    const el = containerRef.current;
    el.style.opacity = "0";
    el.style.transform = "translateX(8px)";

    requestAnimationFrame(() => {
      el.style.transition = "opacity 200ms ease-out, transform 200ms ease-out";
      el.style.opacity = "1";
      el.style.transform = "translateX(0)";

      setTimeout(() => {
        el.style.transition = "";
      }, 220);
    });

    previousPath.current = currentPath;
  }, []);

  return { containerRef, animateTransition };
}

export function useAppLifecycle(onResume: () => void) {
  useEffect(() => {
    if (!isNativeApp()) return;
    const App = (window as any).Capacitor?.Plugins?.App;
    if (!App) return;

    const listener = App.addListener("appStateChange", (state: { isActive: boolean }) => {
      if (state.isActive) {
        onResume();
      }
    });

    return () => {
      listener?.then?.((l: any) => l.remove?.());
    };
  }, [onResume]);
}
