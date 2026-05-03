import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("https://api.testnet.aethelred.org/**", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "stubbed by production smoke test" }),
    });
  });
});

test("serves the frontend health endpoint without caching", async ({
  request,
}) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");

  const body = await response.json();
  expect(body).toMatchObject({
    service: "cruzible-frontend",
    status: "ok",
  });
});

test("renders the production public landing shell", async ({ page }) => {
  const response = await page.goto("/");

  expect(response?.ok()).toBe(true);
  await expect(page).toHaveTitle(/Cruzible/);
  await expect(
    page.getByRole("heading", { name: /protocol truth/i }),
  ).toBeVisible();
});

test("keeps developer tools hidden in production builds", async ({ page }) => {
  const devtoolsResponse = await page.goto("/devtools");
  expect(devtoolsResponse?.status()).toBe(404);

  await page.goto("/reconciliation");
  await expect(page.locator('a[href="/devtools"]')).toHaveCount(0);
});
