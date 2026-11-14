import { expect, test, type Page } from "@playwright/test";

const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);
const bodyBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const DARK_BG = "rgb(15, 18, 17)";
const LIGHT_BG = "rgb(246, 246, 243)";

/** The theme toggle in the visible app chrome (sidebar on desktop, top bar on phones). */
const toggle = (page: Page) => page.locator("button[aria-label^='Theme:']").filter({ visible: true }).first();

test("System is the default and is applied before first paint, without hydration errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  // Already dark when the HTML is parsed — before React hydrates.
  expect(await theme(page)).toBe("dark");
  await expect(page.getByRole("heading", { name: "Your benefits" })).toBeVisible();
  expect(await bodyBg(page)).toBe(DARK_BG);
  expect(errors.filter((e) => /hydrat|did not match/i.test(e))).toEqual([]);

  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => theme(page)).toBe("light");
  expect(await bodyBg(page)).toBe(LIGHT_BG);
});

test("the compact toggle switches at once, keeps typed text, and the choice survives a reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/vault");
  const search = page.getByRole("searchbox", { name: "Search by name, company or product" });
  await search.fill("laptop warranty");

  await toggle(page).click();
  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  expect(await theme(page)).toBe("dark");
  await expect(search).toHaveValue("laptop warranty");

  // An explicit choice ignores the OS.
  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  expect(await theme(page)).toBe("dark");
  expect(await page.evaluate(() => localStorage.getItem("claimly.theme"))).toBe("dark");
  await expect(toggle(page)).toHaveAttribute("aria-label", "Theme: Dark");

  // Back to System: follows the OS again.
  await toggle(page).click();
  await expect(page.getByRole("menuitemradio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitemradio", { name: "System" }).click();
  expect(await theme(page)).toBe("light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => theme(page)).toBe("dark");
});

test("Settings: all three modes, keyboard operable", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/settings");
  const group = page.getByRole("group", { name: "Theme" });
  const system = group.getByRole("radio", { name: "System" });
  await expect(system).toBeChecked();
  await group.getByRole("radio", { name: "Light" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(group.getByRole("radio", { name: "Dark" })).toBeChecked();
  expect(await theme(page)).toBe("dark");
  await page.reload();
  await expect(page.getByRole("group", { name: "Theme" }).getByRole("radio", { name: "Dark" })).toBeChecked();
});

test("dark theme: text, muted text and placeholders stay readable", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/vault");
  const ratio = await page.evaluate(() => {
    const rgb = (s: string) => s.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number);
    const lum = ([r, g, b]: number[]) => {
      const f = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const cr = (a: string, b: string) => { const x = lum(rgb(a)), y = lum(rgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const css = getComputedStyle(document.documentElement);
    const v = (n: string) => { const d = document.createElement("div"); d.style.color = css.getPropertyValue(n); document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; };
    return {
      ink: cr(v("--color-ink"), v("--color-canvas")),
      muted: cr(v("--color-muted"), v("--color-surface")),
      placeholder: cr(v("--color-placeholder"), v("--color-surface")),
      brandText: cr(v("--color-brand-700"), v("--color-surface")),
    };
  });
  expect(ratio.ink).toBeGreaterThanOrEqual(7);
  expect(ratio.muted).toBeGreaterThanOrEqual(4.5);
  expect(ratio.placeholder).toBeGreaterThanOrEqual(4.5);
  expect(ratio.brandText).toBeGreaterThanOrEqual(4.5);
});
