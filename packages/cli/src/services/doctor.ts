import { resolveSyncConfigFilePath } from "#app/config/sync.ts";
import { pathExists } from "#app/lib/filesystem.ts";
import { ensureRepository } from "#app/lib/git.ts";
import {
  type ProgressReporter,
  reportDetail,
  reportPhase,
} from "#app/lib/progress.ts";
import { buildRepositorySnapshot } from "./repo-snapshot.ts";
import {
  type EffectiveSyncConfig,
  loadSyncConfig,
  resolveSyncPaths,
} from "./runtime.ts";

export type DoctorCheckLevel = "fail" | "ok" | "warn";

export type DoctorCheck = Readonly<{
  checkId: string;
  detail: string;
  level: DoctorCheckLevel;
}>;

export type DoctorResult = Readonly<{
  checks: readonly DoctorCheck[];
  configPath: string;
  hasFailures: boolean;
  hasWarnings: boolean;
  syncDirectory: string;
}>;

const ok = (checkId: string, detail: string): DoctorCheck => ({
  checkId,
  detail,
  level: "ok",
});

const warn = (checkId: string, detail: string): DoctorCheck => ({
  checkId,
  detail,
  level: "warn",
});

const fail = (checkId: string, detail: string): DoctorCheck => ({
  checkId,
  detail,
  level: "fail",
});

const hasRestorableRepositoryArtifact = (
  snapshot: ReadonlyMap<string, unknown>,
  entry: EffectiveSyncConfig["entries"][number],
) => {
  if (snapshot.has(entry.repoPath)) {
    return true;
  }

  if (entry.kind !== "directory") {
    return false;
  }

  for (const repoPath of snapshot.keys()) {
    if (repoPath.startsWith(`${entry.repoPath}/`)) {
      return true;
    }
  }

  return false;
};

export const runDoctorChecks = async (
  reporter?: ProgressReporter,
): Promise<DoctorResult> => {
  reportPhase(reporter, "Running doctor checks...");
  const { syncDirectory } = resolveSyncPaths();
  const configPath = resolveSyncConfigFilePath(syncDirectory);
  const checks: DoctorCheck[] = [];

  try {
    reportPhase(reporter, "Checking sync repository...");
    await ensureRepository(syncDirectory);
    checks.push(ok("git", "Sync directory is a git repository."));
  } catch (error: unknown) {
    checks.push(
      fail(
        "git",
        error instanceof Error ? error.message : "Git repository check failed.",
      ),
    );

    return {
      checks,
      configPath,
      hasFailures: true,
      hasWarnings: false,
      syncDirectory,
    };
  }

  let config: EffectiveSyncConfig;

  try {
    reportPhase(reporter, "Loading sync configuration...");
    const { effectiveConfig, fullConfig } = await loadSyncConfig(syncDirectory);

    config = effectiveConfig;
    checks.push(
      ok(
        "config",
        `Loaded config with ${fullConfig.entries.length} entries and ${effectiveConfig.age.recipients.length} recipients.`,
      ),
    );
    checks.push(
      ok(
        "profiles",
        effectiveConfig.activeProfile === undefined
          ? "No active profile configured."
          : `Active profile: ${effectiveConfig.activeProfile}.`,
      ),
    );
  } catch (error: unknown) {
    checks.push(
      fail(
        "config",
        error instanceof Error
          ? error.message
          : "Sync configuration could not be read.",
      ),
    );

    return {
      checks,
      configPath,
      hasFailures: true,
      hasWarnings: false,
      syncDirectory,
    };
  }

  reportPhase(reporter, "Checking age identity...");
  checks.push(
    (await pathExists(config.age.identityFile))
      ? ok("age", `Age identity file exists at ${config.age.identityFile}.`)
      : fail("age", `Age identity file is missing: ${config.age.identityFile}`),
  );

  checks.push(
    config.entries.length === 0
      ? warn("entries", "No sync entries are configured yet.")
      : ok("entries", `Tracked ${config.entries.length} sync entries.`),
  );

  const missingEntries = config.entries.filter((entry) => {
    return entry.mode !== "ignore" && entry.localPath.length > 0;
  });

  let missingCount = 0;
  let checkedLocalPathCount = 0;
  const missingButRestorableEntries = new Set<string>();

  reportPhase(reporter, "Scanning repository artifacts...");
  const repositorySnapshot = await buildRepositorySnapshot(
    syncDirectory,
    config,
    reporter,
  );

  reportPhase(reporter, "Checking tracked local paths...");
  for (const entry of missingEntries) {
    checkedLocalPathCount += 1;

    if (reporter?.verbose) {
      reportDetail(reporter, `checked tracked local path ${entry.localPath}`);
    } else if (checkedLocalPathCount % 100 === 0) {
      reportPhase(
        reporter,
        `Checked ${checkedLocalPathCount} tracked local paths...`,
      );
    }

    if (!(await pathExists(entry.localPath))) {
      if (hasRestorableRepositoryArtifact(repositorySnapshot, entry)) {
        missingButRestorableEntries.add(entry.repoPath);
        continue;
      }

      missingCount += 1;
    }
  }

  checks.push(
    missingCount === 0
      ? ok(
          "local-paths",
          missingButRestorableEntries.size === 0
            ? "All tracked local paths currently exist."
            : `All missing local paths are already restorable from the sync repository (${missingButRestorableEntries.size} entr${missingButRestorableEntries.size === 1 ? "y" : "ies"}).`,
        )
      : warn(
          "local-paths",
          `${missingCount} tracked local path${missingCount === 1 ? " is" : "s are"} missing.`,
        ),
  );

  const hasFailures = checks.some((check) => check.level === "fail");
  const hasWarnings = checks.some((check) => check.level === "warn");

  return {
    checks,
    configPath,
    hasFailures,
    hasWarnings,
    syncDirectory,
  };
};
