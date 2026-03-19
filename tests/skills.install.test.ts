import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
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
  createSkillInstaller,
  formatSkillInstallResult,
  SkillInstallError,
} from "#app/skills/install.ts";

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), "devtools-skill-test-"));

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
      "```bash",
      `devtools ${name}`,
      "```",
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

describe("formatSkillInstallResult", () => {
  it("formats a readable installation summary", () => {
    const output = formatSkillInstallResult({
      agent: "pi",
      dryRun: false,
      skillsDirectory: "/repo/skills",
      targetDirectory: "/home/example/.pi/agent/skills",
      installedSkills: [
        {
          name: "web-research",
          sourcePath: "/repo/skills/web-research",
          targetPath: "/home/example/.pi/agent/skills/web-research",
          status: "installed",
        },
      ],
    });

    expect(output).toContain("Installed 1 skills for pi.");
    expect(output).toContain("Summary: 1 installed, 0 replaced, 0 skipped.");
    expect(output).toContain("- web-research: installed ->");
  });

  it("formats a dry-run summary", () => {
    const output = formatSkillInstallResult({
      agent: "pi",
      dryRun: true,
      skillsDirectory: "/repo/skills",
      targetDirectory: "/home/example/.pi/agent/skills",
      installedSkills: [
        {
          name: "web-research",
          sourcePath: "/repo/skills/web-research",
          targetPath: "/home/example/.pi/agent/skills/web-research",
          status: "would-install",
        },
      ],
    });

    expect(output).toContain("Dry run for pi: 1 skills evaluated.");
    expect(output).toContain(
      "Summary: 1 would install, 0 would replace, 0 skipped.",
    );
    expect(output).toContain("No filesystem changes were made.");
  });
});

