import { expect, test, type Page } from "@playwright/test";

const accessibilityRoutes = [
  { path: "/", heading: /live staking telemetry/i },
  { path: "/vault", heading: /aethelvault/i },
  { path: "/governance", heading: /governance stays gated/i },
];

const vaultTabs = ["Stake", "Unstake", "Rewards", "Analytics"];

type AccessibilityIssue = {
  selector: string;
  message: string;
  html?: string;
};

test.beforeEach(async ({ page }) => {
  await page.route("https://api.testnet.aethelred.org/**", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: "stubbed by accessibility readiness test",
      }),
    });
  });
});

async function assertPageAccessibility(page: Page, label: string) {
  const issues = await page.evaluate(() => {
    const results: AccessibilityIssue[] = [];

    const normalize = (value?: string | null) =>
      value?.replace(/\s+/g, " ").trim() ?? "";

    const describe = (element: Element) => {
      const tag = element.tagName.toLowerCase();
      const id = element.id ? `#${element.id}` : "";
      const role = element.getAttribute("role");
      const roleSuffix = role ? `[role="${role}"]` : "";
      return `${tag}${id}${roleSuffix}`;
    };

    const snippet = (element: Element) =>
      element.outerHTML.replace(/\s+/g, " ").slice(0, 220);

    const addIssue = (selector: string, message: string, element?: Element) => {
      results.push({
        selector,
        message,
        html: element ? snippet(element) : undefined,
      });
    };

    const isHiddenByAttribute = (element: Element) =>
      element.getAttribute("aria-hidden") === "true" ||
      element.closest('[aria-hidden="true"]') != null;

    const isVisible = (element: Element) => {
      if (!(element instanceof HTMLElement) || isHiddenByAttribute(element)) {
        return false;
      }

      if (element.hidden) {
        return false;
      }

      const style = window.getComputedStyle(element);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0"
      ) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const labelledByText = (element: Element) => {
      const ids = normalize(element.getAttribute("aria-labelledby"));
      if (!ids) return "";

      return ids
        .split(/\s+/)
        .map((id) => normalize(document.getElementById(id)?.textContent))
        .filter(Boolean)
        .join(" ");
    };

    const associatedLabelText = (element: Element) => {
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement
      ) {
        return Array.from(element.labels ?? [])
          .map((labelElement) => normalize(labelElement.textContent))
          .filter(Boolean)
          .join(" ");
      }

      return "";
    };

    const accessibleName = (element: Element) => {
      const ariaLabel = normalize(element.getAttribute("aria-label"));
      if (ariaLabel) return ariaLabel;

      const labelledBy = labelledByText(element);
      if (labelledBy) return labelledBy;

      const labels = associatedLabelText(element);
      if (labels) return labels;

      const title = normalize(element.getAttribute("title"));
      if (title) return title;

      if (element instanceof HTMLInputElement) {
        const type = element.type.toLowerCase();
        if (["button", "submit", "reset"].includes(type)) {
          return normalize(element.value);
        }
      }

      return normalize(element.textContent);
    };

    const hasProgrammaticFieldLabel = (element: Element) => {
      return Boolean(
        normalize(element.getAttribute("aria-label")) ||
        labelledByText(element) ||
        associatedLabelText(element),
      );
    };

    const mainElements = Array.from(document.querySelectorAll("main"));
    if (mainElements.length !== 1) {
      addIssue(
        "main",
        `Expected exactly one main landmark, found ${mainElements.length}.`,
      );
    }

    if (!document.querySelector("main#main-content")) {
      addIssue(
        "main#main-content",
        "Skip-link target must be the primary main landmark.",
      );
    }

    if (!document.querySelector('a[href="#main-content"]')) {
      addIssue('a[href="#main-content"]', "Global skip link is missing.");
    }

    const visibleH1Count = Array.from(document.querySelectorAll("h1")).filter(
      isVisible,
    ).length;
    if (visibleH1Count !== 1) {
      addIssue(
        "h1",
        `Expected exactly one visible h1, found ${visibleH1Count}.`,
      );
    }

    if (!normalize(document.title) || /undefined|null/i.test(document.title)) {
      addIssue("title", "Document title must be present and concrete.");
    }

    const metaDescription = document.querySelector('meta[name="description"]');
    if (!normalize(metaDescription?.getAttribute("content"))) {
      addIssue(
        'meta[name="description"]',
        "Launch-facing pages must expose a concrete meta description.",
      );
    }

    if (!document.querySelector("nav[aria-label]")) {
      addIssue(
        "nav[aria-label]",
        "Navigation landmarks need accessible labels.",
      );
    }

    if (!document.querySelector("footer[aria-label]")) {
      addIssue(
        "footer[aria-label]",
        "Footer landmark needs an accessible label.",
      );
    }

    const idCounts = new Map<string, number>();
    document.querySelectorAll("[id]").forEach((element) => {
      idCounts.set(element.id, (idCounts.get(element.id) ?? 0) + 1);
    });
    for (const [id, count] of idCounts.entries()) {
      if (count > 1) {
        addIssue(`#${id}`, `Duplicate id "${id}" appears ${count} times.`);
      }
    }

    document
      .querySelectorAll(
        'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"]',
      )
      .forEach((element) => {
        if (!isVisible(element)) return;

        if (!accessibleName(element)) {
          addIssue(
            describe(element),
            "Visible interactive controls must expose an accessible name.",
            element,
          );
        }
      });

    document
      .querySelectorAll(
        'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]), select, textarea',
      )
      .forEach((element) => {
        if (!isVisible(element)) return;

        if (!hasProgrammaticFieldLabel(element)) {
          addIssue(
            describe(element),
            "Visible form fields must be associated with a label or aria label.",
            element,
          );
        }
      });

    document.querySelectorAll("img").forEach((element) => {
      if (!isVisible(element)) return;

      if (!element.hasAttribute("alt")) {
        addIssue(
          describe(element),
          "Images must include alt text, using an empty alt only for decorative images.",
          element,
        );
      }
    });

    return results;
  });

  expect(issues, `${label} accessibility issues`).toEqual([]);

  const skipLink = page.locator('a[href="#main-content"]');
  await skipLink.focus();
  await expect(skipLink, `${label} skip link`).toBeVisible();
}

for (const route of accessibilityRoutes) {
  test(`keeps ${route.path} accessibility-ready during upstream outage`, async ({
    page,
  }) => {
    const response = await page.goto(route.path);

    expect(response?.ok()).toBe(true);
    await expect(
      page.getByRole("heading", { level: 1, name: route.heading }),
    ).toBeVisible();
    await assertPageAccessibility(page, route.path);

    if (route.path === "/vault") {
      const vaultNavigation = page.getByRole("navigation", {
        name: "Vault sections",
      });

      for (const tab of vaultTabs) {
        await vaultNavigation
          .getByRole("button", { exact: true, name: tab })
          .click();
        await assertPageAccessibility(page, `/vault ${tab}`);
      }
    }
  });
}
