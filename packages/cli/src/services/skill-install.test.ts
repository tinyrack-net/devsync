import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { installDotweaveSkill } from "#app/services/skill-install.ts";
import { createTemporaryDirectory } from "#test/helpers/sync-fixture.ts";

const temporaryDirectories: string[] = [];

const createWorkspace = async () => {
  const directory = await createTemporaryDirectory("dotweave-skill-install-");

  temporaryDirectories.push(directory);

  return directory;
};

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();

    if (directory !== undefined) {
      await rm(directory, { force: true, recursive: true });
    }
  }
});

describe("skill install service", () => {
  it("installs the bundled dotweave skill in an existing skills root", async () => {
    const workspace = await createWorkspace();
    const skillsRoot = join(workspace, "skills");

    await mkdir(skillsRoot);

    const result = await installDotweaveSkill({ directory: skillsRoot });

    expect(result).toEqual({
      action: "installed",
      dryRun: false,
      targetPath: join(skillsRoot, "dotweave", "SKILL.md"),
    });
    await expect(stat(skillsRoot)).resolves.toMatchObject({});
    await expect(readFile(result.targetPath, "utf8")).resolves.toContain(
      "name: dotweave",
    );
  });

  it("rejects a missing skills root without creating directories or files", async () => {
    const workspace = await createWorkspace();
    const skillsRoot = join(workspace, "skills");

    await expect(
      installDotweaveSkill({ directory: skillsRoot }),
    ).rejects.toThrow("Skills root must be a directory");
    await expect(stat(skillsRoot)).rejects.toThrow();
  });

  it("rejects an existing install path unless force is provided", async () => {
    const workspace = await createWorkspace();
    const skillsRoot = join(workspace, "skills");
    const targetPath = join(skillsRoot, "dotweave", "SKILL.md");

    await mkdir(join(skillsRoot, "dotweave"), { recursive: true });
    await writeFile(targetPath, "existing skill\n", "utf8");

    await expect(
      installDotweaveSkill({ directory: skillsRoot }),
    ).rejects.toThrow("Dotweave skill already exists");
    await expect(readFile(targetPath, "utf8")).resolves.toBe(
      "existing skill\n",
    );
  });

  it("overwrites an existing install path when force is provided", async () => {
    const workspace = await createWorkspace();
    const skillsRoot = join(workspace, "skills");
    const targetPath = join(skillsRoot, "dotweave", "SKILL.md");

    await mkdir(join(skillsRoot, "dotweave"), { recursive: true });
    await writeFile(targetPath, "existing skill\n", "utf8");

    const result = await installDotweaveSkill({
      directory: skillsRoot,
      force: true,
    });

    expect(result.action).toBe("overwritten");
    await expect(readFile(targetPath, "utf8")).resolves.toContain(
      "name: dotweave",
    );
  });

  it("rejects a skills root path that exists as a file", async () => {
    const workspace = await createWorkspace();
    const skillsRoot = join(workspace, "skills");

    await writeFile(skillsRoot, "not a directory\n", "utf8");

    await expect(
      installDotweaveSkill({ directory: skillsRoot }),
    ).rejects.toThrow("Skills root must be a directory");
  });

  it("does not create directories or files during dry runs", async () => {
    const workspace = await createWorkspace();
    const skillsRoot = join(workspace, "skills");

    await mkdir(skillsRoot);

    const result = await installDotweaveSkill({
      directory: skillsRoot,
      dryRun: true,
    });

    expect(result).toEqual({
      action: "would-install",
      dryRun: true,
      targetPath: join(skillsRoot, "dotweave", "SKILL.md"),
    });
    await expect(stat(join(skillsRoot, "dotweave"))).rejects.toThrow();
  });
});
