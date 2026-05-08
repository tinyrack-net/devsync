import { mkdir } from "node:fs/promises";
import type { ApplicationContext } from "@stricli/core";
import { buildCommand } from "@stricli/core";
import { resolveDotweaveSyncDirectoryFromEnv } from "#app/config/runtime-env.ts";
import { launchShellInDirectory } from "#app/services/terminal/shell.ts";

const cdCommand = buildCommand<Record<string, never>, [], ApplicationContext>({
  docs: {
    brief: "Launch a shell in the sync directory",
    fullDescription:
      "Launch a child shell rooted at the local sync directory. Like chezmoi cd, this opens a new shell session instead of changing the current directory of your existing shell.",
  },
  async func() {
    const syncDirectory = resolveDotweaveSyncDirectoryFromEnv();

    await mkdir(syncDirectory, { recursive: true });
    await launchShellInDirectory(syncDirectory);
  },
  parameters: {
    flags: {},
  },
});

export default cdCommand;
