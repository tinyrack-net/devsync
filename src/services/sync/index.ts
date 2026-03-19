import { randomUUID } from "node:crypto";
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, posix, relative, resolve } from "node:path";

import { z } from "zod";

import {
  createInitialSyncConfig,
  formatSyncConfig,
  matchesSecretGlob,
  normalizeSyncRepoPath,
  parseSyncConfig,
  type ResolvedSyncConfig,
  type ResolvedSyncConfigEntry,
  readSyncConfig,
  resolveSyncConfigFilePath,
  resolveSyncPlainDirectoryPath,
  resolveSyncSecretDirectoryPath,
  type SyncConfig,
  type SyncConfigEntryKind,
} from "#app/config/sync.ts";
import {
  expandConfiguredPath,
  resolveConfiguredAbsolutePath,
  resolveDevtoolsSyncDirectory,
  resolveXdgConfigHome,
} from "#app/config/xdg.ts";
import { ensureTrailingNewline } from "#app/lib/string.ts";
import {
  formatInputIssues,
  trimmedOptionalStringSchema,
} from "#app/lib/validation.ts";
import {
  createAgeIdentityFile,
  decryptSecretFile,
  encryptSecretFile,
  readAgeRecipientsFromIdentityFile,
} from "./crypto.ts";
import { createGitService, type GitRunner } from "./git.ts";

type SyncInitRequest = Readonly<{
  identityFile?: string;
  recipients: readonly string[];
  repository?: string;
}>;

type SyncRunRequest = Readonly<{
  dryRun: boolean;
}>;

type SyncAddRequest = Readonly<{
  secret: boolean;
  target: string;
}>;

type SyncForgetRequest = Readonly<{
  target: string;
}>;

type SyncInitResult = Readonly<{
  alreadyInitialized: boolean;
  configPath: string;
  entryCount: number;
  gitAction: "cloned" | "existing" | "initialized";
  gitSource?: string;
  identityFile: string;
  generatedIdentity: boolean;
  recipientCount: number;
  secretGlobCount: number;
  syncDirectory: string;
}>;

type SyncPushResult = Readonly<{
  configPath: string;
  deletedArtifactCount: number;
  directoryCount: number;
  dryRun: boolean;
  encryptedFileCount: number;
  plainFileCount: number;
  symlinkCount: number;
  syncDirectory: string;
}>;

type SyncPullResult = Readonly<{
  configPath: string;
  decryptedFileCount: number;
  deletedLocalCount: number;
  directoryCount: number;
  dryRun: boolean;
  plainFileCount: number;
  symlinkCount: number;
  syncDirectory: string;
}>;

type SyncAddResult = Readonly<{
  alreadyTracked: boolean;
  configPath: string;
  kind: SyncConfigEntryKind;
  localPath: string;
  repoPath: string;
  secretGlobAdded: boolean;
  syncDirectory: string;
}>;

type SyncForgetResult = Readonly<{
  configPath: string;
  localPath: string;
  plainArtifactCount: number;
  repoPath: string;
  secretArtifactCount: number;
  secretGlobRemoved: boolean;
  syncDirectory: string;
}>;

type SnapshotNode =
  | Readonly<{
      type: "directory";
    }>
  | Readonly<{
      executable: boolean;
      secret: boolean;
      type: "file";
      contents: Uint8Array;
    }>
  | Readonly<{
      linkTarget: string;
      type: "symlink";
    }>;

type FileSnapshotNode = Extract<SnapshotNode, Readonly<{ type: "file" }>>;
type FileLikeSnapshotNode = Extract<
  SnapshotNode,
  Readonly<{ type: "file" | "symlink" }>
>;

type RepoArtifact =
  | Readonly<{
      category: "plain";
      kind: "directory";
      repoPath: string;
    }>
  | Readonly<{
      category: "plain";
      kind: "file";
      repoPath: string;
      contents: Uint8Array;
      executable: boolean;
    }>
  | Readonly<{
      category: "plain";
      kind: "symlink";
      repoPath: string;
      linkTarget: string;
    }>
  | Readonly<{
      category: "secret";
      kind: "file";
      repoPath: string;
      contents: string;
      executable: boolean;
    }>;

type EntryMaterialization =
  | Readonly<{
      desiredKeys: ReadonlySet<string>;
      type: "absent";
    }>
  | Readonly<{
      desiredKeys: ReadonlySet<string>;
      node: FileLikeSnapshotNode;
      type: "file";
    }>
  | Readonly<{
      desiredKeys: ReadonlySet<string>;
      nodes: ReadonlyMap<string, FileLikeSnapshotNode>;
      type: "directory";
    }>;

type SyncConfigDocumentEntry = SyncConfig["entries"][number];

const initCommandSchema = z.object({
  options: z.object({
    identity: trimmedOptionalStringSchema,
    recipient: z
      .array(z.string())
      .optional()
      .transform((value) => {
        return (value ?? [])
          .map((recipient) => recipient.trim())
          .filter(Boolean);
      }),
  }),
  repository: trimmedOptionalStringSchema,
});

const syncCommandSchema = z.object({
  options: z.object({
    dryRun: z.boolean(),
  }),
});

const addCommandSchema = z.object({
  options: z.object({
    secret: z.boolean(),
  }),
  target: z.string().trim().min(1, "Target path is required."),
});

const forgetCommandSchema = z.object({
  target: z.string().trim().min(1, "Target path is required."),
});

const defaultSyncIdentityFile = "$XDG_CONFIG_HOME/devtools/age/keys.txt";

export class SyncError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SyncError";
  }
}

