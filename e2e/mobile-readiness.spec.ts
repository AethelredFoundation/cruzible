import { devices, expect, test } from "@playwright/test";

const mobileRoutes = [
  {
    path: "/vault",
    heading: /AethelVault/i,
    primaryAction: /Stake AETHEL/i,
  },
  {
    path: "/validators",
    heading: /Canonical validator context/i,
    primaryAction: /Open scorecard/i,
  },
  {
    path: "/stablecoins",
    heading: /Stablecoins/i,
    primaryAction: /Bridge USDC|Bridge USDT|Verifying Bridge Config/i,
  },
];

test.use({ ...devices["Pixel 5"] });

test.beforeEach(async ({ page }) => {
  await page.route("https://api.testnet.aethelred.org/**", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "stubbed by mobile readiness test" }),
    });
  });
});

for (const route of mobileRoutes) {
  test(`keeps ${route.path} mobile-ready during upstream API outage`, async ({
    page,
  }) => {
    const response = await page.goto(route.path);

    expect(response?.ok()).toBe(true);
    await expect(
      page.getByRole("heading", { name: route.heading }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("button", { name: route.primaryAction })
        .or(page.getByRole("link", { name: route.primaryAction }))
        .first(),
    ).toBeVisible();

    const layout = await page.evaluate(() => ({
      bodyWidth: document.body.scrollWidth,
      htmlWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));

    expect(
      Math.max(layout.bodyWidth, layout.htmlWidth),
      `${route.path} should not create horizontal mobile overflow`,
    ).toBeLessThanOrEqual(layout.viewportWidth + 1);
  });
}
