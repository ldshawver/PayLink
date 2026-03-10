import { createContext, useContext, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, getQueryFn } from "@/lib/queryClient";

type AuthUser = {
  id: string;
  username: string;
  role: string;
  companyId?: string | null;
  workerId?: string | null;
  worker?: { id: string; firstName: string; lastName: string; companyId: string } | null;
};

type AuthContextType = {
  user: AuthUser | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  pinLogin: (employeeNumber: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: user, isLoading } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    staleTime: Infinity,
  });

  const loginMutation = useMutation({
    mutationFn: async ({ username, password }: { username: string; password: string }) => {
      const res = await apiRequest("POST", "/api/auth/login", { username, password });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  const pinLoginMutation = useMutation({
    mutationFn: async ({ employeeNumber, pin }: { employeeNumber: string; pin: string }) => {
      const res = await apiRequest("POST", "/api/auth/pin-login", { employeeNumber, pin });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout");
    },
    onSuccess: () => {
      queryClient.setQueryData(["/api/auth/me"], null);
      queryClient.clear();
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
