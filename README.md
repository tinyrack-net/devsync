# devsync Monorepo

This repository is organized as a pnpm workspace monorepo.

- Root package: private workspace container
- CLI package: `packages/cli`

Useful commands from the repository root:

```bash
pnpm install
pnpm --filter @tinyrack/devsync check
pnpm --filter @tinyrack/devsync start -- --help
```

The published CLI package lives in `packages/cli`.
