import {
  formatGlobalDevsyncConfig,
  type GlobalDevsyncConfig,
  readGlobalDevsyncConfig,
} from "#app/config/global-config.ts";
import {
  collectAllMachineNames,
  normalizeSyncMachineName,
  normalizeSyncOverridePath,
  type ResolvedSyncConfig,
  readSyncConfig,
} from "#app/config/sync.ts";

import {
  createSyncConfigDocument,
  writeValidatedSyncConfig,
} from "./config-file.ts";
import { DevsyncError } from "./error.ts";
import { writeTextFileAtomically } from "./filesystem.ts";
import {
  isExplicitLocalPath,
  resolveCommandTargetPath,
  tryNormalizeRepoPathInput,
} from "./paths.ts";
import { ensureSyncRepository, type SyncContext } from "./runtime.ts";

export type SyncMachineAssignment = Readonly<{
  entryLocalPath: string;
  entryRepoPath: string;
  machines: readonly string[];
  path: string;
}>;

export type SyncMachineListResult = Readonly<{
  activeMachine?: string;
  activeMachinesMode: "none" | "single";
  assignments: readonly SyncMachineAssignment[];
  availableMachines: readonly string[];
  globalConfigExists: boolean;
  globalConfigPath: string;
  syncDirectory: string;
}>;

export type SyncMachineUpdateResult = Readonly<{
  activeMachine?: string;
  globalConfigPath: string;
  mode: "clear" | "use";
  machine?: string;
  syncDirectory: string;
}>;

export type SyncMachineAssignRequest = Readonly<{
  machines: readonly string[];
  path?: string;
  target: string;
}>;

export type SyncMachineAssignResult = Readonly<{
  action: "assigned" | "unchanged";
  configPath: string;
  entryRepoPath: string;
  machines: readonly string[];
  path: string;
  syncDirectory: string;
}>;

export type SyncMachineUnassignRequest = Readonly<{
  machines: readonly string[];
  path?: string;
  target: string;
}>;

export type SyncMachineUnassignResult = Readonly<{
  action: "removed" | "unchanged";
  configPath: string;
  entryRepoPath: string;
  machines: readonly string[];
  path: string;
  syncDirectory: string;
}>;

const findExactTrackedEntry = (
  config: ResolvedSyncConfig,
  target: string,
  context: Pick<SyncContext, "cwd" | "environment">,
) => {
  const trimmedTarget = target.trim();
  const resolvedTargetPath = resolveCommandTargetPath(
    trimmedTarget,
    context.environment,
    context.cwd,
  );
  const byLocalPath = config.entries.filter((entry) => {
    return entry.localPath === resolvedTargetPath;
  });

  if (byLocalPath.length > 0 || isExplicitLocalPath(trimmedTarget)) {
    return byLocalPath;
  }

  const normalizedRepoPath = tryNormalizeRepoPathInput(trimmedTarget);

  if (normalizedRepoPath === undefined) {
    return [];
  }

  return config.entries.filter((entry) => {
    return entry.repoPath === normalizedRepoPath;
  });
};

const collectAssignments = (
  config: ResolvedSyncConfig,
): SyncMachineAssignment[] => {
  const assignments: SyncMachineAssignment[] = [];

  for (const entry of config.entries) {
    for (const [path, machines] of Object.entries(entry.machines)) {
      assignments.push({
        entryLocalPath: entry.localPath,
        entryRepoPath: entry.repoPath,
        machines,
        path: path === "" ? entry.repoPath : `${entry.repoPath}/${path}`,
      });
    }
  }

  return assignments.sort((left, right) => left.path.localeCompare(right.path));
};

const writeGlobalConfig = async (
  configPath: string,
  config: GlobalDevsyncConfig,
) => {
  await writeTextFileAtomically(configPath, formatGlobalDevsyncConfig(config));
};

