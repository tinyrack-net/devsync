#!/usr/bin/env node
import { runCli } from "#app/cli/application.js";

await runCli(process.argv.slice(2));
