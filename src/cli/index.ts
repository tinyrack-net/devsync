import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { format } from "node:util";

import { Errors, flush, run, settings } from "@oclif/core";

import { withCliRuntime } from "#app/cli/runtime.ts";
import {
  type CliServices,
  createDefaultCliServices,
} from "#app/cli/services.ts";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const entryScriptPath = fileURLToPath(new URL("../index.ts", import.meta.url));

const require = createRequire(import.meta.url);
const packageJson = require("../../package.json") as {
  version: string;
};

type CliIo = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

const isVersionRequest = (args: readonly string[]) => {
  return args.length === 1 && (args[0] === "--version" || args[0] === "-v");
};

const readErrorExitCode = (error: unknown) => {
  if (error instanceof Errors.ExitError) {
    return error.oclif?.exit ?? 0;
  }

  if (
    error instanceof Error &&
    "oclif" in error &&
    typeof error.oclif === "object" &&
    error.oclif !== null &&
    "exit" in error.oclif &&
    typeof error.oclif.exit === "number"
  ) {
    return error.oclif.exit;
  }

  if (
    error instanceof Error &&
    "exitCode" in error &&
    typeof error.exitCode === "number"
  ) {
    return error.exitCode;
  }

  return 1;
};

const readChunkText = (
  chunk: Uint8Array | string,
  encoding?: BufferEncoding | null,
) => {
  if (typeof chunk === "string") {
    return chunk;
  }

  return Buffer.from(chunk).toString(encoding ?? "utf8");
};

const patchWritable = (
  writable: NodeJS.WriteStream,
  write: (text: string) => void,
) => {
  const originalWrite = writable.write.bind(writable);

  writable.write = ((
    chunk: Uint8Array | string,
    encoding?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ) => {
    const resolvedEncoding =
      typeof encoding === "function" ? undefined : encoding;
    const resolvedCallback =
      typeof encoding === "function" ? encoding : callback;

    write(readChunkText(chunk, resolvedEncoding ?? null));
    resolvedCallback?.();
    return true;
  }) as typeof writable.write;

  return () => {
    writable.write = originalWrite;
  };
};

const patchConsoleMethod = (
  key: "error" | "log",
  write: (text: string) => void,
) => {
  const originalMethod = console[key];

  console[key] = ((...args: unknown[]) => {
    const text = args.length === 0 ? "" : format(...args);
    write(`${text}\n`);
  }) as typeof originalMethod;

  return () => {
    console[key] = originalMethod;
  };
};

export type { CliServices } from "#app/cli/services.ts";
export { createDefaultCliServices } from "#app/cli/services.ts";

export const runCli = async (
  args: readonly string[],
  io: CliIo,
  services: CliServices = createDefaultCliServices(),
) => {
  if (isVersionRequest(args)) {
    io.stdout(`${packageJson.version}\n`);
    return 0;
  }

  const restoreStdout = patchWritable(process.stdout, io.stdout);
  const restoreStderr = patchWritable(process.stderr, io.stderr);
  const restoreConsoleLog = patchConsoleMethod("log", io.stdout);
  const restoreConsoleError = patchConsoleMethod("error", io.stderr);
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;

  settings.debug = false;
  settings.enableAutoTranspile = false;

  process.argv = [process.execPath, entryScriptPath, ...args];
  process.exitCode = undefined;

  try {
    await withCliRuntime({ services }, async () => {
      await run([...args], workspaceRoot);
    });
    await flush();
    return process.exitCode ?? 0;
  } catch (error: unknown) {
    await flush();

    if (!(error instanceof Errors.ExitError) && error instanceof Error) {
      io.stderr(`error: ${error.message}\n`);
    }

    return readErrorExitCode(error);
  } finally {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    restoreConsoleError();
    restoreConsoleLog();
    restoreStdout();
    restoreStderr();
  }
};
