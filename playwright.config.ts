import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
// Optional: use a pre-installed Chromium instead of Playwright's download (e.g. in sandboxed environments).
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  // Generous: the first request to each route compiles it when running against `next dev`.
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure", launchOptions: { executablePath } },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /portal\.spec/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /portal\.spec/ },
  ],
  webServer: {
    // Dev server: E2E runs sign in many times from one IP, so auth rate limiting is switched off,
    // which the app only permits outside production.
    command: "npm run dev",
    url: `${baseURL}/sign-in`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
