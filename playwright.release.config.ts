import { defineConfig } from "@playwright/test";

// Full isolated regression pass. This never reuses a developer or user's
// browser server, so demo state and local ledger data cannot leak into tests.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4215",
    channel: "chrome",
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "desktop-chrome", use: {} }],
  webServer: {
    command: "VITE_PUBLIC_DEMO=true VITE_PUBLIC_DEMO_AUTOLOAD=false node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4215 --strictPort",
    port: 4215,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
