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

createRoot(document.getElementById("root")!).render(<App />);
