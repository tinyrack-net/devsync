import {
  access,
  lstat,
  mkdir,
  readdir,
  readlink,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

import type { Command } from "commander";
import { z } from "zod";

import {
  resolveSkillInstallTargetDirectory,
  type SupportedSkillInstallAgent,
  supportedSkillInstallAgents,
} from "#app/skills/agents.ts";
import { formatInputIssues } from "#app/web/shared.ts";

export type { SupportedSkillInstallAgent } from "#app/skills/agents.ts";
export { supportedSkillInstallAgents } from "#app/skills/agents.ts";

type SkillInstallRequest = Readonly<{
  agent: SupportedSkillInstallAgent;
  dryRun: boolean;
  force: boolean;
  skillsDirectory?: string;
  targetDirectory?: string;
}>;

type SkillUninstallRequest = Readonly<{
  agent: SupportedSkillInstallAgent;
  dryRun: boolean;
  skillsDirectory?: string;
  targetDirectory?: string;
}>;

type InstalledSkillStatus =
  | "installed"
  | "replaced"
  | "skipped"
  | "would-install"
  | "would-replace";

type UninstalledSkillStatus = "removed" | "skipped" | "would-remove";

type InstalledSkill = Readonly<{
  name: string;
  sourcePath: string;
  targetPath: string;
  status: InstalledSkillStatus;
}>;

type UninstalledSkill = Readonly<{
  name: string;
  sourcePath: string;
  targetPath: string;
  status: UninstalledSkillStatus;
}>;

type SkillInstallResult = Readonly<{
  agent: SupportedSkillInstallAgent;
  dryRun: boolean;
  skillsDirectory: string;
  targetDirectory: string;
  installedSkills: readonly InstalledSkill[];
}>;

type SkillUninstallResult = Readonly<{
  agent: SupportedSkillInstallAgent;
  dryRun: boolean;
  skillsDirectory: string;
  targetDirectory: string;
  uninstalledSkills: readonly UninstalledSkill[];
}>;

type SkillInstaller = Readonly<{
  install: (request: SkillInstallRequest) => Promise<SkillInstallResult>;
}>;

type SkillUninstaller = Readonly<{
  uninstall: (request: SkillUninstallRequest) => Promise<SkillUninstallResult>;
}>;

export class SkillInstallError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SkillInstallError";
  }
}

export class SkillUninstallError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SkillUninstallError";
  }
}

const installSkillsCommandSchema = z.object({
  agent: z.enum(supportedSkillInstallAgents),
  options: z.object({
    dryRun: z.boolean(),
    force: z.boolean(),
    targetDir: z.string().trim().optional(),
  }),
});

const uninstallSkillsCommandSchema = z.object({
  agent: z.enum(supportedSkillInstallAgents),
  options: z.object({
    dryRun: z.boolean(),
    targetDir: z.string().trim().optional(),
  }),
});

const parseInstallSkillsCommandInput = (input: unknown) => {
  const result = installSkillsCommandSchema.safeParse(input);

  if (!result.success) {
    throw new SkillInstallError(formatInputIssues(result.error.issues));
  }

  return result.data;
};

const parseUninstallSkillsCommandInput = (input: unknown) => {
  const result = uninstallSkillsCommandSchema.safeParse(input);

  if (!result.success) {
    throw new SkillUninstallError(formatInputIssues(result.error.issues));
  }

  return result.data;
};

const ensureSkillDirectoryExists = async (path: string) => {
  try {
    await access(path);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`Skills directory not found: ${path}`);
    }

    throw error;
  }
};

const listSkillDirectories = async (skillsDirectory: string) => {
  const entries = await readdir(skillsDirectory, { withFileTypes: true });
  const skillDirectories: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillDirectory = join(skillsDirectory, entry.name);

    try {
      await access(join(skillDirectory, "SKILL.md"));
      skillDirectories.push(skillDirectory);
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }

      throw error;
    }
  }

  return skillDirectories.sort((left, right) => {
    return left.localeCompare(right);
  });
};

