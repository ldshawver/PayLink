import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const appShellRoute = new URLSearchParams(window.location.search).get("route");
if (window.location.pathname === "/app.html" && appShellRoute?.startsWith("/")) {
  window.history.replaceState(null, "", appShellRoute);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .then(() => caches.keys())
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .catch((error) => {
        console.warn("Service worker cleanup failed:", error);
      });
  });
}

// Vite emits this event when a dynamic import (lazy page chunk) fails to load —
// typically because a new deployment changed the content-hash filenames.
// We force a hard reload so the browser fetches the fresh manifest + chunks.
// A sessionStorage flag prevents infinite reload loops (10-second cooldown).
window.addEventListener("vite:preloadError", () => {
  const RELOAD_KEY = "paylink_chunk_reload_at";
  const last = Number(sessionStorage.getItem(RELOAD_KEY) || "0");
  if (Date.now() - last > 10_000) {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    window.location.reload();
  }
});

createRoot(document.getElementById("root")!).render(<App />);
