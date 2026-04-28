export type SearchResultKind = "navigation" | "validator";

export interface SearchableValidator {
  address: string;
  moniker: string;
  identity?: string;
}

export interface SearchResultItem {
  label: string;
  href: string;
  description: string;
}

export interface SearchResultGroup {
  category: string;
  kind: SearchResultKind;
  items: SearchResultItem[];
}

export const SEARCH_NAVIGATION_TARGETS: SearchResultItem[] = [
  {
    label: "Vault",
    href: "/vault",
    description: "Stake, unstake, and review live exchange-rate safeguards",
  },
  {
    label: "Validators",
    href: "/validators",
    description: "Inspect validator set risk, concentration, and liveness",
  },
  {
    label: "AI Jobs",
    href: "/jobs",
    description: "Track useful-work jobs and verification state",
  },
  {
    label: "Model Registry",
    href: "/models",
    description: "Review registered AI models and usage evidence",
  },
  {
    label: "TEE Seals",
    href: "/seals",
    description: "Inspect attestation seals and verification metadata",
  },
  {
    label: "Stablecoin Bridge",
    href: "/stablecoins",
    description: "Review bridge configuration and reserve controls",
  },
  {
    label: "Reconciliation",
    href: "/reconciliation",
    description: "Monitor protocol reconciliation evidence",
  },
  {
    label: "Governance Readiness",
    href: "/governance",
    description: "View gated governance launch requirements",
  },
];

const SEARCHABLE_NAVIGATION = SEARCH_NAVIGATION_TARGETS.map((target) => ({
  target,
  haystack: [target.label, target.href, target.description]
    .join(" ")
    .toLowerCase(),
}));

export function buildSearchResults(
  query: string,
  validators: SearchableValidator[],
): SearchResultGroup[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  const results: SearchResultGroup[] = [];
  const navigationItems = SEARCHABLE_NAVIGATION.filter(({ haystack }) =>
    haystack.includes(normalizedQuery),
  )
    .slice(0, 5)
    .map(({ target }) => target);

  if (navigationItems.length > 0) {
    results.push({
      category: "Navigation",
      kind: "navigation",
      items: navigationItems,
    });
  }

  const validatorItems = validators
    .filter((validator) =>
      [validator.moniker, validator.address, validator.identity]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery),
    )
    .slice(0, 5)
    .map((validator) => ({
      label: validator.moniker || validator.address,
      href: `/validators/${encodeURIComponent(validator.address)}`,
      description: validator.identity
        ? `${validator.address} - ${validator.identity}`
        : validator.address,
    }));

  if (validatorItems.length > 0) {
    results.push({
      category: "Live Validators",
      kind: "validator",
      items: validatorItems,
    });
  }

  return results;
}
