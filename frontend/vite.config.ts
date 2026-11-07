import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wails from "@wailsio/runtime/plugins/vite";

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WAILS_VITE_PORT) || 9245,
    strictPort: true,
  },
  // Explicit targets for the WebViews we ship in (WebView2, Android System
  // WebView, WKWebView on iOS 15+): CSS gets -webkit- prefixes and media
  // queries stay in the classic min/max syntax older engines understand.
  build: {
    target: ["chrome107", "edge107", "safari15"],
    cssTarget: ["chrome107", "edge107", "safari15"],
  },
  plugins: [react(), wails("./bindings")],
});
