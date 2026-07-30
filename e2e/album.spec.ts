import { expect, test, type Page } from "@playwright/test";

// Album → cookbook flows against a stubbed /api/convert (fixture NDJSON).

const recipeFixture = (title: string) => ({
  title,
  setup: ["Preheat oven to 350°F."],
  tree: {
    kind: "step",
    label: "bake 350°F 30 min",
    children: [
      { kind: "ingredient", quantity: "1 cup (200 g)", name: "sugar" },
      { kind: "ingredient", quantity: "2 large", name: "eggs" },
    ],
  },
  instructions: [
    "Cream the sugar and eggs together.",
    "Pour into the prepared pan.",
    "Bake 30 minutes, until set.",
  ],
});

const ndjson = (recipe: unknown) =>
  `${JSON.stringify({ type: "phase", phase: "model" })}\n${JSON.stringify({ type: "result", recipe })}\n`;

/** A decodable JPEG produced by the browser itself — no fixture files. */
async function jpegBuffer(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fdf6e3";
    ctx.fillRect(0, 0, 800, 600);
    ctx.fillStyle = "#333";
    ctx.font = "40px serif";
    ctx.fillText("Grandma's card", 40, 100);
    return canvas.toDataURL("image/jpeg", 0.9);
  });
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
}

function cardFiles(buffer: Buffer, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    name: `card-${i + 1}.jpg`,
    mimeType: "image/jpeg",
    buffer,
  }));
}

test("album: intake, convert, review-edit persists, cookbook PDF", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/convert", (route) => {
    calls++;
    void route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: ndjson(recipeFixture(`Card Recipe ${calls}`)),
    });
  });

  await page.goto("/");
  await page.click('button:has-text("Build a cookbook")');
  await expect(page).toHaveURL(/#album\//);

  const jpeg = await jpegBuffer(page);
  await page.setInputFiles('.album-intake input[type="file"]', cardFiles(jpeg, 3));
  await expect(page.locator(".album-card")).toHaveCount(3);
  await expect(page.locator(".album-progress")).toHaveText(/3 of 3 converted/, { timeout: 30_000 });

  // Review the first card: photo + table + instructions, edit a quantity.
  await page.locator(".album-card").first().click();
  await expect(page.locator(".review-pane table.recipe-table")).toBeVisible();
  await expect(page.locator(".review-pane .instructions li")).toHaveCount(3);
  const qty = page.locator(".review-pane td.ingredient .qty").first();
  await qty.evaluate((el) => {
    el.textContent = "9 cups";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(1200); // debounced IndexedDB persist

  // The edit survives a full reload (IndexedDB, not memory).
  await page.reload();
  await expect(page.locator(".album-card")).toHaveCount(3);
  await page.locator(".album-card").first().click();
  await expect(page.locator(".review-pane td.ingredient .qty").first()).toHaveText(/9 cups/);

  // Generation is gated until every included card has been reviewed.
  await expect(page.locator('button:has-text("Generate cookbook PDF")')).toBeDisabled();
  await expect(page.locator('button:has-text("Review next")')).toBeVisible();

  // Approve flow advances through unreviewed cards; three approvals clear the gate.
  for (let i = 0; i < 3; i++) {
    await page.click('button:has-text("Looks good")');
  }
  await expect(page.locator(".album-card .badge").first()).toHaveText(/reviewed/);
  await expect(page.locator('button:has-text("Generate cookbook PDF")')).toBeEnabled();

  // Build the book: title + TOC + 3 one-page recipes = /Count 5.
  await page.fill(".album-author", "Test Author");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click('button:has-text("Generate cookbook PDF")'),
  ]);
  const path = await download.path();
  const fs = await import("node:fs");
  const bytes = fs.readFileSync(path!);
  const text = bytes.toString("latin1");
  expect(text.startsWith("%PDF-1.4")).toBe(true);
  expect(text).toContain("/Count 5");
  expect(text).toContain("/MediaBox [0 0 576 720]");
  expect(text.endsWith("%%EOF\n")).toBe(true);
});

test("album: a rate-limited conversion pauses the queue until Resume", async ({ page }) => {
  let limited = true;
  let calls = 0;
  await page.route("**/api/convert", (route) => {
    calls++;
    if (calls > 1 && limited) {
      void route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ error: "Daily free conversion limit reached — please try again tomorrow." }),
      });
      return;
    }
    void route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: ndjson(recipeFixture(`Card Recipe ${calls}`)),
    });
  });

  await page.goto("/");
  await page.click('button:has-text("Build a cookbook")');
  await expect(page).toHaveURL(/#album\//);
  const jpeg = await jpegBuffer(page);
  await page.setInputFiles('.album-intake input[type="file"]', cardFiles(jpeg, 2));

  await expect(page.locator(".album-progress")).toHaveText(/paused: Daily free conversion limit/, {
    timeout: 30_000,
  });
  limited = false;
  await page.click('button:has-text("Resume")');
  await expect(page.locator(".album-progress")).toHaveText(/2 of 2 converted/, { timeout: 30_000 });
});

test("single conversion shows editable instructions below the table", async ({ page }) => {
  await page.route("**/api/convert", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: ndjson(recipeFixture("Pasted Pie")),
    }),
  );
  await page.goto("/");
  await page.click('.tabs button:has-text("Paste text")');
  await page.fill("textarea", "Sugar pie: cream sugar and eggs, bake.");
  await page.click('button:has-text("Engineer it")');
  await expect(page.locator(".instr-wrap .instructions li")).toHaveCount(3);
  await expect(page.locator(".instr-wrap .instructions li").first()).toHaveText(
    "Cream the sugar and eggs together.",
  );
});
