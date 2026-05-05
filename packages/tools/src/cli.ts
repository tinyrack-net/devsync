#!/usr/bin/env bun
import { run } from "@stricli/core";
import { app } from "./cli/app.ts";

const strictProcess = {
  env: process.env,
  get exitCode() {
    return process.exitCode ?? null;
  },
  set exitCode(value) {
    process.exitCode = value ?? undefined;
  },
  stderr: process.stderr,
  stdout: process.stdout,
};

await run(app, process.argv.slice(2), { process: strictProcess });
