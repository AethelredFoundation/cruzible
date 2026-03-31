# Contributing to Cruzible

Thank you for your interest in contributing to Cruzible. This guide explains how to get involved.

---

## Getting Started

1. **Fork** the repository
2. **Clone** your fork locally
3. **Install** dependencies — see the [Quick Start](README.md#quick-start) section
4. **Create a branch** from `main` using the naming convention below

## Branch Naming

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feature/<short-description>` | `feature/validator-dashboard` |
| Bug fix | `fix/<short-description>` | `fix/staking-rounding` |
| Docs | `docs/<short-description>` | `docs/api-reference` |
| Chore | `chore/<short-description>` | `chore/bump-wagmi` |

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`

**Scopes:** `frontend`, `api`, `contracts`, `node`, `infra`, `sdk`

Examples:
```
feat(contracts): add flash loan protection to AethelVault
fix(frontend): correct staking reward display rounding
docs(api): add WebSocket event reference
```

## Pull Requests

1. Run `npm run validate` before pushing
2. Open a PR against `main`
3. Fill in the PR template
4. Ensure CI passes — the pipeline runs lint, tests, and security checks
5. Request review from a maintainer

### PR Checklist

- [ ] Code compiles and tests pass locally
- [ ] New functionality includes tests
- [ ] Documentation updated if needed
- [ ] No secrets, keys, or credentials committed
- [ ] Follows existing code style and patterns

## Code Style

### TypeScript (Frontend + API)

- Strict mode enabled
- ESLint + Prettier enforced via pre-commit hooks
- Prefer `const` and `readonly` where possible
- Use explicit return types for exported functions

### Rust (Smart Contracts + Node)

- `cargo fmt` and `cargo clippy -- -D warnings` must pass
- Use `thiserror` for error types
- Checked arithmetic (`checked_add`, `checked_sub`) for all token math
- All public functions documented with `///` comments

### Solidity (EVM Contracts)

- Solidity 0.8.20+
- NatSpec comments on all external functions
- Follow checks-effects-interactions pattern

## Testing

| Component | Command | Minimum Coverage |
|-----------|---------|-----------------|
| Frontend | `npm test` | 80% |
| API | `cd backend/api && npm test` | 80% |
| Contracts (CosmWasm) | `cd backend/contracts && cargo test --all` | 90% |
| Contracts (Solidity) | `cd contracts && forge test` | 90% |
| E2E | `npm run test:e2e` | Critical paths |

## Security

If you discover a security vulnerability, **do not open a public issue**. Follow the [Security Policy](SECURITY.md) for responsible disclosure.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
