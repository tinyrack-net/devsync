import type { ConsolaInstance } from "consola";
import { resolveSyncConfigFilePath } from "#app/config/sync.ts";
import { formatDotweaveError } from "#app/lib/error.ts";
import { pathExists } from "#app/lib/filesystem.ts";
import { ensureRepository } from "#app/lib/git.ts";
import { buildEntryMaterialization } from "./local-materialization.ts";
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

export const runDoctorChecks = async (
  reporter?: ConsolaInstance,
): Promise<DoctorResult> => {
  reporter?.start("Running doctor checks...");
  const { syncDirectory } = resolveSyncPaths();
  const configPath = resolveSyncConfigFilePath(syncDirectory);
  const checks: DoctorCheck[] = [];

  try {
    reporter?.start("Checking sync directory...");
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
    reporter?.start("Loading sync configuration...");
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
          ? formatDotweaveError(error)
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

  reporter?.start("Checking age identity...");
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

  const missingCount = 0;
  let checkedLocalPathCount = 0;
  const healthyMissingEntries = new Set<string>();

  reporter?.start("Scanning repository artifacts...");
  const repositorySnapshot = await buildRepositorySnapshot(
    syncDirectory,
    config,
    reporter,
  );

  reporter?.start("Checking tracked local paths...");
  try {
    for (const entry of missingEntries) {
      checkedLocalPathCount += 1;

      if ((reporter?.level ?? 0) >= 4) {
        reporter?.verbose(`checked tracked local path ${entry.localPath}`);
      } else if (checkedLocalPathCount % 100 === 0) {
        reporter?.start(
          `Checked ${checkedLocalPathCount} tracked local paths...`,
        );
      }

      if (await pathExists(entry.localPath)) {
        continue;
      }

      buildEntryMaterialization(
        entry,
        repositorySnapshot,
        config,
        (reporter?.level ?? 0) >= 4 ? reporter : undefined,
      );
      healthyMissingEntries.add(entry.repoPath);
    }
  } catch (error: unknown) {
    checks.push(
      fail(
        "local-paths",
        error instanceof Error
          ? formatDotweaveError(error)
          : "Tracked local paths could not be checked.",
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
  }

  checks.push(
    missingCount === 0
      ? ok(
          "local-paths",
          healthyMissingEntries.size === 0
            ? "All tracked local paths currently exist."
            : `All missing local paths are healthy for the current sync state (${healthyMissingEntries.size} entr${healthyMissingEntries.size === 1 ? "y" : "ies"}).`,
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
