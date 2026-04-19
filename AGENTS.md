# AGENTS.md

## Workspace

- This is a `pnpm` workspace with two packages under `packages/`: `cli` (`@tinyrack/dotweave`) and `homepage` (`@tinyrack/dotweave-homepage`).
- Root scripts are minimal: `pnpm dev` runs every package's `dev` script recursively, `pnpm format` writes formatting, and `pnpm format:check` runs `biome check .`.
- CI is package-specific, not workspace-wide: the CLI package is built and validated in `.github/workflows/ci.yml`; the homepage is built and deployed separately in `.github/workflows/deploy-homepage.yml`.
- Node.js 24+ is required everywhere, and the workspace pins `pnpm@10.33.0`.

## CLI Package

- The published CLI lives in `packages/cli`.
- Main source entrypoint: `packages/cli/src/index.ts`. CLI wiring lives in `src/application.ts` and `src/cli/index.ts`.
- Use the `#app/*` import alias for CLI source modules; it maps to `packages/cli/src/*` in both TypeScript and Vitest config.
- `packages/cli/tsconfig.json` is strict, `noEmit`, `module`/`moduleResolution` are `NodeNext`, and `erasableSyntaxOnly` is intentionally enabled.
- Production artifacts come from `packages/cli/tsconfig.build.json`, which emits `dist/` and rewrites relative import extensions. Do not treat this package as source-only at runtime.
- Keep `packages/cli/bin/index.js` as the executable wrapper to `dist/index.js`; the comment there explains why the wrapper exists.
- Tests are split by location: unit/integration tests sit next to source as `src/**/*.test.ts`, and CLI end-to-end coverage lives in `packages/cli/tests/**/*.e2e.test.ts`.
- E2E helpers create isolated temp `HOME` and `XDG_CONFIG_HOME` directories and invoke the CLI with `process.execPath`; avoid rewriting tests to depend on the real user environment.
- PTY autocomplete coverage depends on shell availability. `autocomplete.pty.e2e.test.ts` skips when `bash`/`zsh` are unavailable.

## Homepage Package

- The docs site lives in `packages/homepage` and is an Astro/Starlight app deployed with Wrangler.
- Site config is in `packages/homepage/astro.config.ts`; Cloudflare deployment settings are in `packages/homepage/wrangler.jsonc`.
- Docs content is loaded from `packages/homepage/src/content/docs/` via `src/content.config.ts`.
- The site is localized with `en`, `ko`, and `ja` locales configured in `astro.config.ts`; doc changes often need matching content under those locale directories.

## Commands

- CLI dev/build/run: `pnpm --filter @tinyrack/dotweave dev`, `pnpm --filter @tinyrack/dotweave build`, `pnpm --filter @tinyrack/dotweave start`
- CLI validation: `pnpm --filter @tinyrack/dotweave check`
- CLI targeted checks: `pnpm --filter @tinyrack/dotweave typecheck`, `biome check .`, `pnpm --filter @tinyrack/dotweave test`
- Homepage dev/build/typecheck: `pnpm --filter @tinyrack/dotweave-homepage dev`, `pnpm --filter @tinyrack/dotweave-homepage build`, `pnpm --filter @tinyrack/dotweave-homepage typecheck`
- Release workflow expectations for the CLI package are encoded in scripts and CI: build first, then `check`, and release tags must match `packages/cli/package.json` version.

## Validation

- For CLI changes, match CI locally with `pnpm --filter @tinyrack/dotweave build` followed by `pnpm --filter @tinyrack/dotweave check`.
- For homepage changes, at minimum run `pnpm --filter @tinyrack/dotweave-homepage typecheck` and `pnpm --filter @tinyrack/dotweave-homepage build`.
- `biome check .` runs at the repo root and covers both packages; there is no root script that runs all package-specific validations together.
