import { afterEach, describe, expect, it, vi } from "vitest";
import packageJson from "../package.json" with { type: "json" };
import {
  formatApplicationError,
  resolveExitCode,
  runCli,
} from "./application.ts";
import { rootCommandRoutes } from "./cli/root-commands.ts";

const captureProcessOutput = () => {
  let stdout = "";
  let stderr = "";

  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    stdout += String(chunk);

    return true;
  }) as typeof process.stdout.write);
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
    stderr += String(chunk);

    return true;
  }) as typeof process.stderr.write);

  return {
    stderr: () => stderr,
    stdout: () => stdout,
  };
};

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe("CLI application", () => {
  it("prints the current version", async () => {
    const output = captureProcessOutput();

    await runCli(["--version"]);

    expect(process.exitCode).toBe(0);
    expect(output.stdout()).toContain(`dotweave/${packageJson.version}`);
    expect(output.stderr()).toBe("");
  });

  it("prints root help from the real application", async () => {
    const output = captureProcessOutput();

    await runCli([]);

    expect(process.exitCode).toBe(0);
    expect(output.stderr()).toBe("");

    for (const commandName of [
      "autocomplete",
      ...Object.keys(rootCommandRoutes),
    ]) {
      expect(output.stdout()).toContain(commandName);
    }

    expect(output.stdout()).toContain(
      "Manage active and assigned sync profiles",
    );
  });

  it("prints autocomplete scripts and internal completions", async () => {
    const scriptOutput = captureProcessOutput();

    await runCli(["autocomplete", "bash"]);

    expect(process.exitCode).toBe(0);
    expect(scriptOutput.stdout()).toContain("__dotweave_complete() {");
    expect(scriptOutput.stderr()).toBe("");

    vi.restoreAllMocks();
    process.exitCode = undefined;

    const completionOutput = captureProcessOutput();

    await runCli(["__complete", "dotweave", "aut"]);

    expect(process.exitCode).toBe(0);
    expect(completionOutput.stdout()).toContain("autocomplete");
    expect(completionOutput.stderr()).toBe("");
  });

  it("reports unknown commands with a suggestion", async () => {
    const output = captureProcessOutput();

    await runCli(["profiel"]);

    expect(Number(process.exitCode)).not.toBe(0);
    expect(output.stdout()).toBe("");
    expect(output.stderr()).toContain('Command "profiel" not found.');
    expect(output.stderr()).toContain("profile");
  });

  it("respects custom command exit codes", () => {
    expect(
      resolveExitCode(Object.assign(new Error("blocked"), { exitCode: 7 })),
    ).toBe(7);
  });

  it("falls back to a generic exit code for unsupported error shapes", () => {
    expect(resolveExitCode(new Error("blocked"))).toBe(1);
    expect(resolveExitCode({ exitCode: "7" })).toBe(1);
    expect(resolveExitCode(null)).toBe(1);
  });

  it("formats non-Error thrown values without object stringification noise", () => {
    const message = formatApplicationError({
      reason: "boom",
      retryable: false,
    });

    expect(message).toContain("reason");
    expect(message).toContain("boom");
    expect(message).not.toContain("[object Object]");
  });

  it("reports parser errors for invalid flags and missing arguments", async () => {
    const invalidEnumOutput = captureProcessOutput();

    await runCli(["track", "--mode", "bogus", "target"]);

    expect(Number(process.exitCode)).not.toBe(0);
    expect(invalidEnumOutput.stdout()).toBe("");
    expect(invalidEnumOutput.stderr()).toContain(
      'Expected "bogus" to be one of (normal|secret|ignore)',
    );

    vi.restoreAllMocks();
    process.exitCode = undefined;

    const missingArgumentOutput = captureProcessOutput();

    await runCli(["untrack"]);

    expect(Number(process.exitCode)).not.toBe(0);
    expect(missingArgumentOutput.stdout()).toBe("");
    expect(missingArgumentOutput.stderr()).toContain(
      "Expected argument for target",
    );
  });

  it("reports unknown commands without suggestion when no close match exists", async () => {
    const output = captureProcessOutput();

    await runCli(["zzzzzzz"]);

    expect(Number(process.exitCode)).not.toBe(0);
    expect(output.stderr()).toContain('Command "zzzzzzz" not found.');
  });

  it("handles invalid flag on a root command", async () => {
    const output = captureProcessOutput();

    await runCli(["--invalid-flag"]);

    expect(Number(process.exitCode)).not.toBe(0);
    expect(output.stderr().length).toBeGreaterThan(0);
  });

  it("handles --help flag at root level", async () => {
    const output = captureProcessOutput();

    await runCli(["--help"]);

    expect(process.exitCode).toBe(0);
    expect(output.stdout()).toContain(
      "Manage active and assigned sync profiles",
    );
    expect(output.stderr()).toBe("");
  });

  it("handles --help flag on subcommands", async () => {
    const output = captureProcessOutput();

    await runCli(["init", "--help"]);

    expect(process.exitCode).toBe(0);
    expect(output.stdout()).toContain(
      "Create or connect the local dotweave repository",
    );
    expect(output.stderr()).toBe("");
  });

  it("handles command execution errors from track on invalid target", async () => {
    const output = captureProcessOutput();

    await runCli(["track", "/nonexistent/path/that/does/not/exist"]);

    expect(Number(process.exitCode)).not.toBe(0);
    expect(output.stderr().length).toBeGreaterThan(0);
  });
});
