#!/usr/bin/env node
import { sep } from "node:path";
import { fileURLToPath } from "node:url";

import { execute } from "@oclif/core";

const entryPath = fileURLToPath(import.meta.url);

await execute({
  ...(entryPath.includes(`${sep}src${sep}`) ? { development: true } : {}),
  dir: import.meta.url,
});