export const listSyncMachines = async (
  context: SyncContext,
): Promise<SyncMachineListResult> => {
  await ensureSyncRepository(context);

  const [globalConfig, syncConfig] = await Promise.all([
    readGlobalDevsyncConfig(context.environment),
    readSyncConfig(context.paths.syncDirectory, context.environment),
  ]);

  return {
    ...(globalConfig?.activeMachine === undefined
      ? {}
      : { activeMachine: globalConfig.activeMachine }),
    activeMachinesMode:
      globalConfig?.activeMachine === undefined ? "none" : "single",
    assignments: collectAssignments(syncConfig),
    availableMachines: collectAllMachineNames(syncConfig.entries),
    globalConfigExists: globalConfig !== undefined,
    globalConfigPath: context.paths.globalConfigPath,
    syncDirectory: context.paths.syncDirectory,
  };
};

export const useSyncMachine = async (
  machine: string,
  context: SyncContext,
): Promise<SyncMachineUpdateResult> => {
  const normalizedMachine = normalizeSyncMachineName(machine);

  await ensureSyncRepository(context);

  const existing = await readGlobalDevsyncConfig(context.environment);
  await writeGlobalConfig(context.paths.globalConfigPath, {
    ...(existing?.age === undefined ? {} : { age: existing.age }),
    activeMachine: normalizedMachine,
    version: 2,
  });

  return {
    activeMachine: normalizedMachine,
    globalConfigPath: context.paths.globalConfigPath,
    mode: "use",
    machine: normalizedMachine,
    syncDirectory: context.paths.syncDirectory,
  };
};

export const clearSyncMachines = async (
  context: SyncContext,
): Promise<SyncMachineUpdateResult> => {
  await ensureSyncRepository(context);

  const existing = await readGlobalDevsyncConfig(context.environment);
  await writeGlobalConfig(context.paths.globalConfigPath, {
    ...(existing?.age === undefined ? {} : { age: existing.age }),
    version: 2,
  });

  return {
    globalConfigPath: context.paths.globalConfigPath,
    mode: "clear",
    syncDirectory: context.paths.syncDirectory,
  };
};

export const assignSyncMachines = async (
  request: SyncMachineAssignRequest,
  context: SyncContext,
): Promise<SyncMachineAssignResult> => {
  const target = request.target.trim();

  if (target.length === 0) {
    throw new DevsyncError("Target path is required.", {
      code: "TARGET_REQUIRED",
      hint: "Pass a tracked entry path, for example 'devsync machine assign ~/.config/zsh default work --path secrets.zsh'.",
    });
  }

  if (request.machines.length === 0) {
    throw new DevsyncError("At least one machine name is required.", {
      code: "MACHINE_REQUIRED",
      hint: "Pass one or more machine names after the target.",
    });
  }

  await ensureSyncRepository(context);

  const config = await readSyncConfig(
    context.paths.syncDirectory,
    context.environment,
  );
  const matches = findExactTrackedEntry(config, target, context);

  if (matches.length > 1) {
    throw new DevsyncError(`Multiple tracked sync entries match: ${target}`, {
      code: "TARGET_CONFLICT",
      hint: "Use an explicit local path to choose the tracked root.",
    });
  }

  const entry = matches[0];

  if (entry === undefined) {
    throw new DevsyncError(`No tracked sync entry matches: ${target}`, {
      code: "TARGET_NOT_TRACKED",
      hint: "Track the root first with 'devsync track'.",
    });
  }

  const normalizedMachines = request.machines.map((m) =>
    normalizeSyncMachineName(m),
  );
  const machineKey =
    entry.kind === "file"
      ? ""
      : (() => {
          if (request.path === undefined || request.path.trim().length === 0) {
            throw new DevsyncError(
              "A child path is required for directory entries.",
              {
                code: "PATH_REQUIRED",
                hint: "Use --path to specify which child path within the directory to assign machines to.",
              },
            );
          }

          return normalizeSyncOverridePath(request.path, "Machine path");
        })();

  const existingMachines = entry.machines[machineKey];
  const displayPath =
    machineKey === "" ? entry.repoPath : `${entry.repoPath}/${machineKey}`;

  if (
    existingMachines !== undefined &&
    existingMachines.length === normalizedMachines.length &&
    normalizedMachines.every((m) => existingMachines.includes(m))
  ) {
    return {
      action: "unchanged",
      configPath: context.paths.configPath,
      entryRepoPath: entry.repoPath,
      machines: normalizedMachines,
      path: displayPath,
      syncDirectory: context.paths.syncDirectory,
    };
  }

  const nextMachines = {
    ...entry.machines,
    [machineKey]: normalizedMachines,
  };
  const nextConfig = createSyncConfigDocument({
    ...config,
    entries: config.entries.map((e) => {
      if (e.repoPath !== entry.repoPath) {
        return e;
      }

      return { ...e, machines: nextMachines };
    }),
  });

  await writeValidatedSyncConfig(context.paths.syncDirectory, nextConfig, {
    environment: context.environment,
  });

  return {
    action: "assigned",
    configPath: context.paths.configPath,
    entryRepoPath: entry.repoPath,
    machines: normalizedMachines,
    path: displayPath,
    syncDirectory: context.paths.syncDirectory,
  };
};

