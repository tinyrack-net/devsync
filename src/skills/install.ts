import {
  access,
  lstat,
  mkdir,
  readdir,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";

import type { Command } from "commander";
import { z } from "zod";

import { formatInputIssues } from "#app/web/shared.ts";

export const supportedSkillInstallAgents = ["pi"] as const;

type SupportedSkillInstallAgent = (typeof supportedSkillInstallAgents)[number];

type SkillInstallRequest = Readonly<{
  agent: SupportedSkillInstallAgent;
  dryRun: boolean;
  force: boolean;
  skillsDirectory?: string;
  targetDirectory?: string;
}>;

type InstalledSkillStatus =
  | "installed"
  | "replaced"
  | "skipped"
  | "would-install"
  | "would-replace";

type InstalledSkill = Readonly<{
  name: string;
  sourcePath: string;
  targetPath: string;
  status: InstalledSkillStatus;
}>;

type SkillInstallResult = Readonly<{
  agent: SupportedSkillInstallAgent;
  dryRun: boolean;
  skillsDirectory: string;
  targetDirectory: string;
  installedSkills: readonly InstalledSkill[];
}>;

type SkillInstaller = Readonly<{
  install: (request: SkillInstallRequest) => Promise<SkillInstallResult>;
}>;

export class SkillInstallError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SkillInstallError";
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

const parseInstallSkillsCommandInput = (input: unknown) => {
  const result = installSkillsCommandSchema.safeParse(input);

  if (!result.success) {
    throw new SkillInstallError(formatInputIssues(result.error.issues));
  }

  return result.data;
};

const ensureSkillDirectoryExists = async (path: string) => {
  try {
    await access(path);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new SkillInstallError(`Skills directory not found: ${path}`);
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

const resolvePiTargetDirectory = (environment: NodeJS.ProcessEnv) => {
  const environmentWithPiDirectory = environment as NodeJS.ProcessEnv & {
    PI_CODING_AGENT_DIR?: string;
  };
  const customAgentDirectory =
    environmentWithPiDirectory.PI_CODING_AGENT_DIR?.trim();

  if (customAgentDirectory !== undefined && customAgentDirectory !== "") {
    return resolve(customAgentDirectory, "skills");
  }

  return resolve(homedir(), ".pi", "agent", "skills");
};

const resolveTargetDirectory = (
  agent: SupportedSkillInstallAgent,
  environment: NodeJS.ProcessEnv,
  targetDirectory?: string,
) => {
  if (targetDirectory !== undefined && targetDirectory !== "") {
    return resolve(targetDirectory);
  }

  switch (agent) {
    case "pi":
      return resolvePiTargetDirectory(environment);
  }
};

const installSkillDirectory = async (
  sourcePath: string,
  targetDirectory: string,
  force: boolean,
  dryRun: boolean,
): Promise<InstalledSkill> => {
  const name = basename(sourcePath);
  const targetPath = join(targetDirectory, name);
  const sourceRealPath = await realpath(sourcePath);

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
        const targetDirectory = resolveTargetDirectory(
          request.agent,
          environment,
          request.targetDirectory,
        );

        await ensureSkillDirectoryExists(skillsDirectory);

        if (!request.dryRun) {
          await mkdir(targetDirectory, { recursive: true });
        }

        const skillDirectories = await listSkillDirectories(skillsDirectory);

        if (skillDirectories.length === 0) {
          throw new SkillInstallError(
            `No installable skills found in ${skillsDirectory}.`,
          );
        }

        const installedSkills: InstalledSkill[] = [];

        for (const skillDirectory of skillDirectories) {
          installedSkills.push(
            await installSkillDirectory(
              skillDirectory,
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
