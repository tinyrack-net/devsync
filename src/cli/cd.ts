import { mkdir } from "node:fs/promises";

import { buildCommand } from "@stricli/core";
import { resolveDevsyncSyncDirectory } from "#app/config/xdg.js";
import {
  type DevsyncCliContext,
  verboseFlag,
} from "#app/services/terminal/cli-runtime.js";
import { launchShellInDirectory } from "#app/services/terminal/shell.js";

const cdCommand = buildCommand<
  {
    verbose?: boolean;
  },
  [],
  DevsyncCliContext
>({
  docs: {
    brief: "Launch a shell in the sync directory",
    fullDescription:
      "Launch a child shell rooted at the local sync repository directory. Like chezmoi cd, this opens a new shell session instead of changing the current directory of your existing shell.",
  },
  async func() {
    const syncDirectory = resolveDevsyncSyncDirectory();

    await mkdir(syncDirectory, { recursive: true });
    await launchShellInDirectory(syncDirectory, process.env);
  },
  parameters: {
    flags: {
      verbose: verboseFlag,
    },
  },
});

export default cdCommand;
