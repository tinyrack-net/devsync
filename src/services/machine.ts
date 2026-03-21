import {
  formatGlobalDevsyncConfig,
  type GlobalDevsyncConfig,
  readGlobalDevsyncConfig,
} from "#app/config/global-config.ts";
import { normalizeSyncMachineName, readSyncConfig } from "#app/config/sync.ts";

import { writeTextFileAtomically } from "./filesystem.ts";
import { ensureSyncRepository, type SyncContext } from "./runtime.ts";

export type SyncMachineListResult = Readonly<{
  activeMachine?: string;
  activeMachinesMode: "none" | "single";
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

const buildMachineList = (
  config: Awaited<ReturnType<typeof readSyncConfig>>,
) => {
  return [
    ...new Set(
      config.entries
        .map((entry) => entry.machine)
        .filter((machine): machine is string => machine !== undefined),
    ),
  ].sort((left, right) => {
    return left.localeCompare(right);
  });
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
    availableMachines: buildMachineList(syncConfig),
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
  await writeGlobalConfig(context.paths.globalConfigPath, {
    activeMachine: normalizedMachine,
    version: 1,
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
  await writeGlobalConfig(context.paths.globalConfigPath, {
    version: 1,
  });

  return {
    globalConfigPath: context.paths.globalConfigPath,
    mode: "clear",
    syncDirectory: context.paths.syncDirectory,
  };
};
