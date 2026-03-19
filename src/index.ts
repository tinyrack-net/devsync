#!/usr/bin/env node
import { execute } from "@oclif/core";
import { loadEnvironment } from "#app/config/env.ts";

loadEnvironment();
await execute({ dir: import.meta.url });
