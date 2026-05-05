import { fileURLToPath } from "node:url";

export const cliPath = fileURLToPath(
  new URL("../../../src/index.ts", import.meta.url),
);

export const cliNodeOptions = [cliPath] as const;
