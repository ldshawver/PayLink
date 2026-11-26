import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, getQueryFn } from "@/lib/queryClient";

export type TenantGate = {
  allowed: boolean;
  reason?: string;
  code?: string;
  policyDetail?: string;
};

export type AuthUser = {
  id: string;
  username: string;
  role: string;
  companyId?: string | null;
  workerId?: string | null;
  worker?: { id: string; firstName: string; lastName: string; companyId: string } | null;
  tenantGate?: TenantGate;
};

type AuthContextType = {
  user: AuthUser | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  pinLogin: (employeeNumber: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

const DEFAULT_IDLE_MINUTES = 30;
const TOUCH_INTERVAL_MS = 60 * 1000;

function idleRedirect() {
  const host = window.location.hostname;
  const isLocal = host === "localhost" || host.includes(".repl.") || host.includes(".replit.") || host.includes(".replit.dev") || host.includes(".repl.co");
  window.location.href = isLocal ? "/clock-in" : "https://mypaylink.app/";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: user, isLoading } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    staleTime: Infinity,
  });

  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Server is authoritative (see enforceSessionControls). This timer mirrors
  // the configured idle window for every role so the UI signs out without
  // waiting for the next API call, and throttled touches roll the server clock
  // while the person is actually using the page.
  useEffect(() => {
    if (!user) return;

    let idleMinutes = DEFAULT_IDLE_MINUTES;
    let cancelled = false;
    let lastTouch = 0;

    function resetTimer() {
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
      inactivityTimer.current = setTimeout(async () => {
        try {
          await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
        } catch (_) {}
        queryClient.clear();
        idleRedirect();
      }, idleMinutes * 60 * 1000);
    }

    function onActivity() {
      resetTimer();
      const now = Date.now();
      if (now - lastTouch < TOUCH_INTERVAL_MS) return;
      lastTouch = now;
      fetch("/api/auth/session/touch", { method: "POST", credentials: "include" }).catch(() => {});
    }

    fetch("/api/auth/session-policy", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const n = Number(data?.idleMinutes);
        if (Number.isFinite(n) && n > 0) idleMinutes = n;
        resetTimer();
      })
      .catch(() => { if (!cancelled) resetTimer(); });

    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"];
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    resetTimer();

    return () => {
      cancelled = true;
      events.forEach((e) => window.removeEventListener(e, onActivity));
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    };
  }, [user?.id]);

  const loginMutation = useMutation({
    mutationFn: async ({ username, password }: { username: string; password: string }) => {
      const res = await apiRequest("POST", "/api/auth/login", { username, password });
      return res.json();
    },
    onSuccess: async (data: AuthUser) => {
      if (data?.id) {
        queryClient.setQueryData(["/api/auth/me"], data);
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"], exact: true });
    },
  });

  const pinLoginMutation = useMutation({
    mutationFn: async ({ employeeNumber, pin }: { employeeNumber: string; pin: string }) => {
      const res = await apiRequest("POST", "/api/auth/pin-login", { employeeNumber, pin });
      return res.json();
    },
    onSuccess: async (data: AuthUser) => {
      if (data?.id) {
        queryClient.setQueryData(["/api/auth/me"], data);
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"], exact: true });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/logout");
      return res.json();
    },
    onSuccess: () => {
      queryClient.setQueryData(["/api/auth/me"], null);
      queryClient.clear();
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
      const host = window.location.hostname;
      const isLocal = host === "localhost" || host.includes(".repl.") || host.includes(".replit.") || host.includes(".replit.dev") || host.includes(".repl.co");
      window.location.href = isLocal ? "/clock-in" : "https://mypaylink.app/";
    },
  });

  async function login(username: string, password: string) {
    await loginMutation.mutateAsync({ username, password });
  }

  async function pinLogin(employeeNumber: string, pin: string) {
    await pinLoginMutation.mutateAsync({ employeeNumber, pin });
  }

  async function logout() {
    await logoutMutation.mutateAsync();
  }

  return (
    <AuthContext.Provider value={{ user: user ?? null, isLoading, login, pinLogin, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
