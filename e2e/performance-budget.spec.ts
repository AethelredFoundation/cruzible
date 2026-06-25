import { expect, test, type Page } from "@playwright/test";

type RouteBudget = {
  path: string;
  heading: RegExp;
  maxDomContentLoadedMs: number;
  maxLoadMs: number;
  maxFirstContentfulPaintMs: number;
  maxSameOriginTransferKiB: number;
  maxSameOriginResourceCount: number;
};

type JourneyMetrics = {
  domContentLoadedMs: number;
  loadMs: number;
  firstContentfulPaintMs: number | null;
  sameOriginTransferKiB: number;
  sameOriginResourceCount: number;
  largestSameOriginResource: {
    name: string;
    transferKiB: number;
  } | null;
};

const routeBudgets: RouteBudget[] = [
  {
    path: "/",
    heading: /protocol truth/i,
    maxDomContentLoadedMs: 4_000,
    maxLoadMs: 6_000,
    maxFirstContentfulPaintMs: 3_000,
    maxSameOriginTransferKiB: 3_250,
    maxSameOriginResourceCount: 85,
  },
  {
    path: "/vault",
    heading: /AethelVault/i,
    maxDomContentLoadedMs: 5_000,
    maxLoadMs: 7_000,
    maxFirstContentfulPaintMs: 3_500,
    maxSameOriginTransferKiB: 2_900,
    maxSameOriginResourceCount: 95,
  },
  {
    path: "/validators",
    heading: /Canonical validator context/i,
    maxDomContentLoadedMs: 5_000,
    maxLoadMs: 7_000,
    maxFirstContentfulPaintMs: 3_500,
    maxSameOriginTransferKiB: 3_250,
    maxSameOriginResourceCount: 95,
  },
  {
    path: "/stablecoins",
    heading: /Stablecoins/i,
    maxDomContentLoadedMs: 5_000,
    maxLoadMs: 7_000,
    maxFirstContentfulPaintMs: 3_500,
    maxSameOriginTransferKiB: 3_250,
    maxSameOriginResourceCount: 95,
  },
  {
    path: "/reconciliation",
    heading: /Public trust posture/i,
    maxDomContentLoadedMs: 5_000,
    maxLoadMs: 7_000,
    maxFirstContentfulPaintMs: 3_500,
    maxSameOriginTransferKiB: 3_400,
    maxSameOriginResourceCount: 95,
  },
];

test.beforeEach(async ({ page }) => {
  await page.route("https://api.testnet.aethelred.org/**", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "stubbed by performance budget test" }),
    });
  });
  await page.route(
    "https://evm-rpc-testnet.aethelred.network/**",
    async (route) => {
      let payload: unknown;

      try {
        payload = JSON.parse(route.request().postData() ?? "{}");
      } catch {
        payload = {};
      }

      const buildResponse = (request: { id?: unknown; method?: string }) => ({
        jsonrpc: "2.0",
        id: request.id ?? 1,
        result: request.method === "eth_chainId" ? "0x1ca4" : "0x1234",
      });
      const responsePayload = Array.isArray(payload)
        ? payload.map((request) =>
            buildResponse(request as { id?: unknown; method?: string }),
          )
        : buildResponse(payload as { id?: unknown; method?: string });

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(responsePayload),
      });
    },
  );
  await page.route("https://api.web3modal.org/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ allowed: true }),
    });
  });
});

async function collectRuntimeIssues(page: Page): Promise<string[]> {
  const issues: string[] = [];

  page.on("console", (message) => {
    const text = message.text();

    if (
      message.type() === "error" &&
      !text.includes("the server responded with a status of 503")
    ) {
      issues.push(`console error: ${text}`);
    }
  });
  page.on("pageerror", (error) => {
    issues.push(`page error: ${error.message}`);
  });

  return issues;
}

async function collectMetrics(page: Page): Promise<JourneyMetrics> {
  await page.waitForLoadState("networkidle", { timeout: 2_000 }).catch(() => {
    // Wallet providers may keep background connections open; route budgets below
    // still enforce the navigation and same-origin resource envelope.
  });

  return page.evaluate(() => {
    const bytesPerKib = 1024;
    const navigation = performance.getEntriesByType(
      "navigation",
    )[0] as PerformanceNavigationTiming;
    const paint = performance.getEntriesByName("first-contentful-paint")[0] as
      | PerformanceEntry
      | undefined;
    const resources = performance.getEntriesByType(
      "resource",
    ) as PerformanceResourceTiming[];
    const sameOriginResources = resources.filter((resource) => {
      try {
        return new URL(resource.name).origin === window.location.origin;
      } catch {
        return false;
      }
    });
    const transferKiB = (entry: PerformanceResourceTiming) =>
      Math.max(
        entry.transferSize,
        entry.encodedBodySize,
        entry.decodedBodySize,
        0,
      ) / bytesPerKib;
    const sameOriginTransferKiB = sameOriginResources.reduce(
      (total, resource) => total + transferKiB(resource),
      Math.max(
        navigation.transferSize,
        navigation.encodedBodySize,
        navigation.decodedBodySize,
        0,
      ) / bytesPerKib,
    );
    const largestSameOriginResource = sameOriginResources
      .map((resource) => ({
        name: resource.name.replace(window.location.origin, ""),
        transferKiB: transferKiB(resource),
      }))
      .sort((first, second) => second.transferKiB - first.transferKiB)[0];

    return {
      domContentLoadedMs:
        navigation.domContentLoadedEventEnd - navigation.startTime,
      loadMs: navigation.loadEventEnd - navigation.startTime,
      firstContentfulPaintMs: paint?.startTime ?? null,
      sameOriginTransferKiB,
      sameOriginResourceCount: sameOriginResources.length,
      largestSameOriginResource: largestSameOriginResource ?? null,
    };
  });
}

function expectWithinBudget(metrics: JourneyMetrics, budget: RouteBudget) {
  expect(
    metrics.domContentLoadedMs,
    `${budget.path} DOMContentLoaded budget`,
  ).toBeLessThanOrEqual(budget.maxDomContentLoadedMs);
  expect(metrics.loadMs, `${budget.path} load budget`).toBeLessThanOrEqual(
    budget.maxLoadMs,
  );

  if (metrics.firstContentfulPaintMs != null) {
    expect(
      metrics.firstContentfulPaintMs,
      `${budget.path} first contentful paint budget`,
    ).toBeLessThanOrEqual(budget.maxFirstContentfulPaintMs);
  }

  expect(
    metrics.sameOriginTransferKiB,
    `${budget.path} same-origin transfer budget; largest resource: ${JSON.stringify(metrics.largestSameOriginResource)}`,
  ).toBeLessThanOrEqual(budget.maxSameOriginTransferKiB);
  expect(
    metrics.sameOriginResourceCount,
    `${budget.path} same-origin resource-count budget`,
  ).toBeLessThanOrEqual(budget.maxSameOriginResourceCount);
}

for (const budget of routeBudgets) {
  test(`keeps ${budget.path} within synthetic journey budgets`, async ({
    page,
  }) => {
    const runtimeIssues = await collectRuntimeIssues(page);
    const response = await page.goto(budget.path, { waitUntil: "load" });

    expect(response?.ok()).toBe(true);
    await expect(
      page.getByRole("heading", { name: budget.heading }),
    ).toBeVisible();

    const metrics = await collectMetrics(page);
    expectWithinBudget(metrics, budget);
    expect(runtimeIssues, `${budget.path} runtime errors`).toEqual([]);
  });
}
