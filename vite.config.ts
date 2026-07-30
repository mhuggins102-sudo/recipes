import { defineConfig } from "vitest/config";

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
  test: {
    // e2e/ is Playwright's (npm run e2e), not vitest's.
    include: ["test/**/*.test.ts"],
  },
});
