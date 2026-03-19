import { addSyncTarget } from "./add.ts";
import { forgetSyncTarget } from "./forget.ts";
import { createGitService, type GitRunner } from "./git.ts";
import { initializeSync } from "./init.ts";
import { pullSync } from "./pull.ts";
import { pushSync } from "./push.ts";
import { setSyncTargetMode } from "./set.ts";

export { SyncError } from "./error.ts";

export const createSyncManager = (dependencies?: {
  cwd?: string;
  environment?: NodeJS.ProcessEnv;
  gitRunner?: GitRunner;
}) => {
  const cwd = dependencies?.cwd ?? process.cwd();
  const environment = dependencies?.environment ?? process.env;
  const git = createGitService(dependencies?.gitRunner);

  return {
    add: async (request: Readonly<{ secret: boolean; target: string }>) => {
      return addSyncTarget(request, {
        cwd,
        environment,
        git,
      });
    },
    forget: async (request: Readonly<{ target: string }>) => {
      return forgetSyncTarget(request, {
        cwd,
        environment,
        git,
      });
    },
    init: async (
      request: Readonly<{
        identityFile?: string;
        recipients: readonly string[];
        repository?: string;
      }>,
    ) => {
      return initializeSync(request, {
        environment,
        git,
      });
    },
    pull: async (request: Readonly<{ dryRun: boolean }>) => {
      return pullSync(request, {
        environment,
        git,
      });
    },
    push: async (request: Readonly<{ dryRun: boolean }>) => {
      return pushSync(request, {
        environment,
        git,
      });
    },
    set: async (
      request: Readonly<{
        recursive: boolean;
        state: "ignore" | "normal" | "secret";
        target: string;
      }>,
    ) => {
      return setSyncTargetMode(request, {
        cwd,
        environment,
        git,
      });
    },
  };
};
