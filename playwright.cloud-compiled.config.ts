import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-cloud",
  testMatch: "compiled-cloud.smoke.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  outputDir: "test-results/cloud-compiled",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:4220",
    serviceWorkers: "allow",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4220 --strictPort --outDir dist-cloud",
    url: "http://127.0.0.1:4220",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
