import { expect, test, type Page } from "@playwright/test";

async function noHorizontalScroll(page: Page) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(sw, `horizontal overflow on ${page.url()}`).toBeLessThanOrEqual(iw);
}

async function uploadSample(page: Page) {
  await page.goto("/upload?sample=1");
  await expect(page.getByText("sample-dental.pdf")).toBeVisible();
  await page.getByRole("button", { name: "Upload and analyze" }).click();
  await expect(page.getByText("Analysis · done")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("link", { name: "Review results" }).click();
  await expect(page.getByText("Found 1 benefit")).toBeVisible();
}

test("opens without login, auto demo session, data survives refresh", async ({ page }) => {
  const sessionPosts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/v1/demo/sessions")) sessionPosts.push(r.url());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your benefits" })).toBeVisible();
  await expect(page.getByText(/sign in|log in|password|register/i)).toHaveCount(0);
  await expect(page.getByText("Sample mode").first()).toBeVisible();
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem("claimly.demo_session") ?? "null")?.session_token);
  expect(token).toBeTruthy();
  expect(sessionPosts).toHaveLength(1);

  await uploadSample(page);
  await page.reload();
  await expect(page.getByText("Found 1 benefit")).toBeVisible();
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem("claimly.demo_session") ?? "null")?.session_token);
  expect(after).toBe(token);
  expect(sessionPosts).toHaveLength(1);
});

