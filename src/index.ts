#!/usr/bin/env node

import { runCli } from "#app/cli/index.ts";
import { loadEnvironment } from "#app/config/env.ts";

loadEnvironment();

const stdoutWrite = process.stdout.write.bind(process.stdout);
const stderrWrite = process.stderr.write.bind(process.stderr);

const exitCode = await runCli(process.argv.slice(2), {
  stdout: (text) => {
    stdoutWrite(text);
  },
  stderr: (text) => {
    stderrWrite(text);
  },
});

if (exitCode !== 0) {
  process.exit(exitCode);
}