const resolveManagedSkillPaths = async (skillsDirectory: string) => {
  const skillDirectories = await listSkillDirectories(skillsDirectory);

  if (skillDirectories.length === 0) {
    throw new Error(`No installable skills found in ${skillsDirectory}.`);
  }

  return await Promise.all(
    skillDirectories.map(async (sourcePath) => {
      return {
        name: basename(sourcePath),
        sourcePath,
        sourceRealPath: await realpath(sourcePath),
      };
    }),
  );
};

const installSkillDirectory = async (
  sourcePath: string,
  sourceRealPath: string,
  targetDirectory: string,
  force: boolean,
  dryRun: boolean,
): Promise<InstalledSkill> => {
  const name = basename(sourcePath);
  const targetPath = join(targetDirectory, name);

  let nextStatus: InstalledSkillStatus = dryRun ? "would-install" : "installed";

  try {
    const targetStats = await lstat(targetPath);

    if (targetStats.isSymbolicLink()) {
      try {
        const targetRealPath = await realpath(targetPath);

        if (targetRealPath === sourceRealPath) {
          return {
            name,
            sourcePath,
            targetPath,
            status: "skipped",
          };
        }
      } catch (error: unknown) {
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          )
        ) {
          throw error;
        }
      }
    }

    if (!force) {
      throw new SkillInstallError(
        `Skill target already exists: ${targetPath}. Use --force to replace it.`,
      );
    }

    nextStatus = dryRun ? "would-replace" : "replaced";

    if (!dryRun) {
      await rm(targetPath, { force: true, recursive: true });
    }
  } catch (error: unknown) {
    if (
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      throw error;
    }
  }

  if (!dryRun) {
    const relativeSourcePath = relative(dirname(targetPath), sourcePath);

    await symlink(relativeSourcePath, targetPath, "dir");
  }

  return {
    name,
    sourcePath,
    targetPath,
    status: nextStatus,
  };
};

const uninstallSkillDirectory = async (
  sourcePath: string,
  _sourceRealPath: string,
  targetDirectory: string,
  dryRun: boolean,
): Promise<UninstalledSkill> => {
  const name = basename(sourcePath);
  const targetPath = join(targetDirectory, name);

  try {
    const targetStats = await lstat(targetPath);

    if (!targetStats.isSymbolicLink()) {
      throw new SkillUninstallError(
        `Skill target is not a managed symlink: ${targetPath}`,
      );
    }

    const linkedPath = await readlink(targetPath);
    const resolvedLinkedPath = resolve(dirname(targetPath), linkedPath);

    if (resolvedLinkedPath !== sourcePath) {
      throw new SkillUninstallError(
        `Skill target does not point to the bundled skill: ${targetPath}`,
      );
    }

    if (!dryRun) {
      await rm(targetPath, { force: true, recursive: true });
    }

    return {
      name,
      sourcePath,
      targetPath,
      status: dryRun ? "would-remove" : "removed",
    };
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {
        name,
        sourcePath,
        targetPath,
        status: "skipped",
      };
    }

    throw error;
  }
};

