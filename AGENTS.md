# AGENTS.md

## Project Overview

- `devsync`, a personal CLI tool built with Node.js and TypeScript
- Module system: ESM
- Runtime: execute `.ts` files directly with Node.js
- Minimum supported Node.js version: 24
- TypeScript is configured in strict mode
- `tsc` is used for type-checking only and must not emit JavaScript
- Formatting and linting are handled by Biome
- Testing is handled by Vitest

## Working Rules

- Always keep the project compatible with Node.js 24+
- Preserve direct TypeScript execution with Node.js
- Keep `erasableSyntaxOnly: true` enabled unless explicitly told otherwise
- Keep TypeScript settings very strict
- Do not introduce a build step that emits JavaScript unless explicitly requested
- Prefer small, testable modules over putting all logic in `src/index.ts`

## Source Layout

- Keep `src/index.ts` as the CLI entrypoint only
- Place CLI-specific modules under `src/cli/`
- Place environment/configuration modules under `src/config/`
- Place sync-related modules under `src/services/sync/`
- Place reusable cross-domain pure utilities under `src/lib/`
- Avoid leaving feature modules like `cli-types.ts` or `cli-validation.ts` in the `src/` root
- Place unit and integration-style Vitest files next to the source they exercise using `*.test.ts`
- Reserve the root `tests/` directory for end-to-end CLI coverage using `*.e2e.test.ts`
- Keep shared test helpers outside the root `tests/` directory unless they are specific to end-to-end coverage

## Key Dependencies

- `@oclif/core` for CLI command definitions
- `@oclif/plugin-autocomplete` for shell autocomplete support
- `zod` for input validation and config schema
- `age-encryption` for secret file encryption

## Validation Requirements

After every code change, run all validation steps before finishing:

1. `pnpm --filter @tinyrack/devsync typecheck`
2. `biome check .`
3. `pnpm --filter @tinyrack/devsync test`

You may run `pnpm --filter @tinyrack/devsync check` if it still covers all of the validation steps above.
Do not consider work complete if any validation step fails.

## Useful Commands

- Development: `pnpm --filter @tinyrack/devsync dev`
- Run CLI: `pnpm --filter @tinyrack/devsync start`
- Type-check: `pnpm --filter @tinyrack/devsync typecheck`
- Lint/format validation: `biome check .`
- Tests: `pnpm --filter @tinyrack/devsync test`
- Full validation: `pnpm --filter @tinyrack/devsync check`
- Auto-fix formatting/lint issues: `pnpm --filter @tinyrack/devsync check:fix`
- Format: `pnpm format`