const pathExists = async (path: string) => {
  try {
    await access(path);

    return true;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
};

const getPathStats = async (path: string) => {
  try {
    return await lstat(path);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
};

const listDirectoryEntries = async (path: string) => {
  const entries = await readdir(path, { withFileTypes: true });

  return entries.sort((left, right) => {
    return left.name.localeCompare(right.name);
  });
};

const buildArtifactKey = (artifact: RepoArtifact) => {
  return artifact.kind === "directory"
    ? `${artifact.category}:${artifact.repoPath}/`
    : `${artifact.category}:${artifact.repoPath}`;
};

const buildDirectoryKey = (repoPath: string) => {
  return `${repoPath}/`;
};

const buildExecutableMode = (executable: boolean) => {
  return executable ? 0o755 : 0o644;
};

const isPathEqualOrNested = (path: string, rootPath: string) => {
  const rootToPath = relative(rootPath, path);

  return (
    rootToPath === "" || (!rootToPath.startsWith("..") && rootToPath !== "..")
  );
};

const doPathsOverlap = (leftPath: string, rightPath: string) => {
  return (
    isPathEqualOrNested(leftPath, rightPath) ||
    isPathEqualOrNested(rightPath, leftPath)
  );
};

const resolveCommandTargetPath = (
  target: string,
  environment: NodeJS.ProcessEnv,
  cwd: string,
) => {
  return resolve(cwd, expandConfiguredPath(target, environment));
};

const buildRepoPathWithinRoot = (
  absolutePath: string,
  rootPath: string,
  description: string,
) => {
  const relativePath = relative(rootPath, absolutePath);

  if (relativePath === "") {
    throw new SyncError(
      `${description} must be inside ${rootPath}, not the root itself: ${absolutePath}`,
    );
  }

  if (relativePath.startsWith("..") || relativePath === "..") {
    throw new SyncError(
      `${description} must be inside ${rootPath}: ${absolutePath}`,
    );
  }

  return normalizeSyncRepoPath(relativePath);
};

const buildConfiguredXdgLocalPath = (repoPath: string) => {
  return `$XDG_CONFIG_HOME/${repoPath}`;
};

const createSyncConfigDocumentEntry = (
  entry: Pick<
    ResolvedSyncConfigEntry,
    "configuredLocalPath" | "kind" | "name" | "repoPath"
  >,
): SyncConfigDocumentEntry => {
  return {
    kind: entry.kind,
    localPath: entry.configuredLocalPath,
    name: entry.name,
    repoPath: entry.repoPath,
  };
};

const createSyncConfigDocument = (config: ResolvedSyncConfig): SyncConfig => {
  return {
    version: 1,
    age: {
      identityFile: config.age.configuredIdentityFile,
      recipients: [...config.age.recipients],
    },
    entries: config.entries.map((entry) => {
      return createSyncConfigDocumentEntry(entry);
    }),
    secretGlobs: [...config.secretGlobs],
  };
};

const sortSyncConfigEntries = (entries: readonly SyncConfigDocumentEntry[]) => {
  return [...entries].sort((left, right) => {
    return left.repoPath.localeCompare(right.repoPath);
  });
};

const sortSecretGlobs = (secretGlobs: readonly string[]) => {
  return [...secretGlobs].sort((left, right) => {
    return left.localeCompare(right);
  });
};

const buildCanonicalSecretGlob = (entry: {
  kind: SyncConfigEntryKind;
  repoPath: string;
}) => {
  return entry.kind === "directory" ? `${entry.repoPath}/**` : entry.repoPath;
};

const tryNormalizeRepoPathInput = (value: string) => {
  try {
    return normalizeSyncRepoPath(value);
  } catch {
    return undefined;
  }
};

const addCanonicalSecretGlob = (
  secretGlobs: readonly string[],
  entry: {
    kind: SyncConfigEntryKind;
    repoPath: string;
  },
) => {
  const canonicalSecretGlob = buildCanonicalSecretGlob(entry);

  if (secretGlobs.includes(canonicalSecretGlob)) {
    return {
      added: false,
      secretGlobs: sortSecretGlobs(secretGlobs),
    };
  }

  return {
    added: true,
    secretGlobs: sortSecretGlobs([...secretGlobs, canonicalSecretGlob]),
  };
};

const removeCanonicalSecretGlob = (
  secretGlobs: readonly string[],
  entry: {
    kind: SyncConfigEntryKind;
    repoPath: string;
  },
) => {
  const canonicalSecretGlob = buildCanonicalSecretGlob(entry);
  const nextSecretGlobs = secretGlobs.filter((glob) => {
    return glob !== canonicalSecretGlob;
  });

  return {
    removed: nextSecretGlobs.length !== secretGlobs.length,
    secretGlobs: sortSecretGlobs(nextSecretGlobs),
  };
};

const isExecutableMode = (mode: number | bigint) => {
  return (Number(mode) & 0o111) !== 0;
};

const addSnapshotNode = (
  snapshot: Map<string, SnapshotNode>,
  repoPath: string,
  node: SnapshotNode,
) => {
  if (snapshot.has(repoPath)) {
    throw new SyncError(`Duplicate sync path generated for ${repoPath}`);
  }

  snapshot.set(repoPath, node);
};

const findOwningEntry = (
  config: ResolvedSyncConfig,
  repoPath: string,
): ResolvedSyncConfigEntry | undefined => {
  return config.entries.find((entry) => {
    return (
      entry.repoPath === repoPath ||
      (entry.kind === "directory" && repoPath.startsWith(`${entry.repoPath}/`))
    );
  });
};

const addLocalNode = async (
  snapshot: Map<string, SnapshotNode>,
  config: ResolvedSyncConfig,
  repoPath: string,
  path: string,
  stats: Awaited<ReturnType<typeof lstat>>,
) => {
  if (stats.isDirectory()) {
    throw new SyncError(
      `Expected a file-like path but found a directory: ${path}`,
    );
  }

  if (stats.isSymbolicLink()) {
    if (matchesSecretGlob(config, repoPath)) {
      throw new SyncError(
        `Secret sync paths must be regular files, not symlinks: ${repoPath}`,
      );
    }

    addSnapshotNode(snapshot, repoPath, {
      linkTarget: await readlink(path),
      type: "symlink",
    });

    return;
  }

  if (!stats.isFile()) {
    throw new SyncError(`Unsupported filesystem entry: ${path}`);
  }

  addSnapshotNode(snapshot, repoPath, {
    contents: await readFile(path),
    executable: isExecutableMode(stats.mode),
    secret: matchesSecretGlob(config, repoPath),
    type: "file",
  });
};

const walkLocalDirectory = async (
  snapshot: Map<string, SnapshotNode>,
  config: ResolvedSyncConfig,
  localDirectory: string,
  repoPathPrefix: string,
) => {
  const entries = await listDirectoryEntries(localDirectory);

  for (const entry of entries) {
    const localPath = join(localDirectory, entry.name);
    const repoPath = posix.join(repoPathPrefix, entry.name);
    const stats = await lstat(localPath);

    if (stats.isDirectory()) {
      await walkLocalDirectory(snapshot, config, localPath, repoPath);
      continue;
    }

    await addLocalNode(snapshot, config, repoPath, localPath, stats);
  }
};

const buildLocalSnapshot = async (config: ResolvedSyncConfig) => {
  const snapshot = new Map<string, SnapshotNode>();

  for (const entry of config.entries) {
    const stats = await getPathStats(entry.localPath);

    if (stats === undefined) {
      continue;
    }

    if (entry.kind === "file") {
      if (stats.isDirectory()) {
        throw new SyncError(
          `Sync entry ${entry.name} expects a file, but found a directory: ${entry.localPath}`,
        );
      }

      await addLocalNode(
        snapshot,
        config,
        entry.repoPath,
        entry.localPath,
        stats,
      );
      continue;
    }

    if (!stats.isDirectory()) {
      throw new SyncError(
        `Sync entry ${entry.name} expects a directory: ${entry.localPath}`,
      );
    }

    addSnapshotNode(snapshot, entry.repoPath, {
      type: "directory",
    });
    await walkLocalDirectory(snapshot, config, entry.localPath, entry.repoPath);
  }

  return snapshot;
};

const buildRepoArtifacts = async (
  snapshot: ReadonlyMap<string, SnapshotNode>,
  config: ResolvedSyncConfig,
) => {
  const artifacts: RepoArtifact[] = [];

  for (const repoPath of [...snapshot.keys()].sort((left, right) => {
    return left.localeCompare(right);
  })) {
    const node = snapshot.get(repoPath);

    if (node === undefined) {
      continue;
    }

    if (node.type === "directory") {
      artifacts.push({
        category: "plain",
        kind: "directory",
        repoPath,
      });
      continue;
    }

    if (node.type === "symlink") {
      artifacts.push({
        category: "plain",
        kind: "symlink",
        linkTarget: node.linkTarget,
        repoPath,
      });
      continue;
    }

    if (!node.secret) {
      artifacts.push({
        category: "plain",
        contents: node.contents,
        executable: node.executable,
        kind: "file",
        repoPath,
      });
      continue;
    }

    artifacts.push({
      category: "secret",
      contents: await encryptSecretFile(node.contents, config.age.recipients),
      executable: node.executable,
      kind: "file",
      repoPath,
    });
  }

  return artifacts;
};

const collectArtifactLeafKeys = async (
  rootDirectory: string,
  category: "plain" | "secret",
  keys: Set<string>,
  prefix?: string,
) => {
  if (!(await pathExists(rootDirectory))) {
    return;
  }

  const entries = await listDirectoryEntries(rootDirectory);

  for (const entry of entries) {
    const absolutePath = join(rootDirectory, entry.name);
    const relativePath =
      prefix === undefined ? entry.name : `${prefix}/${entry.name}`;
    const stats = await lstat(absolutePath);

    if (stats.isDirectory()) {
      await collectArtifactLeafKeys(absolutePath, category, keys, relativePath);
      continue;
    }

    if (category === "secret") {
      if (relativePath.endsWith(".age")) {
        keys.add(`${category}:${relativePath.slice(0, -".age".length)}`);
      } else {
        keys.add(`${category}:${relativePath}`);
      }

      continue;
    }

    keys.add(`${category}:${relativePath}`);
  }
};

const collectExistingArtifactKeys = async (
  syncDirectory: string,
  config: ResolvedSyncConfig,
) => {
  const keys = new Set<string>();
  const plainDirectory = resolveSyncPlainDirectoryPath(syncDirectory);
  const secretDirectory = resolveSyncSecretDirectoryPath(syncDirectory);

  await collectArtifactLeafKeys(plainDirectory, "plain", keys);
  await collectArtifactLeafKeys(secretDirectory, "secret", keys);

  for (const entry of config.entries) {
    if (entry.kind !== "directory") {
      continue;
    }

    const path = join(plainDirectory, ...entry.repoPath.split("/"));
    const stats = await getPathStats(path);

    if (stats?.isDirectory()) {
      keys.add(`plain:${entry.repoPath}/`);
    }
  }

  return keys;
};

const writeFileNode = async (
  path: string,
  node: FileSnapshotNode | Extract<RepoArtifact, Readonly<{ kind: "file" }>>,
) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, node.contents);
  await chmod(path, buildExecutableMode(node.executable));
};

