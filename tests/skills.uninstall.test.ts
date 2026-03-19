import {
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { supportedSkillInstallAgents } from "#app/skills/agents.ts";
import {
  createSkillUninstaller,
  formatSkillUninstallResult,
  SkillUninstallError,
} from "#app/skills/install.ts";

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "devtools-skill-remove-test-"),
  );

  temporaryDirectories.push(directory);

  return directory;
};

const createSkillDirectory = async (skillsDirectory: string, name: string) => {
  const skillDirectory = join(skillsDirectory, name);

  await mkdir(skillDirectory, { recursive: true });
  await writeFile(
    join(skillDirectory, "SKILL.md"),
    [
      "---",
      `name: ${name}`,
      `description: ${name} description.`,
      "---",
      "",
      `# ${name}`,
      "",
    ].join("\n"),
  );

  return skillDirectory;
};

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();

    if (directory !== undefined) {
      await rm(directory, { force: true, recursive: true });
    }
  }
});

describe("formatSkillUninstallResult", () => {
  it("formats a readable removal summary", () => {
    const output = formatSkillUninstallResult({
      agent: "pi",
      dryRun: false,
      skillsDirectory: "/repo/skills",
      targetDirectory: "/home/example/.pi/agent/skills",
      uninstalledSkills: [
        {
          name: "web-research",
          sourcePath: "/repo/skills/web-research",
          targetPath: "/home/example/.pi/agent/skills/web-research",
          status: "removed",
        },
      ],
    });

    expect(output).toContain("Removed 1 skills for pi.");
    expect(output).toContain("Summary: 1 removed, 0 skipped.");
    expect(output).toContain("- web-research: removed ->");
  });

  it("formats a dry-run removal summary", () => {
    const output = formatSkillUninstallResult({
      agent: "pi",
      dryRun: true,
      skillsDirectory: "/repo/skills",
      targetDirectory: "/home/example/.pi/agent/skills",
      uninstalledSkills: [
        {
          name: "web-research",
          sourcePath: "/repo/skills/web-research",
          targetPath: "/home/example/.pi/agent/skills/web-research",
          status: "would-remove",
        },
      ],
    });

    expect(output).toContain("Dry run for pi uninstall: 1 skills evaluated.");
    expect(output).toContain("Summary: 1 would remove, 0 skipped.");
    expect(output).toContain("No filesystem changes were made.");
  });
});

