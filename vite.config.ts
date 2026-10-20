import { execSync } from "node:child_process";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

// The local API (server/dev.ts) runs on 3001; Vercel serves it under /api in production.
const apiProxy = { "/api": "http://localhost:3001" };

/** The commit this build came from, shown in the app so you can tell whether an installed copy has updated. */
function buildCommit(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  try {
    return execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "local";
  }
}

export default defineConfig(({ command }) => ({
  // The dev server reads these once when it starts, so it shows "local" instead of a stale commit.
  define: {
    __APP_VERSION__: JSON.stringify(command === "serve" ? "local" : buildCommit()),
    __APP_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      // Registered from src/main.tsx so updates apply on the next open.
      injectRegister: false,
      includeAssets: ["apple-touch-icon.png"],
      manifest: {
        name: "Caliche Balance",
        short_name: "Balance",
        description: "Tu báscula comparada con rangos de referencia de Norteamérica.",
        lang: "es",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#0b0f0d",
        theme_color: "#0b0f0d",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // The whole app (screens, styles, the History chart chunk, badge images) works offline. The
        // plugin adds the manifest and its icons itself; matching every PNG here would add them twice.
        globPatterns: ["**/*.{js,css,html,svg}", "badges/*.png"],
        navigateFallback: "/index.html",
        // API responses are never cached by the service worker: they carry personal data and
        // the app persists only what it needs (see src/offline.ts).
        // The Apple Health Shortcut is a file to download, not a screen of the app.
        navigateFallbackDenylist: [/^\/api\//, /\.shortcut$/],
        cleanupOutdatedCaches: true,
        // Shows push notifications and opens the app when one is tapped.
        importScripts: ["/push-sw.js"],
      },
    }),
  ],
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
  test: {
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
}));
