import { fileURLToPath, pathToFileURL } from "node:url";

export const cliPath = fileURLToPath(
  new URL("../../../src/index.ts", import.meta.url),
);

export const cliHookPath = fileURLToPath(
  new URL("./node-test-hooks.ts", import.meta.url),
);

export const cliHookUrl = pathToFileURL(cliHookPath).href;

export const cliNodeOptions = ["--import", cliHookUrl, cliPath] as const;
