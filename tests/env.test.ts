import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  EnvironmentError,
  loadEnvironment,
  validateEnvironment,
} from "../src/env.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
});

describe("validateEnvironment", () => {
  it("accepts supported node environments", () => {
    expect(
      validateEnvironment({ BRAVE_SEARCH_API_KEY: "secret" }, "development"),
    ).toMatchObject({
      BRAVE_SEARCH_API_KEY: "secret",
      NODE_ENV: "development",
    });
  });

  it("normalizes an empty brave api key to undefined", () => {
    expect(validateEnvironment({ BRAVE_SEARCH_API_KEY: "   " })).toMatchObject({
      BRAVE_SEARCH_API_KEY: undefined,
    });
  });

  it("throws for an invalid node environment", () => {
    expect(() => {
      validateEnvironment({}, "staging");
    }).toThrowError(EnvironmentError);

    expect(() => {
      validateEnvironment({}, "staging");
    }).toThrowError(/NODE_ENV/);
  });
});

describe("loadEnvironment", () => {
  it("loads variables from a .env file outside production", async () => {
    const directory = await mkdtemp(join(tmpdir(), "devtools-env-"));
    temporaryDirectories.push(directory);

    await writeFile(
      join(directory, ".env"),
      "BRAVE_SEARCH_API_KEY=from-dotenv\nCUSTOM_VALUE=hello\n",
    );

    const environment: NodeJS.ProcessEnv = {};
    const result = loadEnvironment(directory, environment, "development");

    const { BRAVE_SEARCH_API_KEY, CUSTOM_VALUE } = environment;

    expect(BRAVE_SEARCH_API_KEY).toBe("from-dotenv");
    expect(CUSTOM_VALUE).toBe("hello");
    expect(result).toMatchObject({
      BRAVE_SEARCH_API_KEY: "from-dotenv",
      CUSTOM_VALUE: "hello",
      NODE_ENV: "development",
    });
  });

  it("does not load .env values in production", async () => {
    const directory = await mkdtemp(join(tmpdir(), "devtools-env-"));
    temporaryDirectories.push(directory);

    await writeFile(
      join(directory, ".env"),
      "BRAVE_SEARCH_API_KEY=from-dotenv\n",
    );

    const environment: NodeJS.ProcessEnv = {};
    const result = loadEnvironment(directory, environment, "production");

    const { BRAVE_SEARCH_API_KEY } = environment;

    expect(BRAVE_SEARCH_API_KEY).toBeUndefined();
    expect(result).toMatchObject({
      NODE_ENV: "production",
    });
    expect(result.BRAVE_SEARCH_API_KEY).toBeUndefined();
  });

  it("does not overwrite existing environment variables", async () => {
    const directory = await mkdtemp(join(tmpdir(), "devtools-env-"));
    temporaryDirectories.push(directory);

    await writeFile(
      join(directory, ".env"),
      "BRAVE_SEARCH_API_KEY=from-dotenv\n",
    );

    const environment: NodeJS.ProcessEnv = {
      BRAVE_SEARCH_API_KEY: "already-set",
    };

    const result = loadEnvironment(directory, environment, "development");
    const { BRAVE_SEARCH_API_KEY } = environment;

    expect(BRAVE_SEARCH_API_KEY).toBe("already-set");
    expect(result).toMatchObject({
      BRAVE_SEARCH_API_KEY: "already-set",
      NODE_ENV: "development",
    });
  });

  it("returns validated environment when no .env file exists", () => {
    const result = loadEnvironment("/tmp/devtools-missing-env", {}, "test");

    expect(result).toMatchObject({
      NODE_ENV: "test",
    });
    expect(result.BRAVE_SEARCH_API_KEY).toBeUndefined();
  });
});
