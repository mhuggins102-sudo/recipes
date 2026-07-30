import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    // Stamped into generated PDFs' Producer metadata (see src/buildId.ts).
    __BUILD_ID__: JSON.stringify(process.env.CF_PAGES_COMMIT_SHA?.slice(0, 7) ?? "dev"),
  },
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
