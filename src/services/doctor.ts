import { resolveSyncConfigFilePath } from "#app/config/sync.js";

import { pathExists } from "./filesystem.js";
import { ensureRepository } from "./git.js";
import {
  createSyncPaths,
  type EffectiveSyncConfig,
  loadSyncConfig,
} from "./runtime.js";

export type DoctorCheckLevel = "fail" | "ok" | "warn";

export type DoctorCheck = Readonly<{
  detail: string;
  level: DoctorCheckLevel;
  name: string;
}>;

export type SyncDoctorResult = Readonly<{
  checks: readonly DoctorCheck[];
  configPath: string;
  hasFailures: boolean;
  hasWarnings: boolean;
  syncDirectory: string;
}>;

const ok = (name: string, detail: string): DoctorCheck => ({
  detail,
  level: "ok",
  name,
});

const warn = (name: string, detail: string): DoctorCheck => ({
  detail,
  level: "warn",
  name,
});

const fail = (name: string, detail: string): DoctorCheck => ({
  detail,
  level: "fail",
  name,
});

export const runSyncDoctor = async (
  environment: NodeJS.ProcessEnv,
): Promise<SyncDoctorResult> => {
  const { syncDirectory } = createSyncPaths(environment);
  const configPath = resolveSyncConfigFilePath(syncDirectory);
  const checks: DoctorCheck[] = [];

  try {
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
    const { effectiveConfig, fullConfig } = await loadSyncConfig(
      syncDirectory,
      environment,
    );

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
    return !environment || entry.localPath.length > 0;
  });

  let missingCount = 0;

  for (const entry of missingEntries) {
    if (!(await pathExists(entry.localPath))) {
      missingCount += 1;
    }
  }

  checks.push(
    missingCount === 0
      ? ok("local-paths", "All tracked local paths currently exist.")
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
