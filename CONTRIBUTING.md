# Contributing to Cruzible

Thank you for your interest in contributing to Cruzible! This guide will help you get started.

## Code of Conduct

By participating, you agree to uphold a welcoming, respectful, and harassment-free environment for everyone.

## Getting Started

1. **Fork** the repository
2. **Clone** your fork locally
3. **Install** dependencies: `npm ci`
4. **Create** a feature branch: `git checkout -b feature/my-feature`

## Development Workflow

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | >= 20.0.0 |
| Rust | >= 1.75.0 |
| Docker + Compose | latest |
| PostgreSQL | >= 16 |
| Redis | >= 7 |

### Running Locally

```bash
cp .env.example .env
docker-compose -f backend/infra/docker-compose.yml up -d
npm run dev
```

### Before Submitting

Run the full validation suite:

```bash
npm run validate    # type-check + lint + format + tests
```

## Pull Request Guidelines

1. **Branch naming**: `feature/`, `fix/`, `docs/`, `refactor/`, `test/`
2. **Commit messages**: Follow [Conventional Commits](https://www.conventionalcommits.org/)
   - `feat:` new feature
   - `fix:` bug fix
   - `docs:` documentation
   - `refactor:` code restructuring
   - `test:` adding or updating tests
   - `chore:` maintenance tasks
3. **PR description**: Explain what changed and why
4. **Tests**: Add or update tests for your changes
5. **One concern per PR**: Keep PRs focused and reviewable

## Areas of Contribution

- **Frontend** (Next.js / React / Tailwind) — `src/`
- **Backend API** (Express / TypeScript) — `backend/api/`
- **Smart Contracts** (CosmWasm / Rust) — `backend/contracts/`
- **SDKs** (TypeScript, Python) — `sdk/`
- **Documentation** — `docs/`
- **Tests** — improving coverage across all areas

## Reporting Issues

Use GitHub Issues with the appropriate template. Include:
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, browser, Node version)

## Security Issues

**Do NOT** file security issues as public GitHub issues. See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.

## License

By contributing, you agree that your contributions will be licensed under the [Apache 2.0 License](LICENSE).
