import { devices, expect, test } from "@playwright/test";

type MobileRoute = {
  path: string;
  heading: RegExp;
  readiness:
    | { kind: "action"; name: RegExp }
    | { kind: "status"; name: RegExp };
};

const mobileRoutes = [
  {
    path: "/vault",
    heading: /AethelVault/i,
    readiness: { kind: "action", name: /Stake AETHEL/i },
  },
  {
    path: "/validators",
    heading: /Canonical validator context/i,
    readiness: { kind: "action", name: /Open scorecard/i },
  },
  {
    path: "/stablecoins",
    heading: /^Stablecoins$/i,
    readiness: { kind: "status", name: /Stablecoins unavailable/i },
  },
] satisfies MobileRoute[];

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
    if (route.readiness.kind === "action") {
      await expect(
        page
          .getByRole("button", { name: route.readiness.name })
          .or(page.getByRole("link", { name: route.readiness.name }))
          .first(),
      ).toBeVisible();
    } else {
      await expect(
        page.getByRole("heading", {
          level: 2,
          name: route.readiness.name,
        }),
      ).toBeVisible();
    }

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
