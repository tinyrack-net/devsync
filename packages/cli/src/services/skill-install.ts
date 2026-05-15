import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { dotweaveSkillContent } from "#app/assets/dotweave-skill.ts";
import { DotweaveError } from "#app/lib/error.ts";
import { getPathStats, writeTextFileAtomically } from "#app/lib/filesystem.ts";

export type SkillInstallAction =
  | "installed"
  | "overwritten"
  | "would-install"
  | "would-overwrite";

export type SkillInstallRequest = Readonly<{
  directory: string;
  dryRun?: boolean;
  force?: boolean;
}>;

export type SkillInstallResult = Readonly<{
  action: SkillInstallAction;
  dryRun: boolean;
  targetPath: string;
}>;

export const installDotweaveSkill = async (
  request: SkillInstallRequest,
): Promise<SkillInstallResult> => {
  const targetPath = join(request.directory, "dotweave", "SKILL.md");
  const dryRun = request.dryRun === true;
  const rootStats = await getPathStats(request.directory);

  if (rootStats === undefined || !rootStats.isDirectory()) {
    throw new DotweaveError("Skills root must be a directory.", {
      code: "SKILL_ROOT_NOT_DIRECTORY",
      details: [request.directory],
    });
  }

  const targetExists = (await getPathStats(targetPath)) !== undefined;

  if (targetExists && request.force !== true) {
    throw new DotweaveError("Dotweave skill already exists.", {
      code: "SKILL_ALREADY_EXISTS",
      details: [targetPath],
      hint: "Use '--force' to overwrite the existing skill.",
    });
  }

  if (dryRun) {
    return {
      action: targetExists ? "would-overwrite" : "would-install",
      dryRun,
      targetPath,
    };
  }

  await mkdir(join(request.directory, "dotweave"), { recursive: true });
  await writeTextFileAtomically(targetPath, dotweaveSkillContent);

  return {
    action: targetExists ? "overwritten" : "installed",
    dryRun,
    targetPath,
  };
};
