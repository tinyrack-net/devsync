#!/usr/bin/env node
import { runCli } from "#app/application.ts";

await runCli(process.argv.slice(2));
