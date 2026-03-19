import { addSyncTarget } from "./add.ts";
import { forgetSyncTarget } from "./forget.ts";
import { createGitService, type GitRunner } from "./git.ts";
import { initializeSync } from "./init.ts";
import { pullSync } from "./pull.ts";
import { pushSync } from "./push.ts";

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
    add: (request: Readonly<{ secret: boolean; target: string }>) => {
      return addSyncTarget(request, {
        cwd,
        environment,
        git,
      });
    },
    forget: (request: Readonly<{ target: string }>) => {
      return forgetSyncTarget(request, {
        cwd,
        environment,
        git,
      });
    },
    init: (
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
    pull: (request: Readonly<{ dryRun: boolean }>) => {
      return pullSync(request, {
        environment,
        git,
      });
    },
    push: (request: Readonly<{ dryRun: boolean }>) => {
      return pushSync(request, {
        environment,
        git,
      });
    },
  };
};
