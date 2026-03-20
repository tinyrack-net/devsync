import {
  resolveSyncArtifactsDirectoryPath,
  resolveSyncConfigFilePath,
} from "#app/config/sync.ts";
import {
  resolveDevsyncSyncDirectory,
  resolveHomeDirectory,
} from "#app/config/xdg.ts";

import { type CryptoPort, createCryptoPort } from "./crypto.ts";
import { createFilesystemPort, type FilesystemPort } from "./filesystem.ts";
import {
  createGitService,
  ensureGitRepository,
  type GitPort,
  type GitRunner,
} from "./git.ts";

export type SyncPaths = Readonly<{
  artifactsDirectory: string;
  configPath: string;
  homeDirectory: string;
  syncDirectory: string;
}>;

export type SyncPorts = Readonly<{
  crypto: CryptoPort;
  filesystem: FilesystemPort;
  git: GitPort;
}>;

export type SyncContext = Readonly<{
  cwd: string;
  environment: NodeJS.ProcessEnv;
  paths: SyncPaths;
  ports: SyncPorts;
}>;

export type CreateSyncContextDependencies = Readonly<{
  cwd?: string;
  environment?: NodeJS.ProcessEnv;
  gitRunner?: GitRunner;
  ports?: Partial<SyncPorts>;
}>;

export const createSyncPaths = (
  environment: NodeJS.ProcessEnv = process.env,
): SyncPaths => {
  const syncDirectory = resolveDevsyncSyncDirectory(environment);

  return {
    artifactsDirectory: resolveSyncArtifactsDirectoryPath(syncDirectory),
    configPath: resolveSyncConfigFilePath(syncDirectory),
    homeDirectory: resolveHomeDirectory(environment),
    syncDirectory,
  };
};

export const createSyncContext = (
  dependencies: CreateSyncContextDependencies = {},
): SyncContext => {
  const environment = dependencies.environment ?? process.env;

  return {
    cwd: dependencies.cwd ?? process.cwd(),
    environment,
    paths: createSyncPaths(environment),
    ports: {
      crypto: dependencies.ports?.crypto ?? createCryptoPort(),
      filesystem: dependencies.ports?.filesystem ?? createFilesystemPort(),
      git: dependencies.ports?.git ?? createGitService(dependencies.gitRunner),
    },
  };
};

export const ensureSyncRepository = async (
  context: Pick<SyncContext, "paths" | "ports">,
) => {
  await ensureGitRepository(context.paths.syncDirectory, context.ports.git);
};