const writeSymlinkNode = async (path: string, linkTarget: string) => {
  await mkdir(dirname(path), { recursive: true });
  await rm(path, { force: true, recursive: true });
  await symlink(linkTarget, path);
};

const writeArtifactsToDirectory = async (
  rootDirectory: string,
  artifacts: readonly RepoArtifact[],
) => {
  await mkdir(rootDirectory, { recursive: true });

  for (const artifact of artifacts) {
    const artifactPath = join(rootDirectory, ...artifact.repoPath.split("/"));

    if (artifact.kind === "directory") {
      await mkdir(artifactPath, { recursive: true });
      continue;
    }

    if (artifact.kind === "symlink") {
      await writeSymlinkNode(artifactPath, artifact.linkTarget);
      continue;
    }

    const targetPath =
      artifact.category === "secret" ? `${artifactPath}.age` : artifactPath;

    await writeFileNode(targetPath, artifact);
  }
};

const replacePathAtomically = async (targetPath: string, nextPath: string) => {
  const backupPath = join(
    dirname(targetPath),
    `.${basename(targetPath)}.devtools-sync-backup-${randomUUID()}`,
  );
  const existingStats = await getPathStats(targetPath);
  let targetMoved = false;

  try {
    if (existingStats !== undefined) {
      await rename(targetPath, backupPath);
      targetMoved = true;
    }

    await rename(nextPath, targetPath);

    if (targetMoved) {
      await rm(backupPath, { force: true, recursive: true });
    }
  } catch (error: unknown) {
    if (targetMoved && !(await pathExists(targetPath))) {
      await rename(backupPath, targetPath).catch(() => {});
    }

    throw error;
  } finally {
    await rm(backupPath, { force: true, recursive: true }).catch(() => {});
  }
};

const removePathAtomically = async (targetPath: string) => {
  const stats = await getPathStats(targetPath);

  if (stats === undefined) {
    return;
  }

  const backupPath = join(
    dirname(targetPath),
    `.${basename(targetPath)}.devtools-sync-remove-${randomUUID()}`,
  );

  await rename(targetPath, backupPath);
  await rm(backupPath, { force: true, recursive: true });
};

const writeTextFileAtomically = async (
  targetPath: string,
  contents: string,
) => {
  await mkdir(dirname(targetPath), { recursive: true });
  const stagingDirectory = await mkdtemp(
    join(dirname(targetPath), `.${basename(targetPath)}.devtools-sync-`),
  );
  const stagedPath = join(stagingDirectory, basename(targetPath));

  try {
    await writeFile(stagedPath, contents, "utf8");
    await replacePathAtomically(targetPath, stagedPath);
  } finally {
    await rm(stagingDirectory, { force: true, recursive: true });
  }
};

const writeValidatedSyncConfig = async (
  syncDirectory: string,
  config: SyncConfig,
  environment: NodeJS.ProcessEnv,
) => {
  const nextConfig = {
    ...config,
    entries: sortSyncConfigEntries(config.entries),
    secretGlobs: sortSecretGlobs(config.secretGlobs),
  } satisfies SyncConfig;

  parseSyncConfig(nextConfig, environment);
  await writeTextFileAtomically(
    resolveSyncConfigFilePath(syncDirectory),
    formatSyncConfig(nextConfig),
  );

  return nextConfig;
};

const buildAddEntryCandidate = async (
  targetPath: string,
  config: ResolvedSyncConfig,
  environment: NodeJS.ProcessEnv,
) => {
  const targetStats = await getPathStats(targetPath);

  if (targetStats === undefined) {
    throw new SyncError(`Sync target does not exist: ${targetPath}`);
  }

  const kind = (() => {
    if (targetStats.isDirectory()) {
      return "directory" as const;
    }

    if (targetStats.isFile() || targetStats.isSymbolicLink()) {
      return "file" as const;
    }

    throw new SyncError(`Unsupported sync target type: ${targetPath}`);
  })();

  const syncDirectory = resolveDevtoolsSyncDirectory(environment);

  if (doPathsOverlap(targetPath, syncDirectory)) {
    throw new SyncError(
      `Sync target must not overlap the sync directory: ${targetPath}`,
    );
  }

  if (doPathsOverlap(targetPath, config.age.identityFile)) {
    throw new SyncError(
      `Sync target must not contain the age identity file: ${targetPath}`,
    );
  }

  const repoPath = buildRepoPathWithinRoot(
    targetPath,
    resolveXdgConfigHome(environment),
    "Sync target",
  );

  return {
    configuredLocalPath: buildConfiguredXdgLocalPath(repoPath),
    kind,
    localPath: targetPath,
    name: repoPath,
    repoPath,
  } satisfies ResolvedSyncConfigEntry;
};

