# Threat Model

Status: Baseline
Repo: `AethelredFoundation/cruzible`
Role: `application-frontend`
Canonical public source: `AethelredFoundation/aethelred`
Monorepo source path: `dApps/cruzible/`

## In Scope

- Code and configuration published in this repository
- Build and release workflow for this repository's surface area
- Dependency and packaging risk for this repository's artifacts

## Primary Risks

- Supply-chain or dependency compromise
- Release provenance drift from the canonical monorepo
- Incomplete security disclosures or stale support metadata
- Surface-specific logic or configuration bugs

## Required Controls

- Repo role and provenance declared in `repo-role.json`
- Security disclosures routed through `SECURITY.md`
- CI or baseline workflow coverage for docs and SBOM generation
