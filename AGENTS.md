# AGENTS.md

## Project Overview

- `devtools`, a personal CLI tool built with Node.js and TypeScript
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
- Place skill management modules under `src/skills/`
- Place reusable cross-domain pure utilities under `src/lib/`
- Keep domain-specific helpers with their owning domain, e.g. web parsing/formatting under `src/web/`
- Avoid leaving feature modules like `cli-types.ts` or `cli-validation.ts` in the `src/` root
- Place tests under `tests/` with names matching `<domain>.<topic>.test.ts`
- Place test helpers and fixture servers under `tests/helpers/`
- Place bundled skill templates under `skills/<skill-name>/`

## Key Dependencies

- `@oclif/core` for CLI command definitions
- `zod` for input validation and environment schema
- `jsdom` and `@mozilla/readability` for HTML parsing and article extraction
- `turndown` for HTML-to-Markdown conversion
- `dotenv` for `.env` file loading in non-production environments

## Validation Requirements

After every code change, run all validation steps before finishing:

1. `npm run typecheck`
2. `biome check .`
3. `npm run test`

You may run `npm run check` if it still covers all of the validation steps above.
Do not consider work complete if any validation step fails.

## Useful Commands

- Development: `npm run dev`
- Run CLI: `npm run start`
- Type-check: `npm run typecheck`
- Lint/format validation: `biome check .`
- Tests: `npm run test`
- Full validation: `npm run check`
- Auto-fix formatting/lint issues: `npm run check:fix`
- Format: `npm run format`
