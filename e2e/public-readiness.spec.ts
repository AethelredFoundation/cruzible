import { expect, test } from "@playwright/test";

const criticalRoutes = [
  { path: "/vault", heading: /AethelVault/i },
  { path: "/stablecoins", heading: /^Stablecoins$/i },
  {
    path: "/validators",
    heading: /Canonical validator context/i,
  },
  {
    path: "/models",
    heading: /Registry-backed model discovery/i,
  },
  { path: "/seals", heading: /Proof lineage/i },
  {
    path: "/reconciliation",
    heading: /Public trust posture/i,
  },
  {
    path: "/governance",
    heading: /Governance stays gated/i,
  },
  { path: "/jobs", heading: /Jobs Explorer/i },
  { path: "/jobs/e2e-smoke-job", heading: /Job Detail/i },
  {
    path: "/validators/aethvaloper1smoke",
    heading: /Validator detail/i,
  },
  {
    path: "/models/e2e-smoke-model",
    heading: /Model detail/i,
  },
  {
    path: "/seals/e2e-smoke-seal",
    heading: /Seal detail/i,
  },
];

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

for (const route of criticalRoutes) {
  test(`renders ${route.path} during upstream API outage`, async ({ page }) => {
    const response = await page.goto(route.path);

    expect(response?.ok()).toBe(true);
    await expect(
      page.getByRole("heading", { name: route.heading }),
    ).toBeVisible();
  });
}
