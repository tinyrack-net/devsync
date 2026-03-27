#!/usr/bin/env node
import { runCli } from "#app/application.js";

await runCli(process.argv.slice(2));
