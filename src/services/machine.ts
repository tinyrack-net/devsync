import {
  formatGlobalDevsyncConfig,
  readGlobalDevsyncConfig,
} from "#app/config/global-config.ts";
import {
  collectAllMachineNames,
  normalizeSyncMachineName,
  readSyncConfig,
} from "#app/config/sync.ts";

import {
  createSyncConfigDocument,
  writeValidatedSyncConfig,
} from "./config-file.ts";
import { DevsyncError } from "./error.ts";
import { writeTextFileAtomically } from "./filesystem.ts";
import { resolveTrackedEntry } from "./paths.ts";
import { ensureSyncRepository, type SyncContext } from "./runtime.ts";

export type SyncMachineAssignment = Readonly<{
  entryLocalPath: string;
  entryRepoPath: string;
  machines: readonly string[];
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
  warning?: string;
}>;

type SyncMachineAssignRequest = Readonly<{
  machines: readonly string[];
  target: string;
}>;

type SyncMachineAssignResult = Readonly<{
  action: "assigned" | "unchanged";
  configPath: string;
  entryRepoPath: string;
  machines: readonly string[];
  syncDirectory: string;
}>;

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
    assignments: syncConfig.entries
      .filter((entry) => entry.machinesExplicit && entry.machines.length > 0)
      .map((entry) => ({
        entryLocalPath: entry.localPath,
        entryRepoPath: entry.repoPath,
        machines: entry.machines,
      }))
      .sort((left, right) =>
        left.entryRepoPath.localeCompare(right.entryRepoPath),
      ),
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

  const syncConfig = await readSyncConfig(
    context.paths.syncDirectory,
    context.environment,
  );
  const knownMachines = collectAllMachineNames(syncConfig.entries);
  const warning = knownMachines.includes(normalizedMachine)
    ? undefined
    : `Machine '${normalizedMachine}' is not referenced by any tracked entry.`;

  await writeTextFileAtomically(
    context.paths.globalConfigPath,
    formatGlobalDevsyncConfig({
      activeMachine: normalizedMachine,
      version: 3,
    }),
  );

  return {
    activeMachine: normalizedMachine,
    globalConfigPath: context.paths.globalConfigPath,
    mode: "use",
    machine: normalizedMachine,
    syncDirectory: context.paths.syncDirectory,
    ...(warning !== undefined ? { warning } : {}),
  };
};

export const clearSyncMachines = async (
  context: SyncContext,
): Promise<SyncMachineUpdateResult> => {
  await ensureSyncRepository(context);

  await writeTextFileAtomically(
    context.paths.globalConfigPath,
    formatGlobalDevsyncConfig({ version: 3 }),
  );

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
      hint: "Pass a tracked entry path, for example 'devsync track ~/.gitconfig --machine default --machine work'.",
    });
  }

  await ensureSyncRepository(context);

  const config = await readSyncConfig(
    context.paths.syncDirectory,
    context.environment,
  );
  const entry = resolveTrackedEntry(target, config.entries, context);

  if (entry === undefined) {
    throw new DevsyncError(`No tracked sync entry matches: ${target}`, {
      code: "TARGET_NOT_TRACKED",
      hint: "Track the root first with 'devsync track'.",
    });
  }

  const normalizedMachines = request.machines.map((m) =>
    normalizeSyncMachineName(m),
  );

  if (
    entry.machines.length === normalizedMachines.length &&
    normalizedMachines.every((m) => entry.machines.includes(m))
  ) {
    return {
      action: "unchanged",
      configPath: context.paths.configPath,
      entryRepoPath: entry.repoPath,
      machines: normalizedMachines,
      syncDirectory: context.paths.syncDirectory,
    };
  }

  const nextConfig = createSyncConfigDocument({
    ...config,
    entries: config.entries.map((e) => {
      if (e.repoPath !== entry.repoPath) {
        return e;
      }

      return {
        ...e,
        machines: normalizedMachines,
        machinesExplicit: normalizedMachines.length > 0,
      };
    }),
  });

  await writeValidatedSyncConfig(
    context.paths.syncDirectory,
    nextConfig,
    context.environment,
  );

  return {
    action: "assigned",
    configPath: context.paths.configPath,
    entryRepoPath: entry.repoPath,
    machines: normalizedMachines,
    syncDirectory: context.paths.syncDirectory,
  };
};
