import { fileURLToPath } from "node:url";

import { execa } from "execa";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

export const cliPath = fileURLToPath(
  new URL("../../../src/index.ts", import.meta.url),
);

let buildPromise: Promise<void> | undefined;

export const ensureCliBuilt = async () => {
  buildPromise ??= execa(npmCommand, ["run", "build"], {
    cwd: repositoryRoot,
  }).then(() => undefined);

  await buildPromise;
};
