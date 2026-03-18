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
