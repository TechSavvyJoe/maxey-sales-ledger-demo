import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-cloud",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  outputDir: "test-results/cloud",
  use: { baseURL: "http://127.0.0.1:4210", trace: "retain-on-failure" },
  projects: [
    { name: "cloud-chrome", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "cloud-phone", use: { ...devices["Pixel 7"] } },
    { name: "cloud-webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1100, height: 800 } } },
  ],
  webServer: {
    command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4210 --strictPort",
    env: {
      VITE_FIREBASE_ENABLED: "true", VITE_PUBLIC_DEMO: "false", VITE_FIREBASE_EMULATORS: "true",
      VITE_FIREBASE_API_KEY: "fake-cloud-test-key", VITE_FIREBASE_AUTH_DOMAIN: "demo-sales-ledger-rules.firebaseapp.com",
      VITE_FIREBASE_PROJECT_ID: "demo-sales-ledger-rules", VITE_FIREBASE_APP_ID: "1:123456789:web:emulatortest",
    },
    url: "http://127.0.0.1:4210",
    reuseExistingServer: false,
  },
});
