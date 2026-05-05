# Dotweave

## Project Overview
**Dotweave** is a git-backed configuration synchronization tool for dotfiles. Unlike traditional tools that force you to shape your local environment around a repository, Dotweave treats your home directory (`HOME`) as the source of truth and uses a git repository purely as a synchronization artifact.

- **Main Technologies:** Bun (>=1.3.13), TypeScript, `@stricli/core` (CLI), `zod` (Validation), `age-encryption` (Secrets), `Bun test` (Testing), `Astro`/`Starlight` (Homepage/Docs).
- **Architecture:** A monorepo containing a CLI package (`@tinyrack/dotweave`), internal tools (`@tinyrack/dotweave-tools`), and a documentation homepage (`@tinyrack/dotweave-homepage`).

---

## Mandatory Validation Loop
You MUST execute a validation loop for every change to ensure system integrity.
- **Build**: `bun run build`
- **Test**: `bun run test`
- **Lint/Format (biome)**: `bun run format` and `bun run format:check`

If any step fails, you MUST fix the issues before proceeding or reporting completion. Specifically for the CLI package, you can use `bun run --filter @tinyrack/dotweave check` for a comprehensive check.

---

## Workspace Structure
Managed via Bun workspaces:
- `packages/cli`: The core CLI tool.
- `packages/tools`: Internal build and release tools.
- `packages/homepage`: Documentation and landing page built with Astro.

---

## Building and Running

### Root Commands
- **Install Dependencies:** `bun install`
- **Build All:** `bun run build`
- **Run All Dev:** `bun run dev`
- **Format Code:** `bun run format`

### CLI Package (`packages/cli`)
- **Development (Watch):** `bun run --filter @tinyrack/dotweave dev`
- **Build:** `bun run --filter @tinyrack/dotweave build`
- **Typecheck:** `bun run --filter @tinyrack/dotweave typecheck`
- **Run Tests:** `bun run --filter @tinyrack/dotweave test`
- **Full Check (Typecheck + Lint + Test):** `bun run --filter @tinyrack/dotweave check`
- **Run Local CLI:** `bun packages/cli/bin/index.js` or `bun run --filter @tinyrack/dotweave start`
- **SEA Build (Standalone Executable):** `bun run --filter @tinyrack/dotweave sea:build`

### Tools Package (`packages/tools`)
- **Run Tools CLI:** `bun run --filter @tinyrack/dotweave-tools cli`
- **Typecheck:** `bun run --filter @tinyrack/dotweave-tools typecheck`
- **Run Tests:** `bun run --filter @tinyrack/dotweave-tools test`

### Homepage Package (`packages/homepage`)
- **Dev Server:** `bun run --filter @tinyrack/dotweave-homepage dev`
- **Build Site:** `bun run --filter @tinyrack/dotweave-homepage build`
- **Typecheck:** `bun run --filter @tinyrack/dotweave-homepage typecheck`
- **Preview:** `bun run --filter @tinyrack/dotweave-homepage preview`

---

## Development Conventions

### General
- **Tooling:** Use `biome` for linting and formatting. Always run `bun run format` before committing.
- **Runtime:** Requires Bun 1.3.13 or higher.
- **Strict TypeScript:** `tsconfig.json` is configured with strict settings.

### CLI Development
- **Source Structure:**
  - `src/cli/`: Command definitions and routing.
  - `src/services/`: Core business logic (git operations, file system, sync logic).
  - `src/config/`: Configuration schemas (Zod) and migrations.
  - `src/lib/`: Low-level utilities.
- **Import Aliases:** Use `#app/*` for all internal CLI imports (mapped to `src/*`).
- **Commands:** Commands are built using `@stricli/core`. Root commands are defined in `src/cli/root-commands.ts`.
- **Testing:**
  - Unit/Integration tests: `src/**/*.test.ts`.
  - E2E tests: `tests/**/*.e2e.test.ts`.
  - E2E tests use isolated temporary environments for `HOME` and `XDG_CONFIG_HOME`.
- **Error Handling:** Use the custom error types in `src/lib/error.ts`.
- **SEA (Standalone Executable):** Uses `bun build --compile` to produce platform-specific executables. Cross-compilation is supported via `--target` flag.

### Documentation / Homepage
- **Localization:** Supports `en`, `ko`, and `ja`. Content is in `src/content/docs/`.
- **Theming:** Uses `starlight-theme-black` and Tailwind CSS.

---

## Key Files
- `bun.lock`: Lockfile for Bun dependencies.
- `biome.json`: Linting and formatting rules.
- `packages/cli/src/application.ts`: CLI entry point and application building.
- `packages/cli/src/config/sync-schema.ts`: Zod schema for the sync configuration.
- `packages/tools/src/lib/sea.ts`: SEA build logic using `bun build --compile`.
- `packages/homepage/astro.config.ts`: Astro/Starlight configuration.
