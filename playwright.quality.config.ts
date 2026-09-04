import { defineConfig, devices } from "@playwright/test";

// Isolated from the user's open local ledger and from the private cloud site.
export default defineConfig({
  testDir: "./e2e", testMatch: "settings-autosave.spec.ts", fullyParallel: false, workers: 1, timeout: 90000,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:4214", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "quality-laptop", use: { browserName: "chromium", viewport: { width: 1280, height: 800 } } },
    { name: "quality-phone", use: { ...devices["Pixel 7"], browserName: "chromium" } },
    { name: "quality-webkit", use: { browserName: "webkit", viewport: { width: 1024, height: 768 } } },
  ],
  webServer: {
    command: "VITE_PUBLIC_DEMO=false node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4214 --strictPort",
    port: 4214, reuseExistingServer: false, timeout: 120000,
  },
});
