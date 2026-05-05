import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DotweaveError } from "#app/lib/error.ts";
import {
  type ConfigMigrationFn,
  type ConfigMigrationRegistry,
  runConfigMigrations,
} from "./migration.ts";

let tempDir: string | undefined;

afterEach(async () => {
  tempDir = undefined;
});

const createTempFile = async (content: unknown): Promise<string> => {
  if (tempDir === undefined) {
    tempDir = await mkdtemp(join(tmpdir(), "dotweave-migration-test-"));
  }
  const filePath = join(tempDir, "config.json");
  await writeFile(filePath, JSON.stringify(content, null, 2), "utf8");
  return filePath;
};

const makeRegistry = (
  entries: [number, ConfigMigrationFn][],
): ConfigMigrationRegistry => new Map(entries);

describe("runConfigMigrations", () => {
  it("returns the original config unchanged when version matches target", async () => {
    const config = { version: 7, entries: [] };
    const filePath = await createTempFile(config);

    const result = await runConfigMigrations(
      config,
      makeRegistry([]),
      7,
      filePath,
    );

    expect(result).toEqual(config);
  });

  it("returns non-object input unchanged (delegates to Zod validation)", async () => {
    const filePath = await createTempFile(null);
    const result = await runConfigMigrations(
      null,
      makeRegistry([]),
      7,
      filePath,
    );
    expect(result).toBeNull();
  });

  it("returns config unchanged when version field is missing", async () => {
    const config = { entries: [] };
    const filePath = await createTempFile(config);
    const result = await runConfigMigrations(
      config,
      makeRegistry([]),
      7,
      filePath,
    );
    expect(result).toEqual(config);
  });

  it("returns config unchanged when version field is not a number", async () => {
    const config = { version: "7", entries: [] };
    const filePath = await createTempFile(config);
    const result = await runConfigMigrations(
      config,
      makeRegistry([]),
      7,
      filePath,
    );
    expect(result).toEqual(config);
  });

  it("throws CONFIG_NEWER_VERSION when config version exceeds target", async () => {
    const config = { version: 9, entries: [] };
    const filePath = await createTempFile(config);

    await expect(
      runConfigMigrations(config, makeRegistry([]), 7, filePath),
    ).rejects.toMatchObject({
      code: "CONFIG_NEWER_VERSION",
    });
  });

  it("applies a single migration step", async () => {
    const config = { version: 2, activeProfile: "work", age: { key: "x" } };
    const filePath = await createTempFile(config);

    const migrateFn: ConfigMigrationFn = (c) => {
      const { age: _age, ...rest } = c;
      return { ...rest, version: 3 };
    };

    const result = await runConfigMigrations(
      config,
      makeRegistry([[2, migrateFn]]),
      3,
      filePath,
    );

    expect(result).toEqual({ version: 3, activeProfile: "work" });
  });

  it("applies multiple migration steps in sequence", async () => {
    const config = { version: 1, value: "a" };
    const filePath = await createTempFile(config);

    const registry = makeRegistry([
      [1, (c) => ({ ...c, version: 2, step1: true })],
      [2, (c) => ({ ...c, version: 3, step2: true })],
    ]);

    const result = await runConfigMigrations(config, registry, 3, filePath);

    expect(result).toEqual({
      version: 3,
      value: "a",
      step1: true,
      step2: true,
    });
  });

  it("creates a backup file before migration", async () => {
    const config = { version: 2, data: "original" };
    const filePath = await createTempFile(config);

    await runConfigMigrations(
      config,
      makeRegistry([[2, (c) => ({ ...c, version: 3 })]]),
      3,
      filePath,
    );

    const backupContent = await readFile(`${filePath}.v2.bak`, "utf8");
    const backup = JSON.parse(backupContent) as unknown;
    expect(backup).toEqual(config);
  });

  it("backup contains original config even after multi-step migration", async () => {
    const config = { version: 1, original: true };
    const filePath = await createTempFile(config);

    const registry = makeRegistry([
      [1, (c) => ({ ...c, version: 2 })],
      [2, (c) => ({ ...c, version: 3 })],
    ]);

    await runConfigMigrations(config, registry, 3, filePath);

    const backupContent = await readFile(`${filePath}.v1.bak`, "utf8");
    const backup = JSON.parse(backupContent) as unknown;
    expect(backup).toEqual(config);
  });

  it("saves the migrated config to the file", async () => {
    const config = { version: 2, name: "test" };
    const filePath = await createTempFile(config);

    await runConfigMigrations(
      config,
      makeRegistry([[2, (c) => ({ ...c, version: 3 })]]),
      3,
      filePath,
    );

    const saved = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    expect(saved).toEqual({ version: 3, name: "test" });
  });

  it("throws CONFIG_MIGRATION_NOT_FOUND when registry has a gap", async () => {
    const config = { version: 1 };
    const filePath = await createTempFile(config);

    await expect(
      runConfigMigrations(config, makeRegistry([]), 3, filePath),
    ).rejects.toMatchObject({
      code: "CONFIG_MIGRATION_NOT_FOUND",
    });
  });

  it("throws CONFIG_MIGRATION_FAILED when a migration function throws", async () => {
    const config = { version: 2 };
    const filePath = await createTempFile(config);

    const brokenFn: ConfigMigrationFn = () => {
      throw new Error("migration exploded");
    };

    await expect(
      runConfigMigrations(config, makeRegistry([[2, brokenFn]]), 3, filePath),
    ).rejects.toMatchObject({
      code: "CONFIG_MIGRATION_FAILED",
    });
  });

  it("throws a DotweaveError instance for all error cases", async () => {
    const config = { version: 9 };
    const filePath = await createTempFile(config);

    const error = await runConfigMigrations(
      config,
      makeRegistry([]),
      7,
      filePath,
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DotweaveError);
  });
});
