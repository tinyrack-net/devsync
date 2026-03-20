import { addSyncTarget } from "./add.ts";
import { forgetSyncTarget } from "./forget.ts";
import { initializeSync } from "./init.ts";
import { pullSync } from "./pull.ts";
import { pushSync } from "./push.ts";
import {
  type CreateSyncContextDependencies,
  createSyncContext,
} from "./runtime.ts";
import { setSyncTargetMode } from "./set.ts";

export const createSyncManager = (
  dependencies: CreateSyncContextDependencies = {},
) => {
  const createContext = (cwd = dependencies.cwd) => {
    return createSyncContext({
      ...dependencies,
      cwd,
    });
  };

  return {
    add: async (request: Readonly<{ secret: boolean; target: string }>) => {
      return addSyncTarget(request, createContext());
    },
    forget: async (request: Readonly<{ target: string }>) => {
      return forgetSyncTarget(request, createContext());
    },
    init: async (
      request: Readonly<{
        identityFile?: string;
        recipients: readonly string[];
        repository?: string;
      }>,
    ) => {
      return initializeSync(request, createContext());
    },
    pull: async (request: Readonly<{ dryRun: boolean }>) => {
      return pullSync(request, createContext());
    },
    push: async (request: Readonly<{ dryRun: boolean }>) => {
      return pushSync(request, createContext());
    },
    set: async (
      request: Readonly<{
        recursive: boolean;
        state: "ignore" | "normal" | "secret";
        target: string;
      }>,
    ) => {
      return setSyncTargetMode(request, createContext());
    },
  };
};
