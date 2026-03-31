# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Cruzible, please report it responsibly. **Do not open a public GitHub issue.**

### Contact

- **Email:** security@aethelred.io
- **PGP:** Available on request

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact assessment
- Suggested fix (if any)

### Response Timeline

| Stage | SLA |
|-------|-----|
| Acknowledgment | 48 hours |
| Initial assessment | 5 business days |
| Fix timeline communicated | 10 business days |
| Patch released | Depends on severity |

## Scope

### In Scope

- Smart contracts (CosmWasm and Solidity)
- Backend API endpoints
- Authentication and authorization logic
- Cryptographic implementations
- TEE attestation verification
- Frontend security (XSS, CSRF, injection)

### Out of Scope

- Denial of service via rate-limited endpoints
- Social engineering attacks
- Third-party dependencies (report upstream)
- Issues in test or development environments

## Audit Reports

- [120-Attack Security Analysis](backend/contracts/SECURITY_AUDIT.md)
- [Compliance and Remediation Report](backend/contracts/SECURITY_COMPLIANCE_REPORT.md)
- [Code Review Report](CODE_REVIEW_REPORT.md)

## Security Features

**Smart contracts:** Reentrancy guards, checked arithmetic, role-based access control (Admin/Operator/Pauser), emergency pause, fee caps, slashing replay protection, solvency invariants.

**Application layer:** JWT + refresh tokens, RBAC, Zod input validation, per-endpoint rate limiting, CORS, Helmet headers, parameterised queries (Prisma), XSS sanitisation.

**Infrastructure:** TLS 1.3, libp2p Noise protocol, DDoS protection, container security contexts, secrets management.

## Bug Bounty

A bug bounty program will be announced prior to mainnet launch. Details will be published at [aethelred.io/security](https://aethelred.io/security).

## Supported Versions

| Version | Supported |
|---------|-----------|
| main (pre-mainnet) | Yes |
| Older branches | No |
