import { lstat, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  findOwningSyncEntry,
  hasReservedSyncArtifactSuffixSegment,
  type ResolvedSyncConfigEntry,
  resolveSyncArtifactsDirectoryPath,
  resolveSyncRule,
  syncDefaultMachine,
  syncSecretArtifactSuffix,
} from "#app/config/sync.ts";
import { buildDirectoryKey } from "#app/lib/path.ts";
import { decryptSecretFile, encryptSecretFile } from "./crypto.ts";
import { DevsyncError } from "./error.ts";
import {
  getPathStats,
  listDirectoryEntries,
  writeFileNode,
  writeSymlinkNode,
} from "./filesystem.ts";
import type { SnapshotNode } from "./local-snapshot.ts";
import type { EffectiveSyncConfig } from "./runtime.ts";

type ArtifactConfig = EffectiveSyncConfig;

export const collectArtifactNamespaces = (
  entries: readonly Pick<ResolvedSyncConfigEntry, "machines">[],
) => {
  const namespaces = new Set<string>();
  namespaces.add(syncDefaultMachine);

  for (const entry of entries) {
    for (const machine of entry.machines) {
      namespaces.add(machine);
    }
  }

  return namespaces;
};

export type RepoArtifact =
  | Readonly<{
      category: "plain";
      kind: "directory";
      machine: string;
      repoPath: string;
    }>
  | Readonly<{
      category: "plain";
      kind: "file";
      repoPath: string;
      machine: string;
      contents: Uint8Array;
      executable: boolean;
    }>
  | Readonly<{
      category: "plain";
      kind: "symlink";
      machine: string;
      repoPath: string;
      linkTarget: string;
    }>
  | Readonly<{
      category: "secret";
      kind: "file";
      machine: string;
      repoPath: string;
      contents: Uint8Array;
      executable: boolean;
    }>;

export const buildArtifactKey = (artifact: RepoArtifact) => {
  const relativePath = resolveArtifactRelativePath(artifact);

  return artifact.kind === "directory"
    ? buildDirectoryKey(relativePath)
    : relativePath;
};

export const isSecretArtifactPath = (relativePath: string) => {
  return relativePath.endsWith(syncSecretArtifactSuffix);
};

export const stripSecretArtifactSuffix = (relativePath: string) => {
  if (!isSecretArtifactPath(relativePath)) {
    return undefined;
  }

  return relativePath.slice(0, -syncSecretArtifactSuffix.length);
};

export const assertStorageSafeRepoPath = (repoPath: string) => {
  if (!hasReservedSyncArtifactSuffixSegment(repoPath)) {
    return;
  }

  throw new DevsyncError(
    `Tracked sync paths must not use the reserved suffix ${syncSecretArtifactSuffix}.`,
    {
      code: "RESERVED_SECRET_SUFFIX",
      details: [`Repository path: ${repoPath}`],
      hint: "Rename the tracked path so no segment ends with the secret artifact suffix.",
    },
  );
};

export const resolveArtifactRelativePath = (
  artifact: Pick<RepoArtifact, "category" | "machine" | "repoPath">,
) => {
  const machineRelativePath = `${artifact.machine}/${artifact.repoPath}`;

  return artifact.category === "secret"
    ? `${machineRelativePath}${syncSecretArtifactSuffix}`
    : machineRelativePath;
};

export const parseArtifactRelativePath = (relativePath: string) => {
  const secret = relativePath.endsWith(syncSecretArtifactSuffix);
  const logicalPath = secret
    ? relativePath.slice(0, -syncSecretArtifactSuffix.length)
    : relativePath;
  const segments = logicalPath.split("/");

  if (segments.length < 2 || segments[0] === undefined) {
    throw new DevsyncError("Repository artifact path is invalid.", {
      code: "INVALID_REPO_ENTRY",
      details: [`Repository path: ${relativePath}`],
    });
  }

  const [machine, ...repoPathSegments] = segments;

  return {
    machine,
    repoPath: repoPathSegments.join("/"),
    secret,
  };
};

export const resolveEntryArtifactRelativePath = (
  entry: Pick<ResolvedSyncConfigEntry, "repoPath">,
  machine: string,
) => {
  return resolveArtifactRelativePath({
    category: "plain",
    machine,
    repoPath: entry.repoPath,
  });
};

export const resolveEntryArtifactPath = (
  artifactsDirectory: string,
  entry: Pick<ResolvedSyncConfigEntry, "repoPath">,
  machine: string,
) => {
  return join(
    artifactsDirectory,
    ...resolveEntryArtifactRelativePath(entry, machine).split("/"),
  );
};