const findMatchingTrackedEntry = (
  config: ResolvedSyncConfig,
  target: string,
  environment: NodeJS.ProcessEnv,
  cwd: string,
) => {
  const resolvedTargetPath = resolveCommandTargetPath(target, environment, cwd);
  const byLocalPath = config.entries.find((entry) => {
    return entry.localPath === resolvedTargetPath;
  });

  if (byLocalPath !== undefined) {
    return byLocalPath;
  }

  const normalizedRepoPath = tryNormalizeRepoPathInput(target.trim());

  if (normalizedRepoPath === undefined) {
    return undefined;
  }

  return config.entries.find((entry) => {
    return entry.repoPath === normalizedRepoPath;
  });
};

const collectRepoArtifactKeys = async (
  targetPath: string,
  category: "plain" | "secret",
  repoPath: string,
  keys: Set<string>,
) => {
  const stats = await getPathStats(targetPath);

  if (stats === undefined) {
    return;
  }

  if (stats.isDirectory()) {
    if (category === "plain") {
      keys.add(`plain:${buildDirectoryKey(repoPath)}`);
    }

    const entries = await listDirectoryEntries(targetPath);

    for (const entry of entries) {
      await collectRepoArtifactKeys(
        join(targetPath, entry.name),
        category,
        posix.join(repoPath, entry.name),
        keys,
      );
    }

    return;
  }

  if (category === "secret") {
    keys.add(
      `secret:${
        repoPath.endsWith(".age") ? repoPath.slice(0, -".age".length) : repoPath
      }`,
    );

    return;
  }

  keys.add(`plain:${repoPath}`);
};

const collectEntryArtifactCounts = async (
  syncDirectory: string,
  entry: ResolvedSyncConfigEntry,
) => {
  const plainKeys = new Set<string>();
  const secretKeys = new Set<string>();
  const plainPath = join(
    resolveSyncPlainDirectoryPath(syncDirectory),
    ...entry.repoPath.split("/"),
  );
  const secretPath =
    entry.kind === "directory"
      ? join(
          resolveSyncSecretDirectoryPath(syncDirectory),
          ...entry.repoPath.split("/"),
        )
      : `${join(resolveSyncSecretDirectoryPath(syncDirectory), ...entry.repoPath.split("/"))}.age`;

  await collectRepoArtifactKeys(plainPath, "plain", entry.repoPath, plainKeys);
  await collectRepoArtifactKeys(
    secretPath,
    "secret",
    entry.kind === "directory" ? entry.repoPath : `${entry.repoPath}.age`,
    secretKeys,
  );

  return {
    plainArtifactCount: plainKeys.size,
    secretArtifactCount: secretKeys.size,
  };
};

const pruneEmptyParentDirectories = async (
  startPath: string,
  rootPath: string,
) => {
  let currentPath = startPath;

  while (
    isPathEqualOrNested(currentPath, rootPath) &&
    currentPath !== rootPath
  ) {
    const stats = await getPathStats(currentPath);

    if (stats === undefined) {
      currentPath = dirname(currentPath);
      continue;
    }

    if (!stats.isDirectory()) {
      break;
    }

    const entries = await readdir(currentPath);

    if (entries.length > 0) {
      break;
    }

    await rm(currentPath, { force: true, recursive: true });
    currentPath = dirname(currentPath);
  }
};

const removeTrackedEntryArtifacts = async (
  syncDirectory: string,
  entry: ResolvedSyncConfigEntry,
) => {
  const plainRoot = resolveSyncPlainDirectoryPath(syncDirectory);
  const secretRoot = resolveSyncSecretDirectoryPath(syncDirectory);
  const plainPath = join(plainRoot, ...entry.repoPath.split("/"));
  const secretPath =
    entry.kind === "directory"
      ? join(secretRoot, ...entry.repoPath.split("/"))
      : `${join(secretRoot, ...entry.repoPath.split("/"))}.age`;

  await removePathAtomically(plainPath);
  await pruneEmptyParentDirectories(dirname(plainPath), plainRoot);
  await removePathAtomically(secretPath);
  await pruneEmptyParentDirectories(dirname(secretPath), secretRoot);
};

const stageAndReplaceFilePath = async (
  targetPath: string,
  node: FileLikeSnapshotNode,
) => {
  await mkdir(dirname(targetPath), { recursive: true });
  const stagingDirectory = await mkdtemp(
    join(dirname(targetPath), `.${basename(targetPath)}.devtools-sync-`),
  );
  const stagedPath = join(stagingDirectory, basename(targetPath));

  try {
    if (node.type === "symlink") {
      await symlink(node.linkTarget, stagedPath);
    } else {
      await writeFileNode(stagedPath, node);
    }

    await replacePathAtomically(targetPath, stagedPath);
  } finally {
    await rm(stagingDirectory, { force: true, recursive: true });
  }
};

const stageAndReplaceDirectoryPath = async (
  targetPath: string,
  nodes: ReadonlyMap<string, FileLikeSnapshotNode>,
) => {
  await mkdir(dirname(targetPath), { recursive: true });
  const stagingDirectory = await mkdtemp(
    join(dirname(targetPath), `.${basename(targetPath)}.devtools-sync-`),
  );

  try {
    for (const relativePath of [...nodes.keys()].sort((left, right) => {
      return left.localeCompare(right);
    })) {
      const node = nodes.get(relativePath);

      if (node === undefined) {
        continue;
      }

      const targetNodePath = join(stagingDirectory, ...relativePath.split("/"));

      if (node.type === "symlink") {
        await writeSymlinkNode(targetNodePath, node.linkTarget);
      } else {
        await writeFileNode(targetNodePath, node);
      }
    }

    await replacePathAtomically(targetPath, stagingDirectory);
  } catch (error: unknown) {
    await rm(stagingDirectory, { force: true, recursive: true }).catch(
      () => {},
    );
    throw error;
  }
};

const buildPushCounts = (snapshot: ReadonlyMap<string, SnapshotNode>) => {
  let directoryCount = 0;
  let encryptedFileCount = 0;
  let plainFileCount = 0;
  let symlinkCount = 0;

  for (const node of snapshot.values()) {
    if (node.type === "directory") {
      directoryCount += 1;
      continue;
    }

    if (node.type === "symlink") {
      symlinkCount += 1;
      continue;
    }

    if (node.secret) {
      encryptedFileCount += 1;
    } else {
      plainFileCount += 1;
    }
  }

  return {
    directoryCount,
    encryptedFileCount,
    plainFileCount,
    symlinkCount,
  };
};

const readPlainSnapshotNode = async (
  absolutePath: string,
  repoPath: string,
  config: ResolvedSyncConfig,
  snapshot: Map<string, SnapshotNode>,
) => {
  const owningEntry = findOwningEntry(config, repoPath);

  if (owningEntry === undefined) {
    throw new SyncError(
      `Unmanaged plain sync path found in repository: ${repoPath}`,
    );
  }

  if (matchesSecretGlob(config, repoPath)) {
    throw new SyncError(
      `Secret sync path is stored in plain text in the repository: ${repoPath}`,
    );
  }

  const stats = await lstat(absolutePath);

  if (stats.isSymbolicLink()) {
    addSnapshotNode(snapshot, repoPath, {
      linkTarget: await readlink(absolutePath),
      type: "symlink",
    });

    return;
  }

  if (!stats.isFile()) {
    throw new SyncError(`Unsupported plain repository entry: ${absolutePath}`);
  }

  addSnapshotNode(snapshot, repoPath, {
    contents: await readFile(absolutePath),
    executable: isExecutableMode(stats.mode),
    secret: false,
    type: "file",
  });
};

