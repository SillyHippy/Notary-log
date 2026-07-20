import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // Bump ?v= when SW logic changes so browsers bypass CDN/browser cache of /sw.js
    const base = `${import.meta.env.BASE_URL}sw.js`.replace(/\/{2,}/g, "/");
    const swUrl = `${base}?v=11`;
    navigator.serviceWorker.register(swUrl).catch(() => {
      /* non-fatal */
    });
  });
}
