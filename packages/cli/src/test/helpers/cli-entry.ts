import { fileURLToPath } from "node:url";

export const cliPath = fileURLToPath(
  new URL("../../../src/index.ts", import.meta.url),
);

export const cliHookPath = fileURLToPath(
  new URL("./node-test-hooks.ts", import.meta.url),
);

export const cliNodeOptions = ["--import", cliHookPath, cliPath] as const;