const readPlainRepositoryTree = async (
  rootDirectory: string,
  config: ResolvedSyncConfig,
  snapshot: Map<string, SnapshotNode>,
  prefix?: string,
) => {
  if (!(await pathExists(rootDirectory))) {
    return;
  }

  const entries = await listDirectoryEntries(rootDirectory);

  for (const entry of entries) {
    const absolutePath = join(rootDirectory, entry.name);
    const relativePath =
      prefix === undefined ? entry.name : `${prefix}/${entry.name}`;
    const stats = await lstat(absolutePath);

    if (stats.isDirectory()) {
      await readPlainRepositoryTree(
        absolutePath,
        config,
        snapshot,
        relativePath,
      );
      continue;
    }

    await readPlainSnapshotNode(absolutePath, relativePath, config, snapshot);
  }
};

const readSecretRepositoryTree = async (
  rootDirectory: string,
  config: ResolvedSyncConfig,
  snapshot: Map<string, SnapshotNode>,
  prefix?: string,
) => {
  if (!(await pathExists(rootDirectory))) {
    return;
  }

  const entries = await listDirectoryEntries(rootDirectory);

  for (const entry of entries) {
    const absolutePath = join(rootDirectory, entry.name);
    const relativePath =
      prefix === undefined ? entry.name : `${prefix}/${entry.name}`;
    const stats = await lstat(absolutePath);

    if (stats.isDirectory()) {
      await readSecretRepositoryTree(
        absolutePath,
        config,
        snapshot,
        relativePath,
      );
      continue;
    }

    if (stats.isSymbolicLink()) {
      throw new SyncError(
        `Secret repository entries must be regular files, not symlinks: ${relativePath}`,
      );
    }

    if (!stats.isFile()) {
      throw new SyncError(
        `Unsupported secret repository entry: ${absolutePath}`,
      );
    }

    if (!relativePath.endsWith(".age")) {
      throw new SyncError(
        `Secret repository files must end with .age: ${relativePath}`,
      );
    }

    const repoPath = relativePath.slice(0, -".age".length);
    const owningEntry = findOwningEntry(config, repoPath);

    if (owningEntry === undefined) {
      throw new SyncError(
        `Unmanaged secret sync path found in repository: ${repoPath}`,
      );
    }

    if (!matchesSecretGlob(config, repoPath)) {
      throw new SyncError(
        `Secret repository file does not match any secret glob: ${repoPath}`,
      );
    }

    addSnapshotNode(snapshot, repoPath, {
      contents: await decryptSecretFile(
        await readFile(absolutePath, "utf8"),
        config.age.identityFile,
      ),
      executable: isExecutableMode(stats.mode),
      secret: true,
      type: "file",
    });
  }
};

const buildRepositorySnapshot = async (
  syncDirectory: string,
  config: ResolvedSyncConfig,
) => {
  const snapshot = new Map<string, SnapshotNode>();
  const plainDirectory = resolveSyncPlainDirectoryPath(syncDirectory);

  for (const entry of config.entries) {
    if (entry.kind !== "directory") {
      continue;
    }

    const stats = await getPathStats(
      join(plainDirectory, ...entry.repoPath.split("/")),
    );

    if (stats === undefined) {
      continue;
    }

    if (!stats.isDirectory()) {
      throw new SyncError(
        `Directory sync entry is not stored as a directory in the repository: ${entry.repoPath}`,
      );
    }

    addSnapshotNode(snapshot, entry.repoPath, {
      type: "directory",
    });
  }

  await readPlainRepositoryTree(plainDirectory, config, snapshot);
  await readSecretRepositoryTree(
    resolveSyncSecretDirectoryPath(syncDirectory),
    config,
    snapshot,
  );

  return snapshot;
};

const buildEntryMaterialization = (
  entry: ResolvedSyncConfigEntry,
  snapshot: ReadonlyMap<string, SnapshotNode>,
): EntryMaterialization => {
  if (entry.kind === "file") {
    const node = snapshot.get(entry.repoPath);

    if (node === undefined) {
      return {
        desiredKeys: new Set<string>(),
        type: "absent",
      };
    }

    if (node.type === "directory") {
      throw new SyncError(
        `File sync entry resolves to a directory in the repository: ${entry.repoPath}`,
      );
    }

    return {
      desiredKeys: new Set<string>([entry.repoPath]),
      node,
      type: "file",
    };
  }

  const rootNode = snapshot.get(entry.repoPath);

  if (rootNode !== undefined && rootNode.type !== "directory") {
    throw new SyncError(
      `Directory sync entry resolves to a file in the repository: ${entry.repoPath}`,
    );
  }

  const nodes = new Map<string, FileLikeSnapshotNode>();
  const desiredKeys = new Set<string>();

  for (const [repoPath, node] of snapshot.entries()) {
    if (!repoPath.startsWith(`${entry.repoPath}/`)) {
      continue;
    }

    if (node.type === "directory") {
      continue;
    }

    const relativePath = repoPath.slice(entry.repoPath.length + 1);

    nodes.set(relativePath, node);
    desiredKeys.add(repoPath);
  }

  if (rootNode === undefined && nodes.size === 0) {
    return {
      desiredKeys,
      type: "absent",
    };
  }

  desiredKeys.add(buildDirectoryKey(entry.repoPath));

  return {
    desiredKeys,
    nodes,
    type: "directory",
  };
};

const collectLocalLeafKeys = async (
  targetPath: string,
  repoPathPrefix: string,
  keys: Set<string>,
  prefix?: string,
) => {
  const stats = await getPathStats(targetPath);

  if (stats === undefined) {
    return;
  }

  if (!stats.isDirectory()) {
    keys.add(repoPathPrefix);

    return;
  }

  keys.add(buildDirectoryKey(repoPathPrefix));

  const entries = await listDirectoryEntries(targetPath);

  for (const entry of entries) {
    const absolutePath = join(targetPath, entry.name);
    const relativePath =
      prefix === undefined ? entry.name : `${prefix}/${entry.name}`;
    const childStats = await lstat(absolutePath);

    if (childStats.isDirectory()) {
      await collectLocalLeafKeys(
        absolutePath,
        repoPathPrefix,
        keys,
        relativePath,
      );
      continue;
    }

    keys.add(posix.join(repoPathPrefix, relativePath));
  }
};

const countDeletedLocalNodes = async (
  entry: ResolvedSyncConfigEntry,
  desiredKeys: ReadonlySet<string>,
) => {
  const existingKeys = new Set<string>();

  await collectLocalLeafKeys(entry.localPath, entry.repoPath, existingKeys);

  return [...existingKeys].filter((key) => {
    return !desiredKeys.has(key);
  }).length;
};

const applyEntryMaterialization = async (
  entry: ResolvedSyncConfigEntry,
  materialization: EntryMaterialization,
) => {
  if (materialization.type === "absent") {
    await removePathAtomically(entry.localPath);

    return;
  }

  if (materialization.type === "file") {
    await stageAndReplaceFilePath(entry.localPath, materialization.node);

    return;
  }

  await stageAndReplaceDirectoryPath(entry.localPath, materialization.nodes);
};