export const unassignSyncMachines = async (
  request: SyncMachineUnassignRequest,
  context: SyncContext,
): Promise<SyncMachineUnassignResult> => {
  const target = request.target.trim();

  if (target.length === 0) {
    throw new DevsyncError("Target path is required.", {
      code: "TARGET_REQUIRED",
      hint: "Pass a tracked entry path.",
    });
  }

  if (request.machines.length === 0) {
    throw new DevsyncError("At least one machine name is required.", {
      code: "MACHINE_REQUIRED",
      hint: "Pass one or more machine names to remove.",
    });
  }

  await ensureSyncRepository(context);

  const config = await readSyncConfig(
    context.paths.syncDirectory,
    context.environment,
  );
  const matches = findExactTrackedEntry(config, target, context);

  if (matches.length > 1) {
    throw new DevsyncError(`Multiple tracked sync entries match: ${target}`, {
      code: "TARGET_CONFLICT",
      hint: "Use an explicit local path to choose the tracked root.",
    });
  }

  const entry = matches[0];

  if (entry === undefined) {
    throw new DevsyncError(`No tracked sync entry matches: ${target}`, {
      code: "TARGET_NOT_TRACKED",
      hint: "Track the root first with 'devsync track'.",
    });
  }

  const normalizedMachines = request.machines.map((m) =>
    normalizeSyncMachineName(m),
  );
  const machineKey =
    entry.kind === "file"
      ? ""
      : (() => {
          if (request.path === undefined || request.path.trim().length === 0) {
            throw new DevsyncError(
              "A child path is required for directory entries.",
              {
                code: "PATH_REQUIRED",
                hint: "Use --path to specify which child path within the directory to unassign machines from.",
              },
            );
          }

          return normalizeSyncOverridePath(request.path, "Machine path");
        })();

  const existingMachines = entry.machines[machineKey];
  const displayPath =
    machineKey === "" ? entry.repoPath : `${entry.repoPath}/${machineKey}`;

  if (existingMachines === undefined) {
    return {
      action: "unchanged",
      configPath: context.paths.configPath,
      entryRepoPath: entry.repoPath,
      machines: [],
      path: displayPath,
      syncDirectory: context.paths.syncDirectory,
    };
  }

  const remaining = existingMachines.filter(
    (m) => !normalizedMachines.includes(m),
  );

  if (remaining.length === existingMachines.length) {
    return {
      action: "unchanged",
      configPath: context.paths.configPath,
      entryRepoPath: entry.repoPath,
      machines: [...existingMachines],
      path: displayPath,
      syncDirectory: context.paths.syncDirectory,
    };
  }

  const nextMachines = { ...entry.machines };

  if (remaining.length === 0) {
    delete nextMachines[machineKey];
  } else {
    nextMachines[machineKey] = remaining;
  }

  const nextConfig = createSyncConfigDocument({
    ...config,
    entries: config.entries.map((e) => {
      if (e.repoPath !== entry.repoPath) {
        return e;
      }

      return { ...e, machines: nextMachines };
    }),
  });

  await writeValidatedSyncConfig(context.paths.syncDirectory, nextConfig, {
    environment: context.environment,
  });

  return {
    action: "removed",
    configPath: context.paths.configPath,
    entryRepoPath: entry.repoPath,
    machines: remaining,
    path: displayPath,
    syncDirectory: context.paths.syncDirectory,
  };
};