export const formatSkillInstallResult = (result: SkillInstallResult) => {
  const installedCount = result.installedSkills.filter((skill) => {
    return skill.status === "installed";
  }).length;
  const replacedCount = result.installedSkills.filter((skill) => {
    return skill.status === "replaced";
  }).length;
  const skippedCount = result.installedSkills.filter((skill) => {
    return skill.status === "skipped";
  }).length;
  const wouldInstallCount = result.installedSkills.filter((skill) => {
    return skill.status === "would-install";
  }).length;
  const wouldReplaceCount = result.installedSkills.filter((skill) => {
    return skill.status === "would-replace";
  }).length;

  const lines = result.dryRun
    ? [
        `Dry run for ${result.agent}: ${result.installedSkills.length} skills evaluated.`,
        `Skills directory: ${result.skillsDirectory}`,
        `Target directory: ${result.targetDirectory}`,
        `Summary: ${wouldInstallCount} would install, ${wouldReplaceCount} would replace, ${skippedCount} skipped.`,
        "No filesystem changes were made.",
      ]
    : [
        `Installed ${result.installedSkills.length} skills for ${result.agent}.`,
        `Skills directory: ${result.skillsDirectory}`,
        `Target directory: ${result.targetDirectory}`,
        `Summary: ${installedCount} installed, ${replacedCount} replaced, ${skippedCount} skipped.`,
      ];

  if (result.installedSkills.length > 0) {
    lines.push("");

    for (const skill of result.installedSkills) {
      lines.push(`- ${skill.name}: ${skill.status} -> ${skill.targetPath}`);
    }
  }

  return `${lines.join("\n")}\n`;
};

export const formatSkillUninstallResult = (result: SkillUninstallResult) => {
  const removedCount = result.uninstalledSkills.filter((skill) => {
    return skill.status === "removed";
  }).length;
  const skippedCount = result.uninstalledSkills.filter((skill) => {
    return skill.status === "skipped";
  }).length;
  const wouldRemoveCount = result.uninstalledSkills.filter((skill) => {
    return skill.status === "would-remove";
  }).length;

  const lines = result.dryRun
    ? [
        `Dry run for ${result.agent} uninstall: ${result.uninstalledSkills.length} skills evaluated.`,
        `Skills directory: ${result.skillsDirectory}`,
        `Target directory: ${result.targetDirectory}`,
        `Summary: ${wouldRemoveCount} would remove, ${skippedCount} skipped.`,
        "No filesystem changes were made.",
      ]
    : [
        `Removed ${result.uninstalledSkills.length} skills for ${result.agent}.`,
        `Skills directory: ${result.skillsDirectory}`,
        `Target directory: ${result.targetDirectory}`,
        `Summary: ${removedCount} removed, ${skippedCount} skipped.`,
      ];

  if (result.uninstalledSkills.length > 0) {
    lines.push("");

    for (const skill of result.uninstalledSkills) {
      lines.push(`- ${skill.name}: ${skill.status} -> ${skill.targetPath}`);
    }
  }

  return `${lines.join("\n")}\n`;
};

export const createSkillInstaller = (dependencies?: {
  environment?: NodeJS.ProcessEnv;
  skillsDirectory?: string;
}) => {
  return {
    install: async (request: SkillInstallRequest) => {
      try {
        const environment = dependencies?.environment ?? process.env;
        const skillsDirectory = resolve(
          request.skillsDirectory ?? dependencies?.skillsDirectory ?? "skills",
        );
        const targetDirectory = resolveSkillInstallTargetDirectory(
          request.agent,
          environment,
          request.targetDirectory,
        );

        await ensureSkillDirectoryExists(skillsDirectory);

        if (!request.dryRun) {
          await mkdir(targetDirectory, { recursive: true });
        }

        const managedSkillPaths =
          await resolveManagedSkillPaths(skillsDirectory);
        const installedSkills: InstalledSkill[] = [];

        for (const managedSkillPath of managedSkillPaths) {
          installedSkills.push(
            await installSkillDirectory(
              managedSkillPath.sourcePath,
              managedSkillPath.sourceRealPath,
              targetDirectory,
              request.force,
              request.dryRun,
            ),
          );
        }

        return {
          agent: request.agent,
          dryRun: request.dryRun,
          skillsDirectory,
          targetDirectory,
          installedSkills,
        } satisfies SkillInstallResult;
      } catch (error: unknown) {
        if (error instanceof SkillInstallError) {
          throw error;
        }

        throw new SkillInstallError(
          error instanceof Error ? error.message : "Skill installation failed.",
        );
      }
    },
  } satisfies SkillInstaller;
};