const buildPullCounts = (
  materializations: readonly EntryMaterialization[],
  entries: readonly ResolvedSyncConfigEntry[],
) => {
  let decryptedFileCount = 0;
  let directoryCount = 0;
  let plainFileCount = 0;
  let symlinkCount = 0;

  for (let index = 0; index < materializations.length; index += 1) {
    const materialization = materializations[index];
    const entry = entries[index];

    if (materialization === undefined || entry === undefined) {
      continue;
    }

    if (materialization.type === "file") {
      if (materialization.node.type === "symlink") {
        symlinkCount += 1;
      } else if (materialization.node.secret) {
        decryptedFileCount += 1;
      } else {
        plainFileCount += 1;
      }

      continue;
    }

    if (materialization.type !== "directory") {
      continue;
    }

    directoryCount += 1;

    for (const node of materialization.nodes.values()) {
      if (node.type === "symlink") {
        symlinkCount += 1;
      } else if (node.secret) {
        decryptedFileCount += 1;
      } else {
        plainFileCount += 1;
      }
    }
  }

  return {
    decryptedFileCount,
    directoryCount,
    plainFileCount,
    symlinkCount,
  };
};

const normalizeRecipients = (recipients: readonly string[]) => {
  return [
    ...new Set(recipients.map((recipient) => recipient.trim()).filter(Boolean)),
  ].sort((left, right) => {
    return left.localeCompare(right);
  });
};

const resolveInitAgeBootstrap = async (
  request: SyncInitRequest,
  environment: NodeJS.ProcessEnv,
) => {
  const configuredIdentityFile =
    request.identityFile ?? defaultSyncIdentityFile;
  const identityFile = resolveConfiguredAbsolutePath(
    configuredIdentityFile,
    environment,
  );
  const explicitRecipients = normalizeRecipients(request.recipients);

  if (explicitRecipients.length === 0) {
    if (await pathExists(identityFile)) {
      return {
        configuredIdentityFile,
        generatedIdentity: false,
        recipients: normalizeRecipients(
          await readAgeRecipientsFromIdentityFile(identityFile),
        ),
      };
    }

    const { recipient } = await createAgeIdentityFile(identityFile);

    return {
      configuredIdentityFile,
      generatedIdentity: true,
      recipients: [recipient],
    };
  }

  if (await pathExists(identityFile)) {
    return {
      configuredIdentityFile,
      generatedIdentity: false,
      recipients: explicitRecipients,
    };
  }

  const { recipient } = await createAgeIdentityFile(identityFile);

  return {
    configuredIdentityFile,
    generatedIdentity: true,
    recipients: normalizeRecipients([...explicitRecipients, recipient]),
  };
};

const assertInitRequestMatchesConfig = (
  config: ResolvedSyncConfig,
  request: SyncInitRequest,
  environment: NodeJS.ProcessEnv,
) => {
  const recipients = normalizeRecipients(request.recipients);

  if (
    recipients.length > 0 &&
    JSON.stringify(recipients) !==
      JSON.stringify(normalizeRecipients(config.age.recipients))
  ) {
    throw new SyncError(
      "Sync configuration already exists with different recipients.",
    );
  }

  if (request.identityFile === undefined) {
    return;
  }

  const resolvedIdentity = resolveConfiguredAbsolutePath(
    request.identityFile,
    environment,
  );

  if (resolvedIdentity !== config.age.identityFile) {
    throw new SyncError(
      "Sync configuration already exists with a different identity file.",
    );
  }
};

const ensureGitRepository = async (
  syncDirectory: string,
  gitRunner?: GitRunner,
) => {
  const git = createGitService(gitRunner);

  try {
    await git.ensureRepository(syncDirectory);
  } catch (error: unknown) {
    throw new SyncError(
      error instanceof Error
        ? `Sync directory is not a git repository: ${error.message}`
        : "Sync directory is not a git repository.",
    );
  }
};

