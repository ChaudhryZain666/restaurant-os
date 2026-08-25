import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    // Phase 28 — mirrors apps/web/vite.config.ts's exact proxy: makes the new public/* API calls
    // same-origin in dev, same as apps/web and apps/admin already are.
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