describe("createSkillInstaller", () => {
  it.each(
    supportedSkillInstallAgents,
  )("installs discovered %s skills as symbolic links", async (agent) => {
    const workspaceDirectory = await createTemporaryDirectory();
    const skillsDirectory = join(workspaceDirectory, "skills");
    const targetDirectory = join(workspaceDirectory, "target");

    await createSkillDirectory(skillsDirectory, "web-research");

    const installer = createSkillInstaller({ skillsDirectory });
    const result = await installer.install({
      agent,
      dryRun: false,
      force: false,
      targetDirectory,
    });

    expect(result.installedSkills.map((skill) => skill.name)).toEqual([
      "web-research",
    ]);
    expect(result.installedSkills.map((skill) => skill.status)).toEqual([
      "installed",
    ]);

    const linkPath = join(targetDirectory, "web-research");
    const linkStats = await lstat(linkPath);

    expect(linkStats.isSymbolicLink()).toBe(true);
    expect(await realpath(linkPath)).toBe(
      join(skillsDirectory, "web-research"),
    );
    expect(await readFile(join(linkPath, "SKILL.md"), "utf8")).toContain(
      "name: web-research",
    );
  });

  it.each(
    supportedSkillInstallAgents,
  )("supports dry-run %s installation without creating files", async (agent) => {
    const workspaceDirectory = await createTemporaryDirectory();
    const skillsDirectory = join(workspaceDirectory, "skills");
    const targetDirectory = join(workspaceDirectory, "target");

    await createSkillDirectory(skillsDirectory, "web-research");

    const installer = createSkillInstaller({ skillsDirectory });
    const result = await installer.install({
      agent,
      dryRun: true,
      force: false,
      targetDirectory,
    });

    expect(result.installedSkills).toEqual([
      {
        name: "web-research",
        sourcePath: join(skillsDirectory, "web-research"),
        targetPath: join(targetDirectory, "web-research"),
        status: "would-install",
      },
    ]);

    await expect(lstat(targetDirectory)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("uses PI_CODING_AGENT_DIR when no target directory is provided", async () => {
    const workspaceDirectory = await createTemporaryDirectory();
    const skillsDirectory = join(workspaceDirectory, "skills");
    const agentDirectory = join(workspaceDirectory, "pi-agent");

    await createSkillDirectory(skillsDirectory, "web-research");

    const installer = createSkillInstaller({
      environment: {
        PI_CODING_AGENT_DIR: agentDirectory,
      },
      skillsDirectory,
    });
    const result = await installer.install({
      agent: "pi",
      dryRun: false,
      force: false,
    });

    expect(result.targetDirectory).toBe(join(agentDirectory, "skills"));
    expect(await realpath(join(agentDirectory, "skills", "web-research"))).toBe(
      join(skillsDirectory, "web-research"),
    );
  });

  it("prefers an explicit target directory over PI_CODING_AGENT_DIR", async () => {
    const workspaceDirectory = await createTemporaryDirectory();
    const skillsDirectory = join(workspaceDirectory, "skills");
    const explicitTargetDirectory = join(workspaceDirectory, "explicit-target");

    await createSkillDirectory(skillsDirectory, "web-research");

    const installer = createSkillInstaller({
      environment: {
        PI_CODING_AGENT_DIR: join(workspaceDirectory, "pi-agent"),
      },
      skillsDirectory,
    });
    const result = await installer.install({
      agent: "pi",
      dryRun: false,
      force: false,
      targetDirectory: explicitTargetDirectory,
    });

    expect(result.targetDirectory).toBe(explicitTargetDirectory);
    expect(await realpath(join(explicitTargetDirectory, "web-research"))).toBe(
      join(skillsDirectory, "web-research"),
    );
  });

  it("skips skills that already point at the same directory", async () => {
    const workspaceDirectory = await createTemporaryDirectory();
    const skillsDirectory = join(workspaceDirectory, "skills");
    const targetDirectory = join(workspaceDirectory, "target");
    const skillDirectory = await createSkillDirectory(
      skillsDirectory,
      "web-research",
    );

    await mkdir(targetDirectory, { recursive: true });
    await symlink(skillDirectory, join(targetDirectory, "web-research"), "dir");

    const installer = createSkillInstaller({ skillsDirectory });
    const result = await installer.install({
      agent: "pi",
      dryRun: false,
      force: false,
      targetDirectory,
    });

    expect(result.installedSkills).toEqual([
      {
        name: "web-research",
        sourcePath: skillDirectory,
        targetPath: join(targetDirectory, "web-research"),
        status: "skipped",
      },
    ]);
  });

  it("returns would-replace in dry-run mode when force is enabled", async () => {
    const workspaceDirectory = await createTemporaryDirectory();
    const skillsDirectory = join(workspaceDirectory, "skills");
    const replacementSkillsDirectory = join(workspaceDirectory, "replacement");
    const targetDirectory = join(workspaceDirectory, "target");
    const originalSkillDirectory = await createSkillDirectory(
      replacementSkillsDirectory,
      "web-research",
    );

    await createSkillDirectory(skillsDirectory, "web-research");
    await mkdir(targetDirectory, { recursive: true });
    await symlink(
      originalSkillDirectory,
      join(targetDirectory, "web-research"),
      "dir",
    );

    const installer = createSkillInstaller({ skillsDirectory });
    const result = await installer.install({
      agent: "pi",
      dryRun: true,
      force: true,
      targetDirectory,
    });

    expect(result.installedSkills[0]).toMatchObject({
      name: "web-research",
      status: "would-replace",
    });
    expect(await realpath(join(targetDirectory, "web-research"))).toBe(
      originalSkillDirectory,
    );
  });

  it("replaces existing targets when force is enabled", async () => {
    const workspaceDirectory = await createTemporaryDirectory();
    const skillsDirectory = join(workspaceDirectory, "skills");
    const replacementSkillsDirectory = join(workspaceDirectory, "replacement");
    const targetDirectory = join(workspaceDirectory, "target");
    const originalSkillDirectory = await createSkillDirectory(
      replacementSkillsDirectory,
      "web-research",
    );
    const newSkillDirectory = await createSkillDirectory(
      skillsDirectory,
      "web-research",
    );

    await mkdir(targetDirectory, { recursive: true });
    await symlink(
      originalSkillDirectory,
      join(targetDirectory, "web-research"),
      "dir",
    );

    const installer = createSkillInstaller({ skillsDirectory });
    const result = await installer.install({
      agent: "pi",
      dryRun: false,
      force: true,
      targetDirectory,
    });

    expect(result.installedSkills[0]).toMatchObject({
      name: "web-research",
      status: "replaced",
    });
    expect(await realpath(join(targetDirectory, "web-research"))).toBe(
      newSkillDirectory,
    );
  });

  it("throws when an existing target would be overwritten without force", async () => {
    const workspaceDirectory = await createTemporaryDirectory();
    const skillsDirectory = join(workspaceDirectory, "skills");
    const targetDirectory = join(workspaceDirectory, "target");

    await createSkillDirectory(skillsDirectory, "web-research");
    await mkdir(join(targetDirectory, "web-research"), { recursive: true });

    const installer = createSkillInstaller({ skillsDirectory });

    await expect(
      installer.install({
        agent: "pi",
        dryRun: false,
        force: false,
        targetDirectory,
      }),
    ).rejects.toThrowError(
      `Skill target already exists: ${join(targetDirectory, "web-research")}. Use --force to replace it.`,
    );
  });

  it("throws when the skills directory is missing or empty", async () => {
    const workspaceDirectory = await createTemporaryDirectory();
    const missingSkillsDirectory = join(workspaceDirectory, "missing-skills");
    const emptySkillsDirectory = join(workspaceDirectory, "empty-skills");

    await mkdir(emptySkillsDirectory, { recursive: true });

    await expect(
      createSkillInstaller({ skillsDirectory: missingSkillsDirectory }).install(
        {
          agent: "pi",
          dryRun: false,
          force: false,
          targetDirectory: join(workspaceDirectory, "target-a"),
        },
      ),
    ).rejects.toBeInstanceOf(SkillInstallError);

    await expect(
      createSkillInstaller({ skillsDirectory: emptySkillsDirectory }).install({
        agent: "pi",
        dryRun: false,
        force: false,
        targetDirectory: join(workspaceDirectory, "target-b"),
      }),
    ).rejects.toThrowError(
      `No installable skills found in ${emptySkillsDirectory}.`,
    );
  });
});