export const createSyncManager = (dependencies?: {
  cwd?: string;
  environment?: NodeJS.ProcessEnv;
  gitRunner?: GitRunner;
}) => {
  const cwd = dependencies?.cwd ?? process.cwd();
  const environment = dependencies?.environment ?? process.env;
  const git = createGitService(dependencies?.gitRunner);

  return {
    add: async (request: SyncAddRequest): Promise<SyncAddResult> => {
      try {
        const syncDirectory = resolveDevtoolsSyncDirectory(environment);

        await ensureGitRepository(syncDirectory, dependencies?.gitRunner);

        const config = await readSyncConfig(syncDirectory, environment);
        const candidate = await buildAddEntryCandidate(
          resolveCommandTargetPath(request.target, environment, cwd),
          config,
          environment,
        );
        const existingEntry = config.entries.find((entry) => {
          return (
            entry.localPath === candidate.localPath ||
            entry.repoPath === candidate.repoPath
          );
        });
        let alreadyTracked = false;

        if (existingEntry !== undefined) {
          if (
            existingEntry.localPath === candidate.localPath &&
            existingEntry.repoPath === candidate.repoPath &&
            existingEntry.kind === candidate.kind
          ) {
            alreadyTracked = true;
          } else {
            throw new SyncError(
              `Sync target conflicts with an existing entry: ${existingEntry.repoPath}`,
            );
          }
        }

        let secretGlobAdded = false;
        const nextConfig = createSyncConfigDocument(config);

        if (!alreadyTracked) {
          nextConfig.entries = sortSyncConfigEntries([
            ...nextConfig.entries,
            createSyncConfigDocumentEntry(candidate),
          ]);
        }

        if (request.secret) {
          const secretGlobResult = addCanonicalSecretGlob(
            nextConfig.secretGlobs,
            candidate,
          );

          nextConfig.secretGlobs = secretGlobResult.secretGlobs;
          secretGlobAdded = secretGlobResult.added;
        }

        if (!alreadyTracked || secretGlobAdded) {
          await writeValidatedSyncConfig(
            syncDirectory,
            nextConfig,
            environment,
          );
        }

        return {
          alreadyTracked,
          configPath: resolveSyncConfigFilePath(syncDirectory),
          kind: candidate.kind,
          localPath: candidate.localPath,
          repoPath: candidate.repoPath,
          secretGlobAdded,
          syncDirectory,
        };
      } catch (error: unknown) {
        if (error instanceof SyncError) {
          throw error;
        }

        throw new SyncError(
          error instanceof Error ? error.message : "Sync add failed.",
        );
      }
    },
    forget: async (request: SyncForgetRequest): Promise<SyncForgetResult> => {
      try {
        const syncDirectory = resolveDevtoolsSyncDirectory(environment);

        await ensureGitRepository(syncDirectory, dependencies?.gitRunner);

        const config = await readSyncConfig(syncDirectory, environment);
        const entry = findMatchingTrackedEntry(
          config,
          request.target,
          environment,
          cwd,
        );

        if (entry === undefined) {
          throw new SyncError(
            `No tracked sync entry matches: ${request.target}`,
          );
        }

        const { plainArtifactCount, secretArtifactCount } =
          await collectEntryArtifactCounts(syncDirectory, entry);
        const nextConfig = createSyncConfigDocument(config);

        nextConfig.entries = sortSyncConfigEntries(
          nextConfig.entries.filter((configEntry) => {
            return configEntry.repoPath !== entry.repoPath;
          }),
        );

        const secretGlobResult = removeCanonicalSecretGlob(
          nextConfig.secretGlobs,
          entry,
        );

        nextConfig.secretGlobs = secretGlobResult.secretGlobs;

        await writeValidatedSyncConfig(syncDirectory, nextConfig, environment);
        await removeTrackedEntryArtifacts(syncDirectory, entry);

        return {
          configPath: resolveSyncConfigFilePath(syncDirectory),
          localPath: entry.localPath,
          plainArtifactCount,
          repoPath: entry.repoPath,
          secretArtifactCount,
          secretGlobRemoved: secretGlobResult.removed,
          syncDirectory,
        };
      } catch (error: unknown) {
        if (error instanceof SyncError) {
          throw error;
        }

        throw new SyncError(
          error instanceof Error ? error.message : "Sync forget failed.",
        );
      }
    },
    init: async (request: SyncInitRequest): Promise<SyncInitResult> => {
      try {
        const syncDirectory = resolveDevtoolsSyncDirectory(environment);
        const configPath = resolveSyncConfigFilePath(syncDirectory);
        const configExists = await pathExists(configPath);

        if (configExists) {
          await ensureGitRepository(syncDirectory, dependencies?.gitRunner);

          const config = await readSyncConfig(syncDirectory, environment);
          assertInitRequestMatchesConfig(config, request, environment);

          return {
            alreadyInitialized: true,
            configPath,
            entryCount: config.entries.length,
            gitAction: "existing",
            generatedIdentity: false,
            identityFile: config.age.identityFile,
            recipientCount: config.age.recipients.length,
            secretGlobCount: config.secretGlobs.length,
            syncDirectory,
          };
        }

        await mkdir(dirname(syncDirectory), { recursive: true });

        let gitAction: SyncInitResult["gitAction"] = "existing";
        let gitSource: string | undefined;

        try {
          await git.ensureRepository(syncDirectory);
        } catch {
          const syncDirectoryExists = await pathExists(syncDirectory);

          if (syncDirectoryExists) {
            const entries = await readdir(syncDirectory);

            if (entries.length > 0) {
              throw new SyncError(
                `Sync directory already exists and is not empty: ${syncDirectory}`,
              );
            }
          }

          const gitResult = await git.initializeRepository(
            syncDirectory,
            request.repository,
          );

          gitAction = gitResult.action;
          gitSource = gitResult.source;
        }

        await mkdir(resolveSyncPlainDirectoryPath(syncDirectory), {
          recursive: true,
        });
        await mkdir(resolveSyncSecretDirectoryPath(syncDirectory), {
          recursive: true,
        });

        if (await pathExists(configPath)) {
          const config = await readSyncConfig(syncDirectory, environment);

          assertInitRequestMatchesConfig(config, request, environment);

          return {
            alreadyInitialized: true,
            configPath,
            entryCount: config.entries.length,
            gitAction,
            ...(gitSource === undefined ? {} : { gitSource }),
            generatedIdentity: false,
            identityFile: config.age.identityFile,
            recipientCount: config.age.recipients.length,
            secretGlobCount: config.secretGlobs.length,
            syncDirectory,
          };
        }
        const ageBootstrap = await resolveInitAgeBootstrap(
          request,
          environment,
        );

        const initialConfig = createInitialSyncConfig({
          identityFile: ageBootstrap.configuredIdentityFile,
          recipients: ageBootstrap.recipients,
        });

        parseSyncConfig(initialConfig, environment);
        await writeFile(configPath, formatSyncConfig(initialConfig), "utf8");

        return {
          alreadyInitialized: false,
          configPath,
          entryCount: 0,
          gitAction,
          ...(gitSource === undefined ? {} : { gitSource }),
          generatedIdentity: ageBootstrap.generatedIdentity,
          identityFile: resolveConfiguredAbsolutePath(
            ageBootstrap.configuredIdentityFile,
            environment,
          ),
          recipientCount: ageBootstrap.recipients.length,
          secretGlobCount: 0,
          syncDirectory,
        };
      } catch (error: unknown) {
        if (error instanceof SyncError) {
          throw error;
        }

        throw new SyncError(
          error instanceof Error
            ? error.message
            : "Sync initialization failed.",
        );
      }
    },
    pull: async (request: SyncRunRequest): Promise<SyncPullResult> => {
      try {
        const syncDirectory = resolveDevtoolsSyncDirectory(environment);

        await ensureGitRepository(syncDirectory, dependencies?.gitRunner);

        const config = await readSyncConfig(syncDirectory, environment);
        const snapshot = await buildRepositorySnapshot(syncDirectory, config);
        const materializations = config.entries.map((entry) => {
          return buildEntryMaterialization(entry, snapshot);
        });

        let deletedLocalCount = 0;

        for (let index = 0; index < config.entries.length; index += 1) {
          const entry = config.entries[index];
          const materialization = materializations[index];

          if (entry === undefined || materialization === undefined) {
            continue;
          }

          deletedLocalCount += await countDeletedLocalNodes(
            entry,
            materialization.desiredKeys,
          );

          if (!request.dryRun) {
            await applyEntryMaterialization(entry, materialization);
          }
        }

        const counts = buildPullCounts(materializations, config.entries);

        return {
          configPath: resolveSyncConfigFilePath(syncDirectory),
          deletedLocalCount,
          dryRun: request.dryRun,
          syncDirectory,
          ...counts,
        };
      } catch (error: unknown) {
        if (error instanceof SyncError) {
          throw error;
        }

        throw new SyncError(
          error instanceof Error ? error.message : "Sync pull failed.",
        );
      }
    },
    push: async (request: SyncRunRequest): Promise<SyncPushResult> => {
      try {
        const syncDirectory = resolveDevtoolsSyncDirectory(environment);

        await ensureGitRepository(syncDirectory, dependencies?.gitRunner);

        const config = await readSyncConfig(syncDirectory, environment);
        const snapshot = await buildLocalSnapshot(config);
        const artifacts = await buildRepoArtifacts(snapshot, config);
        const desiredArtifactKeys = new Set(
          artifacts.map((artifact) => {
            return buildArtifactKey(artifact);
          }),
        );
        const existingArtifactKeys = await collectExistingArtifactKeys(
          syncDirectory,
          config,
        );
        const deletedArtifactCount = [...existingArtifactKeys].filter((key) => {
          return !desiredArtifactKeys.has(key);
        }).length;

        if (!request.dryRun) {
          const stagingRoot = await mkdtemp(
            join(syncDirectory, ".devtools-sync-push-"),
          );
          const nextPlainDirectory = join(stagingRoot, "plain");
          const nextSecretDirectory = join(stagingRoot, "secret");

          try {
            await writeArtifactsToDirectory(
              nextPlainDirectory,
              artifacts.filter((artifact) => {
                return artifact.category === "plain";
              }),
            );
            await writeArtifactsToDirectory(
              nextSecretDirectory,
              artifacts.filter((artifact) => {
                return artifact.category === "secret";
              }),
            );

            await replacePathAtomically(
              resolveSyncPlainDirectoryPath(syncDirectory),
              nextPlainDirectory,
            );
            await replacePathAtomically(
              resolveSyncSecretDirectoryPath(syncDirectory),
              nextSecretDirectory,
            );
          } finally {
            await rm(stagingRoot, { force: true, recursive: true });
          }
        }

        const counts = buildPushCounts(snapshot);

        return {
          configPath: resolveSyncConfigFilePath(syncDirectory),
          deletedArtifactCount,
          dryRun: request.dryRun,
          syncDirectory,
          ...counts,
        };
      } catch (error: unknown) {
        if (error instanceof SyncError) {
          throw error;
        }

        throw new SyncError(
          error instanceof Error ? error.message : "Sync push failed.",
        );
      }
    },
  };
};

