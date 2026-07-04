import { useEffect, useState } from "react";

type VersionResponse = {
  version?: string;
};

export function AppVersionLabel() {
  const [version, setVersion] = useState<string>("...");

  useEffect(() => {
    let cancelled = false;

    fetch("/api/version", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("version request failed"))))
      .then((data: VersionResponse) => {
        if (!cancelled) setVersion(data.version || "unknown");
      })
      .catch(() => {
        if (!cancelled) setVersion("unknown");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return <div className="text-xs text-sidebar-foreground/50">MyPayLink v{version}</div>;
}
