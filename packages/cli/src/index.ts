#!/usr/bin/env bun
import { runCli } from "#app/application.ts";

void (async () => {
  await runCli(process.argv.slice(2));
})();
