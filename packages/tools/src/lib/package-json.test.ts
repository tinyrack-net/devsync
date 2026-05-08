import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { readPackageVersion, writePackageVersion } from "./package-json.ts";

const tempDirectories: string[] = [];

afterEach(async () => {
  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();
    if (directory !== undefined) {
      await fs.rm(directory, { force: true, recursive: true });
    }
  }
});

const createTempDir = async (): Promise<string> => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "dotweave-pkgjson-"),
  );
  tempDirectories.push(directory);
  return directory;
};

const writePackageJson = async (
  directory: string,
  data: unknown,
): Promise<string> => {
  const filePath = path.join(directory, "package.json");
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return filePath;
};

const writeRawPackageJson = async (
  directory: string,
  content: string,
): Promise<string> => {
  const filePath = path.join(directory, "package.json");
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
};

describe("readPackageVersion", () => {
  test("reads version from valid package.json", async () => {
    const dir = await createTempDir();
    const filePath = await writePackageJson(dir, {
      name: "foo",
      version: "1.2.3",
    });
    const result = await readPackageVersion(filePath);

    expect(result).toBe("1.2.3");
  });

  test("throws when version field is missing", async () => {
    const dir = await createTempDir();
    const filePath = await writePackageJson(dir, { name: "foo" });

    await expect(readPackageVersion(filePath)).rejects.toThrow(
      /Missing version/u,
    );
  });

  test("throws when version is a number", async () => {
    const dir = await createTempDir();
    const filePath = await writePackageJson(dir, { version: 42 });

    await expect(readPackageVersion(filePath)).rejects.toThrow(
      /Missing version/u,
    );
  });

  test("throws when version is null", async () => {
    const dir = await createTempDir();
    const filePath = await writePackageJson(dir, { version: null });

    await expect(readPackageVersion(filePath)).rejects.toThrow(
      /Missing version/u,
    );
  });

  test("throws for JSON array", async () => {
    const dir = await createTempDir();
    const filePath = await writeRawPackageJson(dir, "[1, 2, 3]");

    await expect(readPackageVersion(filePath)).rejects.toThrow(
      /Invalid package\.json/u,
    );
  });

  test("throws for JSON null", async () => {
    const dir = await createTempDir();
    const filePath = await writeRawPackageJson(dir, "null");

    await expect(readPackageVersion(filePath)).rejects.toThrow(
      /Invalid package\.json/u,
    );
  });
});

describe("writePackageVersion", () => {
  test("writes updated version preserving other fields", async () => {
    const dir = await createTempDir();
    const filePath = await writePackageJson(dir, {
      description: "bar",
      name: "foo",
      version: "1.0.0",
    });

    await writePackageVersion(filePath, "2.0.0");

    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);

    expect(parsed.version).toBe("2.0.0");
    expect(parsed.name).toBe("foo");
    expect(parsed.description).toBe("bar");
  });

  test("preserves 2-space indent and trailing newline", async () => {
    const dir = await createTempDir();
    const filePath = await writePackageJson(dir, { version: "1.0.0" });

    await writePackageVersion(filePath, "2.0.0");

    const raw = await fs.readFile(filePath, "utf8");

    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toMatch(/^\{\n {2}"/u);
  });
});
