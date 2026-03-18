# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest  | Yes       |

## Reporting a Vulnerability

The Aethelred Foundation takes security seriously. If you discover a security vulnerability in Cruzible, please report it responsibly.

### How to Report

1. **Do NOT** open a public GitHub issue for security vulnerabilities.
2. Email **security@aethelred.io** with:
   - A description of the vulnerability
   - Steps to reproduce
   - Potential impact assessment
   - Any suggested fixes (optional)

### What to Expect

- **Acknowledgment** within 48 hours of your report.
- **Assessment** within 5 business days with an initial severity classification.
- **Resolution timeline** communicated based on severity:
  - **Critical**: Fix within 24-48 hours
  - **High**: Fix within 7 days
  - **Medium**: Fix within 30 days
  - **Low**: Fix in next scheduled release

### Scope

This policy applies to:
- The Cruzible frontend application
- The backend API gateway
- CosmWasm smart contracts
- Client SDKs
- CI/CD infrastructure

### Recognition

We credit reporters in our security advisories (unless anonymity is requested) and maintain a security hall of fame for significant disclosures.

## Security Measures

- All dependencies are monitored via Dependabot and `npm audit`
- CodeQL static analysis runs on every PR
- Smart contracts undergo formal security audits
- See [Security Audit](backend/contracts/SECURITY_AUDIT.md) for the latest audit report
