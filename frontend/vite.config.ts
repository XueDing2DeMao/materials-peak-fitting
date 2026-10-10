import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Keep this project on its own predictable local port instead of silently falling back.
  server: { port: 5175, strictPort: true },
  test: { environment: "jsdom", globals: true },
  // Plotly is intentionally bundled for fully local/offline interactive charts.
  build: { chunkSizeWarningLimit: 6_000 },
});
