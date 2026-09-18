import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:15173",
    channel: process.env.PLAYWRIGHT_CHANNEL || "chromium",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `${process.env.E2E_PYTHON || "python3"} tests/serve_backend.py`,
      url: "http://127.0.0.1:18081/openapi.json",
      timeout: 60_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    },
    {
      command: "npm run dev -- --host 127.0.0.1 --port 15173 --strictPort",
      url: "http://127.0.0.1:15173",
      env: {
        API_PROXY_TARGET: "http://127.0.0.1:18081",
        VITE_API_BASE_URL: "/api/v1",
      },
    },
  ],
});