describe("createSkillUninstaller", () => {
  it.each(
    supportedSkillInstallAgents,
  )("removes managed %s skill symlinks", async (agent) => {
    const workspaceDirectory = await createTemporaryDirectory();
    const skillsDirectory = join(workspaceDirectory, "skills");
    const targetDirectory = join(workspaceDirectory, "target");
    const skillDirectory = await createSkillDirectory(
      skillsDirectory,
      "web-research",
    );

    await mkdir(targetDirectory, { recursive: true });
    await symlink(skillDirectory, join(targetDirectory, "web-research"), "dir");

    const uninstaller = createSkillUninstaller({ skillsDirectory });
    const result = await uninstaller.uninstall({
      agent,
      dryRun: false,
      targetDirectory,
    });

    expect(result.uninstalledSkills).toEqual([
      {
        name: "web-research",
        sourcePath: skillDirectory,
        targetPath: join(targetDirectory, "web-research"),
        status: "removed",
      },
    ]);
    await expect(
      lstat(join(targetDirectory, "web-research")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it.each(
    supportedSkillInstallAgents,
  )("supports dry-run %s removal without deleting files", async (agent) => {
    const workspaceDirectory = await createTemporaryDirectory();
    const skillsDirectory = join(workspaceDirectory, "skills");
    const targetDirectory = join(workspaceDirectory, "target");
    const skillDirectory = await createSkillDirectory(
      skillsDirectory,
      "web-research",
    );

    await mkdir(targetDirectory, { recursive: true });
    await symlink(skillDirectory, join(targetDirectory, "web-research"), "dir");

    const uninstaller = createSkillUninstaller({ skillsDirectory });
    const result = await uninstaller.uninstall({
      agent,
      dryRun: true,
      targetDirectory,
    });

    expect(result.uninstalledSkills[0]).toMatchObject({
      name: "web-research",
      status: "would-remove",
    });
    expect(await realpath(join(targetDirectory, "web-research"))).toBe(
      skillDirectory,
    );
  });

  it("uses PI_CODING_AGENT_DIR when no target directory is provided", async () => {
    const workspaceDirectory = await createTemporaryDirectory();
    const skillsDirectory = join(workspaceDirectory, "skills");
    const agentDirectory = join(workspaceDirectory, "agent");
    const skillDirectory = await createSkillDirectory(
      skillsDirectory,
      "web-research",
    );

    await mkdir(join(agentDirectory, "skills"), { recursive: true });
    await symlink(
      skillDirectory,
      join(agentDirectory, "skills", "web-research"),
      "dir",
    );

    const uninstaller = createSkillUninstaller({
      environment: {
        PI_CODING_AGENT_DIR: agentDirectory,
      },
      skillsDirectory,
    });
    const result = await uninstaller.uninstall({
      agent: "pi",
      dryRun: false,
    });

    expect(result.targetDirectory).toBe(join(agentDirectory, "skills"));
    await expect(
      lstat(join(agentDirectory, "skills", "web-research")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("skips missing targets", async () => {
    const workspaceDirectory = await createTemporaryDirectory();
    const skillsDirectory = join(workspaceDirectory, "skills");

    await createSkillDirectory(skillsDirectory, "web-research");

    const uninstaller = createSkillUninstaller({ skillsDirectory });
    const result = await uninstaller.uninstall({
      agent: "pi",
      dryRun: false,
      targetDirectory: join(workspaceDirectory, "target"),
    });

    expect(result.uninstalledSkills[0]).toMatchObject({
      name: "web-research",
      status: "skipped",
    });
  });

  it("rejects unrelated symlinks and non-symlink targets", async () => {
    const workspaceDirectory = await createTemporaryDirectory();
    const skillsDirectory = join(workspaceDirectory, "skills");
    const otherSkillsDirectory = join(workspaceDirectory, "other-skills");
    const targetDirectory = join(workspaceDirectory, "target");
    const otherSkillDirectory = await createSkillDirectory(
      otherSkillsDirectory,
      "web-research",
    );

    await createSkillDirectory(skillsDirectory, "web-research");
    await mkdir(targetDirectory, { recursive: true });
    await symlink(
      otherSkillDirectory,
      join(targetDirectory, "web-research"),
      "dir",
    );

    const uninstaller = createSkillUninstaller({ skillsDirectory });

    await expect(
      uninstaller.uninstall({
        agent: "pi",
        dryRun: false,
        targetDirectory,
      }),
    ).rejects.toThrowError(
      `Skill target does not point to the bundled skill: ${join(targetDirectory, "web-research")}`,
    );

    await rm(join(targetDirectory, "web-research"), {
      force: true,
      recursive: true,
    });
    await mkdir(join(targetDirectory, "web-research"), { recursive: true });

    await expect(
      uninstaller.uninstall({
        agent: "pi",
        dryRun: false,
        targetDirectory,
      }),
    ).rejects.toThrowError(
      `Skill target is not a managed symlink: ${join(targetDirectory, "web-research")}`,
    );
  });

  it("throws when the skills directory is missing or empty", async () => {
    const workspaceDirectory = await createTemporaryDirectory();
    const missingSkillsDirectory = join(workspaceDirectory, "missing-skills");
    const emptySkillsDirectory = join(workspaceDirectory, "empty-skills");

    await mkdir(emptySkillsDirectory, { recursive: true });

    await expect(
      createSkillUninstaller({
        skillsDirectory: missingSkillsDirectory,
      }).uninstall({
        agent: "pi",
        dryRun: false,
        targetDirectory: join(workspaceDirectory, "target-a"),
      }),
    ).rejects.toBeInstanceOf(SkillUninstallError);

    await expect(
      createSkillUninstaller({
        skillsDirectory: emptySkillsDirectory,
      }).uninstall({
        agent: "pi",
        dryRun: false,
        targetDirectory: join(workspaceDirectory, "target-b"),
      }),
    ).rejects.toThrowError(
      `No installable skills found in ${emptySkillsDirectory}.`,
    );
  });
});