export const createSkillUninstaller = (dependencies?: {
  environment?: NodeJS.ProcessEnv;
  skillsDirectory?: string;
}) => {
  return {
    uninstall: async (request: SkillUninstallRequest) => {
      try {
        const environment = dependencies?.environment ?? process.env;
        const skillsDirectory = resolve(
          request.skillsDirectory ?? dependencies?.skillsDirectory ?? "skills",
        );
        const targetDirectory = resolveSkillInstallTargetDirectory(
          request.agent,
          environment,
          request.targetDirectory,
        );

        await ensureSkillDirectoryExists(skillsDirectory);

        const managedSkillPaths =
          await resolveManagedSkillPaths(skillsDirectory);
        const uninstalledSkills: UninstalledSkill[] = [];

        for (const managedSkillPath of managedSkillPaths) {
          uninstalledSkills.push(
            await uninstallSkillDirectory(
              managedSkillPath.sourcePath,
              managedSkillPath.sourceRealPath,
              targetDirectory,
              request.dryRun,
            ),
          );
        }

        return {
          agent: request.agent,
          dryRun: request.dryRun,
          skillsDirectory,
          targetDirectory,
          uninstalledSkills,
        } satisfies SkillUninstallResult;
      } catch (error: unknown) {
        if (error instanceof SkillUninstallError) {
          throw error;
        }

        throw new SkillUninstallError(
          error instanceof Error
            ? error.message
            : "Skill uninstallation failed.",
        );
      }
    },
  } satisfies SkillUninstaller;
};

export const registerInstallSkillsCommand = (
  installCommand: Command,
  dependencies: {
    io: {
      stdout: (text: string) => void;
    };
    skillInstaller: SkillInstaller;
  },
) => {
  installCommand
    .command("skills")
    .description("Install bundled skill templates for an agent harness")
    .argument(
      "<agent>",
      `Agent harness to install skills for: ${supportedSkillInstallAgents.join(", ")}`,
    )
    .option(
      "--dry-run",
      "Show what would be installed without changing files",
      false,
    )
    .option("--force", "Replace existing skill targets", false)
    .option(
      "--target-dir <path>",
      "Override the destination directory for installed skills",
    )
    .action(async (agent: string, options: Record<string, unknown>) => {
      const validatedInput = parseInstallSkillsCommandInput({
        agent,
        options,
      });
      const result = await dependencies.skillInstaller.install({
        agent: validatedInput.agent,
        dryRun: validatedInput.options.dryRun,
        force: validatedInput.options.force,
        ...(validatedInput.options.targetDir === undefined
          ? {}
          : {
              targetDirectory: validatedInput.options.targetDir,
            }),
      });

      dependencies.io.stdout(formatSkillInstallResult(result));
    });
};

export const registerUninstallSkillsCommand = (
  uninstallCommand: Command,
  dependencies: {
    io: {
      stdout: (text: string) => void;
    };
    skillUninstaller: SkillUninstaller;
  },
) => {
  uninstallCommand
    .command("skills")
    .description("Uninstall bundled skill templates for an agent harness")
    .argument(
      "<agent>",
      `Agent harness to uninstall skills for: ${supportedSkillInstallAgents.join(", ")}`,
    )
    .option(
      "--dry-run",
      "Show what would be uninstalled without changing files",
      false,
    )
    .option(
      "--target-dir <path>",
      "Override the destination directory for uninstalled skills",
    )
    .action(async (agent: string, options: Record<string, unknown>) => {
      const validatedInput = parseUninstallSkillsCommandInput({
        agent,
        options,
      });
      const result = await dependencies.skillUninstaller.uninstall({
        agent: validatedInput.agent,
        dryRun: validatedInput.options.dryRun,
        ...(validatedInput.options.targetDir === undefined
          ? {}
          : {
              targetDirectory: validatedInput.options.targetDir,
            }),
      });

      dependencies.io.stdout(formatSkillUninstallResult(result));
    });
};
