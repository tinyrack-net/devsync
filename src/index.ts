#!/usr/bin/env node

import { createRequire } from "node:module";

import { runCli } from "#app/cli/index.ts";
import { loadEnvironment } from "#app/config/env.ts";

loadEnvironment();

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as {
  name: string;
  version: string;
};

const exitCode = await runCli(process.argv.slice(2), packageJson, {
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
});

if (exitCode !== 0) {
  process.exit(exitCode);
}
