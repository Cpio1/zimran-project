import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";
// Temporary cross-browser run (WebKit has no clipboard permissions, so none are requested there).
export default defineConfig({
  ...base,
  use: { ...base.use, permissions: [] },
  projects: [
    { name: "chrome", use: { ...devices["Desktop Chrome"], permissions: ["clipboard-read", "clipboard-write"] } },
    { name: "safari", use: { ...devices["Desktop Safari"] } },
    { name: "iphone", use: { ...devices["iPhone 13"] } },
    { name: "android", use: { ...devices["Pixel 7"], permissions: ["clipboard-read", "clipboard-write"] } },
  ],
});
