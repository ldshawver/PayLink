import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

export function useApiHealth() {
  const [dismissed, setDismissed] = useState(false);
  const wasDown = useRef(false);

  const { isError, isFetching } = useQuery({
    queryKey: ["__api_health_banner__"],
    queryFn: async () => {
      const r = await fetch("/api/health", { credentials: "include" });
      if (!r.ok) throw new Error("API unreachable");
      return r.json();
    },
    refetchInterval: 60_000,
    retry: 1,
    retryDelay: 5_000,
    staleTime: 30_000,
    gcTime: 0,
  });

  const isDown = isError;

  useEffect(() => {
    if (isDown) {
      wasDown.current = true;
    } else if (wasDown.current) {
      wasDown.current = false;
      setDismissed(false);
    }
  }, [isDown]);

  return {
    isDown,
    isFetching,
    dismissed,
    dismiss: () => setDismissed(true),
    showBanner: isDown && !dismissed,
  };
}