export const buildRepoArtifacts = async (
  snapshot: ReadonlyMap<string, SnapshotNode>,
  config: ArtifactConfig,
) => {
  const artifacts: RepoArtifact[] = [];
  const seenArtifactKeys = new Set<string>();

  const addArtifact = (artifact: RepoArtifact) => {
    const key = buildArtifactKey(artifact);

    if (seenArtifactKeys.has(key)) {
      throw new DevsyncError("Duplicate repository artifact was generated.", {
        code: "DUPLICATE_REPO_ARTIFACT",
        details: [`Artifact key: ${key}`],
      });
    }

    seenArtifactKeys.add(key);
    artifacts.push(artifact);
  };

  for (const repoPath of [...snapshot.keys()].sort((left, right) => {
    return left.localeCompare(right);
  })) {
    assertStorageSafeRepoPath(repoPath);
    const node = snapshot.get(repoPath);
    const owningEntry = findOwningSyncEntry(config, repoPath);
    const resolvedRule = resolveSyncRule(
      config,
      repoPath,
      config.activeMachine,
    );

    if (
      node === undefined ||
      owningEntry === undefined ||
      resolvedRule === undefined
    ) {
      continue;
    }

    if (node.type === "directory") {
      addArtifact({
        category: "plain",
        kind: "directory",
        machine: resolvedRule.machine,
        repoPath,
      });
      continue;
    }

    if (node.type === "symlink") {
      addArtifact({
        category: "plain",
        kind: "symlink",
        linkTarget: node.linkTarget,
        machine: resolvedRule.machine,
        repoPath,
      });
      continue;
    }

    if (!node.secret) {
      addArtifact({
        category: "plain",
        contents: node.contents,
        executable: node.executable,
        kind: "file",
        machine: resolvedRule.machine,
        repoPath,
      });
      continue;
    }

    addArtifact({
      category: "secret",
      contents: node.contents,
      executable: node.executable,
      kind: "file",
      machine: resolvedRule.machine,
      repoPath,
    });
  }

  return artifacts;
};

const collectArtifactLeafKeys = async (
  rootDirectory: string,
  keys: Set<string>,
  prefix?: string,
) => {
  const rootStats = await getPathStats(rootDirectory);

  if (rootStats === undefined) {
    return;
  }

  if (!rootStats.isDirectory()) {
    if (prefix !== undefined) {
      keys.add(prefix);
    }

    return;
  }

  const entries = await listDirectoryEntries(rootDirectory);

  for (const entry of entries) {
    const absolutePath = join(rootDirectory, entry.name);
    const relativePath =
      prefix === undefined ? entry.name : `${prefix}/${entry.name}`;
    const stats = await lstat(absolutePath);

    if (stats?.isDirectory()) {
      await collectArtifactLeafKeys(absolutePath, keys, relativePath);
      continue;
    }

    keys.add(relativePath);
  }
};

export const collectExistingArtifactKeys = async (
  syncDirectory: string,
  config: ArtifactConfig,
) => {
  const keys = new Set<string>();
  const artifactsDirectory = resolveSyncArtifactsDirectoryPath(syncDirectory);
  const namespaces = collectArtifactNamespaces(config.entries);

  await Promise.all(
    [...namespaces].map(async (namespace) => {
      await collectArtifactLeafKeys(
        join(artifactsDirectory, namespace),
        keys,
        namespace,
      );
    }),
  );

  for (const key of [...keys]) {
    if (key.startsWith("__dir__:")) {
      continue;
    }

    const artifact = parseArtifactRelativePath(key);
    const rule = resolveSyncRule(
      config,
      artifact.repoPath,
      config.activeMachine,
    );

    if (rule === undefined || rule.machine !== artifact.machine) {
      keys.delete(key);
    }
  }

  for (const entry of config.entries) {
    if (entry.kind !== "directory") {
      continue;
    }

    const rule = resolveSyncRule(config, entry.repoPath, config.activeMachine);

    if (rule === undefined) {
      continue;
    }

    const relativePath = resolveArtifactRelativePath({
      category: "plain",
      machine: rule.machine,
      repoPath: entry.repoPath,
    });
    const path = join(artifactsDirectory, ...relativePath.split("/"));

    if ((await getPathStats(path))?.isDirectory()) {
      keys.add(buildDirectoryKey(relativePath));
    }
  }

  return keys;
};

type AgeWriteConfig = Readonly<{
  identityFile: string;
  recipients: readonly string[];
}>;

const isSecretArtifactUnchanged = async (
  artifactPath: string,
  plaintext: Uint8Array,
  identityFile: string,
) => {
  let existingCiphertext: string;

  try {
    existingCiphertext = await readFile(artifactPath, "utf8");
  } catch {
    return false;
  }

  try {
    const existingPlaintext = await decryptSecretFile(
      existingCiphertext,
      identityFile,
    );

    if (existingPlaintext.length !== plaintext.length) {
      return false;
    }

    return existingPlaintext.every((byte, index) => byte === plaintext[index]);
  } catch {
    return false;
  }
};

export const writeArtifactsToDirectory = async (
  rootDirectory: string,
  artifacts: readonly RepoArtifact[],
  ageConfig?: AgeWriteConfig,
) => {
  await mkdir(rootDirectory, { recursive: true });

  for (const artifact of artifacts) {
    const artifactPath = join(
      rootDirectory,
      ...resolveArtifactRelativePath(artifact).split("/"),
    );

    if (artifact.kind === "directory") {
      await mkdir(artifactPath, { recursive: true });
      continue;
    }

    if (artifact.kind === "symlink") {
      await writeSymlinkNode(artifactPath, artifact.linkTarget);
      continue;
    }

    if (artifact.category === "secret" && ageConfig !== undefined) {
      const unchanged = await isSecretArtifactUnchanged(
        artifactPath,
        artifact.contents,
        ageConfig.identityFile,
      );

      if (unchanged) {
        continue;
      }

      const encrypted = await encryptSecretFile(
        artifact.contents,
        ageConfig.recipients,
      );

      await writeFileNode(artifactPath, {
        contents: encrypted,
        executable: artifact.executable,
      });
      continue;
    }

    await writeFileNode(artifactPath, artifact);
  }
};
