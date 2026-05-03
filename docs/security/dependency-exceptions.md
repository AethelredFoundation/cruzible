# Dependency Security Exceptions

> Last reviewed on 2026-05-03.
> This register tracks dependency advisories that remain after local remediation
> and require either upstream fixes or an intentional product decision.

## Active Exceptions

No active production dependency exceptions are accepted in this branch.

## Mitigations In Place

- The application resolves `postcss@8.5.10`, including the Next.js dependency path.
- Unused telemetry packages were removed so the production audit surface is limited to the framework itself instead of framework-adjacent packages.
- Frontend wallet dependencies were upgraded to current safe versions, clearing the prior `wagmi`, `@wagmi/connectors`, `axios`, and Coinbase SDK audit path.
- CI and local validation continue to run root/backend API production npm audits, TypeScript SDK npm audits, and contract Cargo audits without hidden RustSec suppressions.

## Exit Criteria

- Keep this register empty unless a future advisory has no safe upstream or override path.
- Re-open an exception only with package, severity, advisory, current version, compensating controls, owner, and exit criteria.

## Recently Closed

| Package | Advisory | Closure evidence |
| --- | --- | --- |
| `next` -> `postcss` | `GHSA-qx2v-qp2m-jg93` | `npm ls postcss next` resolves `postcss@8.5.10` under `next@15.5.15`; `npm audit --omit=dev --audit-level=high` reports zero production vulnerabilities at the repository root. |
