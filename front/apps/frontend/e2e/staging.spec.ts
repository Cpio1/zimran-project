import { expect, test, type Page } from "@playwright/test";

/** Staging: in the page content (dialogs aside) exactly one control carries the main style. */
const primaries = (page: Page) => page.locator('main [data-variant="primary"]');

async function uploadSample(page: Page) {
  await page.goto("/upload?sample=1");
  await expect(page.getByText("sample-dental.pdf")).toBeVisible();
  await page.getByRole("button", { name: "Upload and analyze" }).click();
  await expect(page.getByText("Analysis · done")).toBeVisible({ timeout: 20_000 });
}

test("home: Upload document is the one main action", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Start with one document" })).toBeVisible();
  await expect(primaries(page)).toHaveCount(1);
  await expect(primaries(page)).toHaveText("Upload document");
});

test("upload: the main action follows the real step", async ({ page }) => {
  await page.goto("/upload");
  const step = page.getByRole("list", { name: "Upload steps" }).locator('[aria-current="step"]');
  await expect(step).toHaveText(/Choose files/);
  await expect(primaries(page)).toHaveText("Choose files");

  await page.goto("/upload?sample=1");
  await expect(page.getByText("sample-dental.pdf")).toBeVisible();
  await expect(primaries(page)).toHaveCount(1);
  await expect(primaries(page)).toHaveText("Upload and analyze");

  await page.getByRole("button", { name: "Upload and analyze" }).click();
  await expect(page.getByText("Analysis · done")).toBeVisible({ timeout: 20_000 });
  await expect(step).toHaveText(/Check the results/);
  await expect(primaries(page)).toHaveCount(1);
  await expect(primaries(page)).toHaveText("Review results");
});

test("review: benefit, date and limit first; conditions and sources on request", async ({ page }) => {
  await uploadSample(page);
  await page.getByRole("link", { name: "Review results" }).click();
  await expect(page.getByText("Found 1 benefit")).toBeVisible();
  const card = page.getByRole("article").first();
  await expect(card.getByRole("heading", { name: "Four dental cleaning services" })).toBeVisible();
  await expect(card.getByText("Date", { exact: true })).toBeVisible();
  await expect(card.getByText("Limit", { exact: true })).toBeVisible();
  const source = card.getByRole("button", { name: /This certificate includes four/ });
  await expect(source).toBeHidden();
  await card.getByText(/Conditions and sources/).click();
  await expect(source).toBeVisible();
  expect(await primaries(page).count()).toBeLessThanOrEqual(1);
});

test("dialog: focus moves in on open and returns to the opener on close", async ({ page }) => {
  await uploadSample(page);
  await page.getByRole("link", { name: "Review results" }).click();
  await page.getByRole("link", { name: "Four dental cleaning services" }).click();
  const opener = page.getByRole("button", { name: "Mark used" });
  // Keyboard path (Safari doesn't focus buttons on mouse click, so there is nothing to return to there).
  await opener.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Total used so far")).toBeFocused();
  const footer = page.getByRole("dialog").locator('[data-variant="primary"]');
  await expect(footer).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("case: the section with the next action is the one in focus", async ({ page }) => {
  await uploadSample(page);
  await page.getByRole("link", { name: "Review results" }).click();
  await page.getByRole("link", { name: "Four dental cleaning services" }).click();
  await page.getByRole("button", { name: "Plan to use" }).click();
  await page.getByRole("button", { name: "Create plan" }).click();
  await expect(page.getByRole("heading", { name: "Assessment" })).toBeVisible();
  // New case without an assessment: checking the documents is the next step.
  const focused = page.locator('main [data-tone="focus"]');
  await expect(focused).toHaveCount(1);
  await expect(focused.getByRole("heading", { name: "Assessment" })).toBeVisible();
  await expect(primaries(page)).toHaveCount(1);
  await expect(primaries(page)).toHaveText("Check");
});

test("motion: pose-to-pose sequences, and reduced motion swaps them for a short fade", async ({ page }) => {
  await uploadSample(page);
  const anim = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).animationName);
  expect(await anim(".squish-pop")).toBe("squish-pop");

  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await anim(".squish-pop")).toBe("motion-fade");
  // Press poses switch off: a held primary button keeps its shape.
  const btn = primaries(page).first();
  await btn.evaluate((el) => el.setAttribute("data-pressed", ""));
  const t = await btn.locator(".squish-surface").evaluate((el) => getComputedStyle(el).transform);
  expect(t === "none" || t === "matrix(1, 0, 0, 1, 0, 0)").toBeTruthy();
});