export const formatSyncInitResult = (result: SyncInitResult) => {
  const lines = [
    result.alreadyInitialized
      ? "Sync directory already initialized."
      : "Initialized sync directory.",
    `Sync directory: ${result.syncDirectory}`,
    `Config file: ${result.configPath}`,
    `Age identity file: ${result.identityFile}`,
    (() => {
      switch (result.gitAction) {
        case "cloned":
          return `Git repository: cloned from ${result.gitSource}`;
        case "initialized":
          return "Git repository: initialized new repository";
        default:
          return "Git repository: using existing repository";
      }
    })(),
    ...(result.generatedIdentity
      ? ["Age bootstrap: generated a new local identity."]
      : []),
    `Summary: ${result.recipientCount} recipients, ${result.entryCount} entries, ${result.secretGlobCount} secret globs.`,
  ];

  return ensureTrailingNewline(lines.join("\n"));
};

export const formatSyncAddResult = (result: SyncAddResult) => {
  const lines = [
    result.alreadyTracked
      ? "Sync target already tracked."
      : "Added sync target.",
    `Sync directory: ${result.syncDirectory}`,
    `Config file: ${result.configPath}`,
    `Local path: ${result.localPath}`,
    `Repository path: ${result.repoPath}`,
    `Kind: ${result.kind}`,
    `Secret glob: ${result.secretGlobAdded ? "added" : "unchanged"}`,
  ];

  return ensureTrailingNewline(lines.join("\n"));
};

export const formatSyncForgetResult = (result: SyncForgetResult) => {
  const lines = [
    "Forgot sync target.",
    `Sync directory: ${result.syncDirectory}`,
    `Config file: ${result.configPath}`,
    `Local path: ${result.localPath}`,
    `Repository path: ${result.repoPath}`,
    `Secret glob: ${result.secretGlobRemoved ? "removed" : "unchanged"}`,
    `Removed repo artifacts: ${result.plainArtifactCount} plain, ${result.secretArtifactCount} secret.`,
  ];

  return ensureTrailingNewline(lines.join("\n"));
};

export const formatSyncPushResult = (result: SyncPushResult) => {
  const lines = result.dryRun
    ? [
        "Dry run for sync push.",
        `Sync directory: ${result.syncDirectory}`,
        `Config file: ${result.configPath}`,
        `Summary: ${result.plainFileCount} plain files, ${result.encryptedFileCount} encrypted files, ${result.symlinkCount} symlinks, ${result.directoryCount} directory roots, ${result.deletedArtifactCount} stale repository artifacts would be removed.`,
        "No filesystem changes were made.",
      ]
    : [
        "Synchronized local config into the sync repository.",
        `Sync directory: ${result.syncDirectory}`,
        `Config file: ${result.configPath}`,
        `Summary: ${result.plainFileCount} plain files, ${result.encryptedFileCount} encrypted files, ${result.symlinkCount} symlinks, ${result.directoryCount} directory roots, ${result.deletedArtifactCount} stale repository artifacts removed.`,
      ];

  return ensureTrailingNewline(lines.join("\n"));
};

export const formatSyncPullResult = (result: SyncPullResult) => {
  const lines = result.dryRun
    ? [
        "Dry run for sync pull.",
        `Sync directory: ${result.syncDirectory}`,
        `Config file: ${result.configPath}`,
        `Summary: ${result.plainFileCount} plain files, ${result.decryptedFileCount} decrypted files, ${result.symlinkCount} symlinks, ${result.directoryCount} directory roots, ${result.deletedLocalCount} local paths would be removed.`,
        "No filesystem changes were made.",
      ]
    : [
        "Applied sync repository to local config.",
        `Sync directory: ${result.syncDirectory}`,
        `Config file: ${result.configPath}`,
        `Summary: ${result.plainFileCount} plain files, ${result.decryptedFileCount} decrypted files, ${result.symlinkCount} symlinks, ${result.directoryCount} directory roots, ${result.deletedLocalCount} local paths removed.`,
      ];

  return ensureTrailingNewline(lines.join("\n"));
};

export const runSyncInitCommand = async (
  input: Readonly<{
    options: Record<string, unknown>;
    repository?: string;
  }>,
  dependencies: {
    syncManager: ReturnType<typeof createSyncManager>;
  },
) => {
  const result = initCommandSchema.safeParse(input);

  if (!result.success) {
    throw new SyncError(formatInputIssues(result.error.issues));
  }

  return formatSyncInitResult(
    await dependencies.syncManager.init({
      identityFile: result.data.options.identity,
      recipients: result.data.options.recipient,
      ...(result.data.repository === undefined
        ? {}
        : {
            repository: result.data.repository,
          }),
    }),
  );
};

const parseSyncAddCommandInput = (input: unknown) => {
  const result = addCommandSchema.safeParse(input);

  if (!result.success) {
    throw new SyncError(formatInputIssues(result.error.issues));
  }

  return result.data;
};

const parseSyncForgetCommandInput = (input: unknown) => {
  const result = forgetCommandSchema.safeParse(input);

  if (!result.success) {
    throw new SyncError(formatInputIssues(result.error.issues));
  }

  return result.data;
};

const parseSyncCommandInput = (input: unknown) => {
  const result = syncCommandSchema.safeParse(input);

  if (!result.success) {
    throw new SyncError(formatInputIssues(result.error.issues));
  }

  return result.data;
};

export const runSyncAddCommand = async (
  input: Readonly<{
    options: Record<string, unknown>;
    target: string;
  }>,
  dependencies: {
    syncManager: ReturnType<typeof createSyncManager>;
  },
) => {
  const validatedInput = parseSyncAddCommandInput(input);

  return formatSyncAddResult(
    await dependencies.syncManager.add({
      secret: validatedInput.options.secret,
      target: validatedInput.target,
    }),
  );
};

export const runSyncPushCommand = async (
  input: Readonly<{
    options: Record<string, unknown>;
  }>,
  dependencies: {
    syncManager: ReturnType<typeof createSyncManager>;
  },
) => {
  const validatedInput = parseSyncCommandInput(input);

  return formatSyncPushResult(
    await dependencies.syncManager.push({
      dryRun: validatedInput.options.dryRun,
    }),
  );
};

export const runSyncForgetCommand = async (
  input: Readonly<{
    target: string;
  }>,
  dependencies: {
    syncManager: ReturnType<typeof createSyncManager>;
  },
) => {
  const validatedInput = parseSyncForgetCommandInput(input);

  return formatSyncForgetResult(
    await dependencies.syncManager.forget({
      target: validatedInput.target,
    }),
  );
};

export const runSyncPullCommand = async (
  input: Readonly<{
    options: Record<string, unknown>;
  }>,
  dependencies: {
    syncManager: ReturnType<typeof createSyncManager>;
  },
) => {
  const validatedInput = parseSyncCommandInput(input);

  return formatSyncPullResult(
    await dependencies.syncManager.pull({
      dryRun: validatedInput.options.dryRun,
    }),
  );
};
