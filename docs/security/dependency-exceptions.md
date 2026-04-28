# Dependency Security Exceptions

> Last reviewed on 2026-04-24.
> This register tracks dependency advisories that remain after local remediation
> and require either upstream fixes or an intentional product decision.

## Active Exceptions

| Package | Severity | Advisory | Current version | Status | Reason |
| --- | --- | --- | --- | --- | --- |
| `next` -> `postcss` | Moderate | `GHSA-qx2v-qp2m-jg93` | `next@15.5.15` bundles `postcss@8.4.31` | Accepted temporarily | As of 2026-04-24, `next@latest`, `next@beta`, and `next@canary` still publish the same bundled `postcss` version, so there is no safe upstream release to consume yet. |

## Mitigations In Place

- The application now uses `postcss@8.5.10` everywhere outside the framework-bundled `next/node_modules/postcss` path.
- Unused telemetry packages were removed so the production audit surface is limited to the framework itself instead of framework-adjacent packages.
- Frontend wallet dependencies were upgraded to current safe versions, clearing the prior `wagmi`, `@wagmi/connectors`, `axios`, and Coinbase SDK audit path.
- CI and local validation continue to run `npm audit --omit=dev` so this exception remains visible until upstream resolves it.

## Exit Criteria

- Upgrade to the first published Next.js release that no longer vendors `postcss < 8.5.10`.
- Remove this exception from the register once `npm audit --omit=dev` reports zero production vulnerabilities at the repository root.
