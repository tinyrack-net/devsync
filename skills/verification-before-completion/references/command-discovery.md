# Command Discovery Guide

Use this guide to quickly identify likely validation commands before reporting completion.

## Where to look first

Check these sources in order:

1. repository instructions such as `AGENTS.md`, `CLAUDE.md`, or contributor docs
2. `README.md` and developer setup docs
3. package manager files and scripts
4. CI workflow files
5. test or tooling config files

## Common signals by ecosystem

### Node.js

Look in:
- `package.json`
- `biome.json`, `eslint.config.*`, `vitest.config.*`, `jest.config.*`
- `tsconfig.json`

Common commands:
- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run check`
- `pnpm test`
- `pnpm lint`
- `bun test`

### Python

Look in:
- `pyproject.toml`
- `requirements*.txt`
- `tox.ini`
- `pytest.ini`

Common commands:
- `pytest`
- `python -m pytest`
- `ruff check .`
- `mypy .`

### Go

Look in:
- `go.mod`
- `Makefile`

Common commands:
- `go test ./...`
- `go test ./path/to/package`
- `go vet ./...`

### Rust

Look in:
- `Cargo.toml`

Common commands:
- `cargo test`
- `cargo check`
- `cargo clippy --all-targets --all-features`
- `cargo fmt --check`

### Ruby

Look in:
- `Gemfile`
- `Rakefile`

Common commands:
- `bundle exec rspec`
- `bundle exec rubocop`
- `bundle exec rake test`

## CI as source of truth

If the repository has CI workflows, use them to infer required validation steps.

Examples:
- GitHub Actions in `.github/workflows/`
- GitLab CI in `.gitlab-ci.yml`

If local docs and CI disagree, prefer explicit repository instructions first, then CI.

## Choosing scope

Use the smallest command that gives trustworthy signal first, then expand if needed:

- changed test file or package
- affected module test suite
- repository-wide checks

Examples:
- run one Vitest file before `npm run test`
- run one package’s tests before monorepo-wide validation
- run targeted type-checking if the repo supports it, then full type-check if required

## When validation cannot run

If a check cannot run because of missing credentials, unavailable services, unsupported OS tooling, or excessive runtime:

- say exactly which check was skipped
- explain why it could not run
- provide the next best command for the user to run
- do not overstate confidence
