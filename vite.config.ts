import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
  },
  server: {
    proxy: {
      // Local dev: vite serves the frontend, wrangler serves Pages Functions.
      "/api": "http://localhost:8788",
    },
  },
});
