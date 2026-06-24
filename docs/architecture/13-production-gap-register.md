# Production Gap Register

> Repo-backed self-audit for closing Cruzible's technology and production gaps.
> Last reconciled on 2026-06-24.

## Current Stance

Cruzible is not yet production-live. The repository is now much stronger than a
typical prototype because it has fail-closed frontend config, hardened runtime
security headers, backend auth controls, dependency audits, deployment manifest
validation, backup tooling, and CI gates. The remaining gap is not one feature.
It is the full chain of evidence needed to operate a liquid staking product with
mainnet funds, public users, and incident pressure.

The table below is intentionally strict:

- `Ready` means the repository has an implemented and tested control.
- `Mitigated` means the repository has a strong control, but more depth is still useful.
- `In progress` means code exists, but production evidence or broader coverage is missing.
- `Open` means the gap still needs engineering work in this repository.
- `Blocked external` means the next step depends on funding, operator infrastructure, or staging access outside this repository.

## Gap Register

| ID | Domain | Gap | Evidence | Status | Next action |
| --- | --- | --- | --- | --- | --- |
| PG-001 | External assurance | No funded independent audit yet | User funding constraint plus `backend/contracts/AUDIT_PACKET.md` | Blocked external | Keep internal audit gates current and prepare a complete audit packet for later review |
| PG-002 | Threat model | Security trust model exists but needs recurring review cadence | `docs/architecture/10-security-trust-model.md` | In progress | Add release checklist item that requires threat model review for every major protocol change |
| PG-003 | Runtime code safety | Dangerous frontend and backend runtime patterns must stay blocked | `scripts/security-hygiene-scan.mjs` | Ready | Keep adding scanner rules when new production-risk classes are found |
| PG-004 | Dependency hygiene | High-or-above dependency findings must remain zero before release | `docs/security/dependency-exceptions.md` and `npm audit` workflows | Ready | Refresh audit evidence after every dependency update |
| PG-005 | Secret hygiene | Committed secrets and restricted provenance text must be blocked | `scripts/security-hygiene-scan.mjs` | Ready | Extend scanner if new secret formats are introduced |
| PG-006 | Auth refresh safety | Cookie refresh flow must remain origin-checked and HttpOnly | `backend/api/src/routes/v1/auth.ts` and `backend/api/tests/auth.test.ts` | Ready | Exercise nonce, login, refresh, and logout flows against staging origins |
| PG-007 | Access token storage | Browser access tokens must stay in memory, not persistent storage | `src/lib/api.ts` and `src/__tests__/api-auth-token.test.ts` | Ready | Keep scanner coverage for sensitive Web Storage usage |
| PG-008 | Admin bootstrap | Production must refuse unconfigured operator/admin roles | `backend/api/src/config/index.ts` and `backend/api/tests/config.test.ts` | Ready | Validate real operator/admin address lists before staging traffic |
| PG-009 | Privileged audit trail | Protected operations need append-only, queryable audit evidence | `backend/api/src/middleware/privilegedAudit.ts` and `backend/api/tests/privilegedAudit.test.ts` | Ready | Export staged audit events during incident drill rehearsals |
| PG-010 | Operational endpoint gating | Metrics, docs, and full health must not be public in production | `backend/api/src/server.ts` and `backend/api/tests/appServer.test.ts` | Ready | Confirm production token distribution and rotation with operators |
| PG-011 | Contract audit | CosmWasm contracts still need external review before mainnet funds | `backend/contracts/SECURITY_AUDIT.md` | Blocked external | Keep contract artifacts deterministic and ready for later external audit |
| PG-012 | Contract release manifest | Staging code IDs, addresses, checksums, and owners are not captured yet | `backend/contracts/deployments/release-manifest.example.json` | Open | Generate a staging release manifest from real deployment artifacts |
| PG-013 | Contract artifact signing | Release artifact signing and verification scripts exist | `backend/contracts/scripts/sign-audit-artifacts.sh` | Mitigated | Run signing workflow on every staged release artifact bundle |
| PG-014 | Contract invariant depth | Unit tests exist, but broader invariant and fuzz coverage is limited | `backend/contracts/contracts/*/src/contract_tests.rs` | Open | Add invariant/fuzz tests for staking accounting, role transitions, and pause flows |
| PG-015 | Contract role ownership | Production role owners are not mapped to real multisig or operator wallets | `backend/contracts/RELEASE_SIGNING.md` | Open | Document environment-specific owners in the release manifest |
| PG-016 | Contract emergency response | Pause and recovery playbooks need environment-specific drills | `docs/ops/runbook.md` | In progress | Add staged pause, unpause, and rollback evidence to the runbook |
| PG-017 | Wasm checksum traceability | Wasm checksum tooling exists but needs staging artifact evidence | `backend/contracts/scripts/prepare-audit-artifacts.sh` | In progress | Attach generated checksums to the release manifest during staging |
| PG-018 | Governance launch gating | Governance UI must not present simulated protocol state as live | `src/pages/governance/index.tsx` | Ready | Replace gated page only after real governance reads and writes are wired |
| PG-019 | Mock isolation | Runtime UI must never import MSW or test handlers | `src/__tests__/mock-isolation.test.ts` | Ready | Keep mock isolation in both unit tests and hygiene scanner |
| PG-020 | Public link quality | Dead footer links and placeholder navigation are removed | `src/__tests__/footer-links.test.ts` | Ready | Add any future public links with real route or document targets only |
| PG-021 | API origin safety | Frontend builds must fail closed on unsafe API origins | `scripts/validate-frontend-public-env.mjs` | Ready | Keep chain-specific API origin allowlists updated with real launch domains |
| PG-022 | CSP and headers | Frontend has nonce CSP and strict security headers | `src/middleware.ts` and `src/__tests__/next-config-security.test.ts` | Ready | Validate runtime headers on every deployed preview and release candidate |
| PG-023 | Bundle control | Frontend bundle budget is enforced after production builds | `scripts/check-frontend-bundle-budget.mjs` | Ready | Tighten budgets as pages mature and split heavy product surfaces |
| PG-024 | Performance lab evidence | Lighthouse or synthetic user journey budgets are not yet CI-enforced | `docs/architecture/11-benchmarking-slos.md` | Open | Add automated Lighthouse or Playwright performance budgets for critical paths |
| PG-025 | Accessibility evidence | Accessibility checks are not yet automated | `src/pages` | Open | Add axe or equivalent accessibility checks for landing, vault, and auth flows |
| PG-026 | Mobile readiness | Mobile smoke coverage exists indirectly, but device-class coverage is thin | `e2e/public-readiness.spec.ts` | In progress | Add mobile viewport E2E assertions for vault, validators, and stablecoin flows |
| PG-027 | SEO origin consistency | Canonical origin and wallet metadata are tested | `src/__tests__/canonical-origin.test.ts` | Ready | Re-run checks when launch origin or asset hosting changes |
| PG-028 | WalletConnect production ID | Production WalletConnect ID depends on operator-provided public config | `scripts/validate-frontend-public-env.mjs` | In progress | Validate real WalletConnect project ID in staging and production variables |
| PG-029 | Vault reward display | Vault hides live receive previews when exchange-rate data is unavailable | `src/pages/vault/index.tsx` | Ready | Add staging assertions against real control-plane data |
| PG-030 | Withdrawal queue | Withdrawal rows are no longer seeded, but real queue staging evidence is missing | `src/lib/withdrawalRequests.ts` | In progress | Validate withdrawal lifecycle against a staged API and contract deployment |
| PG-031 | Slashing disclosure | User-facing staking risk disclosure is not yet deep enough for mainnet | `src/pages/vault/index.tsx` | Open | Add validator, slashing, liquidity, and unbonding risk panels backed by protocol data |
| PG-032 | Validator scoring | Validator pages exist, but scoring freshness and source provenance need stronger surfacing | `src/lib/validators.ts` | In progress | Show data source, update time, and stale-data warnings on validator views |
| PG-033 | Transaction simulation | Contract writes run simulation before submission | `src/lib/transactionPreflight.ts` | Ready | Expand simulations as new write paths are added |
| PG-034 | Stablecoin controls | Stablecoin bridge phase and form guards prevent unavailable operations | `src/lib/stablecoinBridgeGuards.ts` | Ready | Validate read-only and coming-soon states against staging token config |
| PG-035 | Mainnet addresses | Mainnet contract addresses are not supplied in repository defaults | `.env.example` and `Dockerfile` | Blocked external | Inject real addresses through release variables and record them in the manifest |
| PG-036 | API input validation | Backend request schemas validate high-risk inputs | `backend/api/src/validation/schemas.ts` | Ready | Add schemas for any new route before exposing it in `/v1` |
| PG-037 | Rate limiting | API rate limits use Redis and fail closed on store errors | `backend/api/src/middleware/rateLimiter.ts` | Ready | Validate Redis-backed limits under staging load |
| PG-038 | Health readiness | Liveness and readiness endpoints are split for orchestrators | `backend/api/src/routes/health.ts` | Ready | Confirm production probes match deployed manifests |
| PG-039 | API docs coverage | Swagger route coverage is now validated against mounted `/v1` routes | `backend/api/scripts/validate-openapi-coverage.mjs` and `backend/api/src/config/openapi-paths.json` | Ready | Keep validator in backend CI so new routes require documented OpenAPI coverage |
| PG-040 | Database migrations | Prisma migration scripts exist for production deploys | `backend/api/package.json` and `backend/api/prisma/migrations` | Ready | Run migration apply and rollback rehearsal in staging |
| PG-041 | Database backup | Redacted PostgreSQL backup workflow exists | `backend/api/scripts/backup-database.mjs` | Ready | Pair every migration drill with backup and restore evidence |
| PG-042 | Restore drill | Restore validation still depends on operator-managed database infrastructure | `docs/ops/runbook.md` | Blocked external | Run a restore drill once staging database infrastructure exists |
| PG-043 | Cache persistence | Redis is required in production, with in-memory fallback limited to local/test | `backend/api/src/services/CacheService.ts` | Ready | Verify Redis TLS URL and credentials in staging |
| PG-044 | Alert persistence | Alerts persist to PostgreSQL when database config exists | `backend/api/src/services/AlertService.ts` | Mitigated | Connect alert routing and retention policy in staging |
| PG-045 | Indexer materialization | Indexer-backed state exists, but end-to-end staged indexing evidence is incomplete | `backend/api/src/services/IndexerService.ts` | In progress | Run indexer from clean database through live reconciliation cycle |
| PG-046 | Realtime gateway | Production sockets require allowed origins plus token controls | `backend/api/src/websocket/WebSocketManager.ts` | Mitigated | Add staged browser socket smoke tests with access and operational tokens |
| PG-047 | Compose hardening | Compose manifest validation enforces digest images and secret files | `scripts/validate-deployment-manifests.mjs` | Ready | Replace example digests and secrets with environment-specific values for staging |
| PG-048 | Kubernetes hardening | K8s base enforces read-only roots, secret files, resources, and NetworkPolicies | `k8s/base` | Ready | Validate overlays in a real cluster before public traffic |
| PG-049 | TLS material | TLS certificate and key provisioning are outside this repository | `backend/infra/docker-compose.yml` | Blocked external | Mount real TLS files and validate nginx termination in staging |
| PG-050 | Immutable production images | Production image digests still need real release artifacts | `.github/workflows/ci-cd.yml` | In progress | Build release images and update manifests with immutable digests |
| PG-051 | Network egress | Ingress NetworkPolicies exist, but egress policy needs environment-specific tightening | `k8s/base/network-policy.yaml` | Open | Add explicit egress policy overlays for RPC, database, Redis, and alert endpoints |
| PG-052 | Resource sizing | CPU, memory, and ephemeral-storage budgets need real traffic calibration | `k8s/base/backend.yaml` | In progress | Tune resource requests and limits after staging load tests |
| PG-053 | Observability baseline | Prometheus and Grafana config is checked in | `backend/infra/config/grafana` | Mitigated | Calibrate dashboards and alerts against staged traffic |
| PG-054 | Alert routing | Alert webhook config is validated, but live routing is not configured here | `backend/api/src/config/index.ts` | Blocked external | Provision production alert receiver and test incident notifications |
| PG-055 | CI action pinning | GitHub Actions use pinned action references | `src/__tests__/github-actions-hardening.test.ts` | Ready | Keep new workflow actions pinned by commit |
| PG-056 | Static analysis | CodeQL runs for JavaScript, Python, Rust, and Actions | `.github/workflows/security-audit.yml` | Ready | Review CodeQL findings on every PR before merge |
| PG-057 | Dependency review | Pull requests run dependency review | `.github/workflows/security-audit.yml` | Ready | Keep advisory exceptions documented and time-bounded |
| PG-058 | SBOM | Software bill of materials generation is not yet part of release CI | `.github/workflows/ci-cd.yml` | Open | Generate SBOMs for frontend, API, SDK, and contract release artifacts |
| PG-059 | Provenance attestations | Release provenance and artifact attestations are not yet emitted | `.github/workflows/ci-cd.yml` | Open | Add provenance attestations for container images and contract bundles |
| PG-060 | Runtime image scanning | Container image vulnerability scanning is not yet enforced on built images | `.github/workflows/ci-cd.yml` | Open | Add image scan gate after frontend and backend image builds |
| PG-061 | Incident runbook | Operator runbook exists and covers several emergency paths | `docs/ops/runbook.md` | Mitigated | Add evidence sections for each staged incident drill |
| PG-062 | Access revocation | Access-token revocation watermark and session revocation flows exist | `backend/api/src/auth/service.ts` | Ready | Rehearse operator revocation during staging incident drill |
| PG-063 | Operator onboarding | Environment reference exists, but platform-specific onboarding is incomplete | `docs/ops/environment-reference.md` | In progress | Add deployment-platform-specific checklists after staging target is selected |
| PG-064 | Full staging smoke | End-to-end staging smoke across auth, vault, indexer, and reconciliation is missing | `docs/architecture/12-public-readiness.md` | Open | Create a staged launch drill script and require evidence before production |
| PG-065 | Disaster recovery | DR recovery time and recovery point targets are not validated | `docs/ops/runbook.md` | Open | Define RTO/RPO targets and prove restore timing in staging |
| PG-066 | SLO benchmarking | Benchmarking SLO doc exists, but automated enforcement is partial | `docs/architecture/11-benchmarking-slos.md` | In progress | Wire API benchmarks and frontend journey budgets into CI or staging jobs |
| PG-067 | Production monitoring calibration | Alert thresholds need real workload calibration | `backend/infra/config/prometheus/alerts.yml` | Blocked external | Tune thresholds after staged traffic and RPC dependency behavior are observed |
| PG-068 | Log redaction | Backend and frontend public errors redact sensitive material | `backend/api/src/utils/redaction.ts` and `src/lib/publicErrors.ts` | Ready | Keep redaction test vectors updated for new token or credential formats |
| PG-069 | Privacy hashing | Privacy-preserving identifiers are tested | `backend/api/src/utils/privacyHash.ts` | Ready | Confirm privacy salt handling in production secret storage |
| PG-070 | Product moat | Risk, proof, queue, and validator transparency are not yet 10x differentiated | `src/pages/vault/index.tsx` | Open | Build user-facing proof timelines, validator risk intelligence, and withdrawal liquidity analytics |
| PG-071 | Protocol transparency | Public reconciliation exists, but proof drill-down depth is not final | `src/pages/reconciliation.tsx` | In progress | Add proof source drill-downs, stale-source warnings, and exportable evidence |
| PG-072 | User education | Staking, liquidity, and bridge education is too thin for non-expert users | `README.md` and `src/pages/vault/index.tsx` | Open | Add plain-language risk, fees, and withdrawal education in-product |
| PG-073 | Launch claims | Public pages need stricter copy review to avoid implying live mainnet readiness | `src/pages` | In progress | Add copy-review checklist for every launch-facing page |
| PG-074 | Route inventory | Production route map is documented but not machine-checked against Next pages | `README.md` and `src/pages` | Open | Add route inventory validation for public pages and API endpoints |
| PG-075 | Gap register governance | Gap register now exists and must stay machine-validated | `docs/architecture/13-production-gap-register.md` | Ready | Run `npm run readiness:gaps` in CI and update rows with every production hardening change |

## Immediate Engineering Priority

The next coding work should focus on gaps that are not blocked by funding or
operator infrastructure:

1. Add route inventory validation for public Next.js pages and launch-gated pages.
2. Add accessibility checks for the landing, vault, and launch-gated surfaces.
3. Add staged launch drill scripts that can be run once staging secrets exist.
4. Add SBOM, provenance, and image scan gates to release workflows.
5. Add egress NetworkPolicy overlays for RPC, database, Redis, and alert endpoints.
