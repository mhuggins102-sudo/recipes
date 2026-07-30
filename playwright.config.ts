import { defineConfig } from "@playwright/test";

// E2E flows with a stubbed /api/convert — no API key or wrangler needed.
// Run with `npm run e2e` (starts vite automatically).

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  use: {
    baseURL: "http://localhost:5173",
  },
  webServer: {
    command: "npx vite --port 5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: true,
  },
});
