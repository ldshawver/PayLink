import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { Capacitor } from "@capacitor/core";

function getApiBaseUrl(): string {
  if (Capacitor.isNativePlatform()) {
    return import.meta.env.VITE_API_BASE_URL || "https://app.mypaylink.paylink";
  }
  return "";
}

export const API_BASE_URL = getApiBaseUrl();

function resolveUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  return `${API_BASE_URL}${url}`;
}

async function readApiErrorMessage(res: Response): Promise<string> {
  const text = (await res.text()) || res.statusText;
  if (!text) return res.statusText || "Request failed";

  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.message === "string") return parsed.message;
    if (typeof parsed?.error === "string") return parsed.error;
  } catch {
    // Keep the raw response text for non-JSON errors.
  }

  return text;
}

export function normalizeApiError(error: unknown): Error {
  if (error instanceof TypeError) {
    return new Error("Network error: PayLink could not reach the server. Please refresh and try again.");
  }
  return error instanceof Error ? error : new Error("Unexpected request error");
}

// Concierge Launch Option A, blocker 3 — double-submit CSRF cookie. The server
// issues a readable `csrf_token` cookie once a session exists; every mutating
// request through apiRequest() echoes it back as a header so the server can
// verify the two match.
function getCsrfToken(): string | undefined {
  const match = document.cookie.match(/(?:^|; )csrf_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const message = await readApiErrorMessage(res);
    throw new Error(`${res.status}: ${message}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  try {
    const csrfToken = getCsrfToken();
    const headers: Record<string, string> = data ? { "Content-Type": "application/json" } : {};
    if (csrfToken && method.toUpperCase() !== "GET") {
      headers["x-csrf-token"] = csrfToken;
    }
    const res = await fetch(resolveUrl(url), {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
      cache: "no-store",
    });

    await throwIfResNotOk(res);
    return res;
  } catch (error) {
    throw normalizeApiError(error);
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const path = queryKey.join("/") as string;
    let res: Response;
    try {
      res = await fetch(resolveUrl(path), {
        credentials: "include",
        cache: "no-store",
      });
    } catch (error) {
      throw normalizeApiError(error);
    }

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
