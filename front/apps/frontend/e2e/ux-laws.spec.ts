import { expect, test, type Locator, type Page } from "@playwright/test";

async function uploadSample(page: Page) {
  await page.goto("/upload?sample=1");
  await expect(page.getByText("sample-dental.pdf")).toBeVisible();
  await page.getByRole("button", { name: "Upload and analyze" }).click();
  await expect(page.getByText("Analysis · done")).toBeVisible({ timeout: 20_000 });
}

/** Measure at rest: wait for finite animations (dialog entrance etc.) to finish. */
async function settle(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document.getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

async function expectTarget44(l: Locator) {
  await settle(l.page());
  const box = await l.boundingBox();
  expect(box, "target is rendered").not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
}

test("Fitts: small icon controls have 44 × 44 targets, glyphs keep their size", async ({ page }) => {
  await page.goto("/upload?sample=1");
  const remove = page.getByRole("button", { name: "Remove sample-dental.pdf" });
  await expectTarget44(remove);
  const glyph = await remove.locator("svg").boundingBox();
  expect(glyph!.width).toBeLessThanOrEqual(18);

  await uploadSample(page);
  await page.getByRole("link", { name: "Review results" }).click();
  await page.getByRole("link", { name: "Four dental cleaning services" }).click();
  await page.getByRole("button", { name: "Mark used" }).click();
  await expectTarget44(page.getByRole("dialog").getByRole("button", { name: "Close" }));
});

test("Fitts: compact buttons get a 44 px tall hit area without overlapping neighbours", async ({ page }) => {
  await uploadSample(page);
  await page.getByRole("link", { name: "Review results" }).click();
  const view = page.getByRole("button", { name: "View" }).first();
  await view.scrollIntoViewIfNeeded();
  await settle(page);
  const box = (await view.boundingBox())!;
  // Click 5 px above the visible 32 px button: still inside the 44 px target.
  await page.mouse.click(box.x + box.width / 2, box.y - 5);
  await expect(page.getByRole("dialog", { name: "Source" })).toBeVisible();
});

test("Hick + Jakob: document's secondary actions sit in a keyboard-friendly menu", async ({ page }) => {
  await uploadSample(page);
  await page.getByRole("link", { name: "Review results" }).click();
  await page.getByRole("link", { name: "Entry" }).click();
  const more = page.getByRole("button", { name: "More actions for sample-dental.pdf" });
  await expectTarget44(more);
  await more.focus();
  await page.keyboard.press("Enter");
  const item = page.getByRole("menuitem", { name: "Delete document" });
  await expect(item).toBeFocused();
  // Depth: the menu floats above the card.
  expect(await page.getByRole("menu").evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(more).toBeFocused();
});

test("Jakob: Enter in a dialog field confirms it; depth: dialogs sit on the top layer", async ({ page }) => {
  await uploadSample(page);
  await page.getByRole("link", { name: "Review results" }).click();
  await page.getByRole("link", { name: "Four dental cleaning services" }).click();
  await page.getByRole("button", { name: "Mark used" }).click();
  const dialog = page.getByRole("dialog");
  expect(await dialog.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none");
  await page.getByLabel("Total used so far").fill(" 1 ");
  await page.keyboard.press("Enter");
  await expect(dialog.getByLabel("Usage")).toContainText("Used1");
});

test("Postel: an ambiguous date is asked about, the typed text is kept", async ({ page }) => {
  await uploadSample(page);
  await page.getByRole("link", { name: "Review results" }).click();
  const row = page.locator("li").filter({ has: page.getByText("Valid through", { exact: true }) });
  await row.getByRole("button", { name: "Edit" }).click();
  const input = row.getByRole("textbox");
  await input.fill("01/05/2027");
  await expect(row.getByText("Which date do you mean?")).toBeVisible();
  await page.keyboard.press("Enter"); // ambiguous: not saved
  await expect(input).toHaveValue("01/05/2027");
  await row.getByRole("button", { name: "Jan 5, 2027" }).click();
  await expect(input).toHaveValue("Jan 5, 2027");
  await row.getByRole("button", { name: "Save" }).click();
  await expect(row.getByText("Jan 5, 2027")).toBeVisible();
  await expect(row.getByText("Edited by you")).toBeVisible();
});

test("Jakob: filters live in the URL, so Back returns to the same view", async ({ page }) => {
  await uploadSample(page);
  await page.goto("/benefits");
  await page.getByRole("button", { name: /To confirm/ }).click();
  await expect(page).toHaveURL(/filter=confirm/);
  await page.getByRole("link", { name: "Four dental cleaning services" }).click();
  await expect(page).toHaveURL(/\/benefits\/[0-9a-f-]{36}$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/benefits\?filter=confirm$/);
  await expect(page.getByRole("button", { name: /To confirm/ })).toHaveAttribute("aria-pressed", "true");
});

test("Frequency: navigation answers with colour only, no squash", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" }).locator("a").first();
  expect(await nav.getAttribute("data-squish")).toBeNull();
});