test("upload → review → certificate 4/1/3 → chat → matching → case → draft → copy → sent → reply → follow-up", async ({ page }) => {
  await uploadSample(page);
  // Source opens via backend content (blob URL, no token in URL).
  await page.getByRole("button", { name: /This certificate includes four/ }).first().click();
  const frame = page.locator("iframe[title*='page 1']");
  await expect(frame).toBeVisible();
  expect(await frame.getAttribute("src")).toMatch(/^blob:.*#page=1$/);
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("link", { name: "Four dental cleaning services" }).click();
  await expect(page.getByText("Usage not confirmed")).toBeVisible();
  await page.getByRole("button", { name: "Mark used" }).click();
  await page.getByLabel("Total used so far").fill("1");
  await page.getByRole("button", { name: "Save usage" }).click();
  const usage = page.getByRole("dialog").getByLabel("Usage");
  await expect(usage).toContainText("Total4");
  await expect(usage).toContainText("Used1");
  await expect(usage).toContainText("Remaining3");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByLabel("Usage")).toContainText("Remaining3");
  await page.goto("/benefits");
  await expect(page.getByText("3 of 4 left").first()).toBeVisible();
  await page.getByRole("link", { name: "Four dental cleaning services" }).click();

  // Ask Claimly opens the entry thread
  await page.getByRole("button", { name: "Ask Claimly" }).click();
  await expect(page).toHaveURL(/\/assistant\?thread=/);
  await expect(page.getByText(/Asking only about/)).toBeVisible();
  await page.getByLabel("Message to Claimly").fill("Can I book a cleaning?");
  await page.getByLabel("Message to Claimly").press("Enter");
  await expect(page.getByText("Can I book a cleaning?")).toBeVisible();
  await expect(page.getByText(/Here's what your documents say/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: /This certificate includes four/ })).toBeVisible();
  await expect(page.getByText("Can I book a cleaning?")).toHaveCount(1);

  // Matching in the general thread
  await page.getByLabel("Conversation").selectOption({ label: "All documents" }).catch(() => page.getByRole("button", { name: "All documents" }).click());
  await page.getByRole("button", { name: "All documents" }).click();
  await page.getByRole("radio", { name: "Find a benefit for a need" }).click();
  await page.getByLabel("Message to Claimly").fill("I need my teeth cleaned");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/may cover this need/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("list", { name: "Matching benefits" }).getByRole("link", { name: /Four dental cleaning/ })).toBeVisible();

  // Plan to use → case
  await page.goto("/benefits");
  await page.getByRole("link", { name: "Four dental cleaning services" }).click();
  await page.getByRole("button", { name: "Plan to use" }).click();
  await page.getByRole("button", { name: "Create plan" }).click();
  await expect(page).toHaveURL(/\/cases\//);
  await expect(page.getByText("3 of 4 left")).toHaveCount(0); // nothing deducted by planning
  await page.getByRole("button", { name: "Prepare request" }).click();
  await expect(page.getByLabel("Subject")).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Message", { exact: true }).fill("Hello, I'd like to book one of my remaining cleanings.");
  await page.getByRole("button", { name: "Save edits" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  await page.getByRole("button", { name: "Copy" }).click();
  await expect(page.getByText("Copying doesn't mark it as sent")).toBeVisible();
  await expect(page.locator("header").getByText("Prepared")).toBeVisible();
  await page.getByRole("button", { name: "I sent it" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.locator("header").getByText("Sent", { exact: true })).toBeVisible();

  // Company reply → analysis event
  await page.getByLabel("Paste the reply").fill("We need more information about your certificate before booking.");
  await page.getByRole("button", { name: "Analyze reply" }).click();
  await expect(page.getByText("The company asks for more information")).toBeVisible({ timeout: 20_000 });

  // Follow-up
  await page.getByRole("button", { name: "Prepare follow-up" }).click();
  await expect(page.locator("input[value^='Follow-up:']")).toBeVisible({ timeout: 20_000 });

  // Case chat is separate and persistent
  await page.getByLabel("Message to Claimly").last().fill("What's left on this certificate?");
  await page.getByLabel("Message to Claimly").last().press("Enter");
  await expect(page.getByText(/3 of 4 remaining/)).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await expect(page.getByText("What's left on this certificate?")).toBeVisible();

  // Calendar shows the document date to confirm
  await page.goto("/calendar");
  await page.getByRole("tab", { name: "Next 30 days" }).click();
  await expect(page.getByText(/Nothing between|Four dental cleaning services/).first()).toBeVisible();
});

test("calendar: edit reminder intervals", async ({ page }) => {
  await uploadSample(page);
  await page.getByRole("link", { name: "Four dental cleaning services" }).click();
  await page.getByRole("button", { name: "Add" }).click();
  const dlg = page.getByRole("dialog");
  const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  await dlg.getByLabel("Date").fill(soon);
  await dlg.getByRole("button", { name: "30 days before" }).click();
  await dlg.getByRole("button", { name: "Save" }).click();
  await page.goto("/calendar");
  await expect(page.getByText("30 days before, 7 days before, 1 day before, On the day")).toBeVisible();
  await page.getByRole("button", { name: "Edit" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "30 days before" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("7 days before, 1 day before, On the day")).toBeVisible();
  await expect(page.getByText("Email delivery isn't set up")).toHaveCount(0);
});

test("errors: 503 AI not configured, 401 expired session without login, 409 conflict", async ({ page, context }) => {
  await page.goto("/settings");
  await page.getByLabel("Simulate “AI not configured” (503)").check();
  await page.goto("/assistant");
  await page.getByLabel("Message to Claimly").fill("hello");
  await page.getByLabel("Message to Claimly").press("Enter");
  await expect(page.getByText(/AI analysis isn't configured on this server/)).toBeVisible();
  await page.goto("/settings");
  await page.getByLabel("Simulate “AI not configured” (503)").uncheck();

  // 409: edit the same entry in two tabs
  await uploadSample(page);
  const url = page.url().replace("/review/", "/vault/");
  await page.goto(url);
  const other = await context.newPage();
  await other.goto(url);
  await other.getByRole("button", { name: "Edit" }).click();
  await other.getByLabel("Name").fill("Changed elsewhere");
  await other.getByRole("button", { name: "Save" }).click();
  await expect(other.getByRole("heading", { name: "Changed elsewhere" })).toBeVisible();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name").fill("My change");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/changed elsewhere. Reload the latest version/)).toBeVisible();
  await page.getByRole("button", { name: "Load latest" }).click();
  await expect(page.getByLabel("Name")).toHaveValue("Changed elsewhere");
  await other.close();

  // 401: session expires → new empty space, no login prompt
  await page.goto("/settings");
  await page.getByRole("button", { name: /Expire session/ }).click();
  await page.goto("/vault");
  await expect(page.getByText("Your previous demo session ended")).toBeVisible();
  await expect(page.getByText("Your vault is empty")).toBeVisible();
  await expect(page.getByText(/sign in|log in|password/i)).toHaveCount(0);
});

test("unknown usage is not shown as zero; failed analysis is honest", async ({ page }) => {
  await uploadSample(page);
  await page.goto("/benefits");
  await expect(page.getByText("4 listed · usage not confirmed")).toBeVisible();
  await expect(page.getByText(/0 of 4|4 of 4 left/)).toHaveCount(0);
  // unreadable file → failed job with retry
  await page.goto("/upload");
  await page.getByTestId("file-input").setInputFiles({ name: "unreadable-scan.png", mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71, 1, 2, 3]) });
  await page.getByLabel("Type").selectOption("warranty");
  await page.getByRole("button", { name: "Upload and analyze" }).click();
  await expect(page.getByText(/Analysis failed. We couldn't read this document/)).toBeVisible({ timeout: 20_000 });
});

for (const vp of [{ w: 375, h: 812 }, { w: 768, h: 1024 }, { w: 1440, h: 900 }]) {
  test(`layout ${vp.w}px: no horizontal scroll, nav reachable`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await uploadSample(page);
    const entryUrl = page.url().replace("/review/", "/vault/");
    await page.goto("/");
    await expect(page.getByText("Next actions")).toBeVisible();
    await page.screenshot({ path: `test-results/screens/home-${vp.w}.png`, fullPage: true });
    for (const path of ["/", "/vault", entryUrl, "/benefits", "/assistant", "/cases", "/calendar", "/settings", "/upload"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await noHorizontalScroll(page);
    }
    await page.goto("/benefits");
    await page.getByRole("link", { name: "Four dental cleaning services" }).click();
    await noHorizontalScroll(page);
    await page.getByRole("button", { name: "Plan to use" }).click();
    await page.getByRole("button", { name: "Create plan" }).click();
    await expect(page).toHaveURL(/\/cases\//);
    await noHorizontalScroll(page);
    const nav = page.getByRole("navigation", { name: "Main" }).filter({ visible: true });
    await expect(nav.getByRole("link", { name: "Cases" })).toBeVisible();
    // bottom nav must not cover the primary action on mobile
    if (vp.w < 768) {
      const btn = await page.getByRole("button", { name: "Prepare request" }).boundingBox();
      await page.getByRole("button", { name: "Prepare request" }).scrollIntoViewIfNeeded();
      const navBox = await nav.boundingBox();
      const b2 = await page.getByRole("button", { name: "Prepare request" }).boundingBox();
      expect(btn && navBox && b2 && b2.y + b2.height <= navBox.y).toBeTruthy();
    }
    await page.screenshot({ path: `test-results/screens/case-${vp.w}.png`, fullPage: false });
  });
}

test("keyboard: skip link and dialog focus/escape", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your benefits" })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await uploadSample(page);
  await page.getByRole("link", { name: "Four dental cleaning services" }).click();
  await page.getByRole("button", { name: "Mark used" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Total used so far")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
