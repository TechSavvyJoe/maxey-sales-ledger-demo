import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: "http://127.0.0.1:4192",
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop-chrome",
      // Primary everyday target: a laptop or a 20/22-inch display at common scaling.
      use: { viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"], channel: "chrome" },
    },
    {
      name: "tablet-chrome",
      use: { viewport: { width: 800, height: 1000 } },
    },
  ],
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 4192",
    port: 4192,
    // Reuse a developer's local app when present, while CI always verifies a fresh server.
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
