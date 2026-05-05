import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import packageJson from "../package.json" with { type: "json" };
import { runCli } from "./application.ts";
import { rootCommandNames } from "./cli/root-commands.ts";

const captureProcessOutput = () => {
  let stdout = "";
  let stderr = "";

  spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    stdout += String(chunk);

    return true;
  }) as never);
  spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
    stderr += String(chunk);

    return true;
  }) as never);

  return {
    stderr: () => stderr,
    stdout: () => stdout,
  };
};

afterEach(() => {
  process.exitCode = undefined;
  mock.restore();
});

describe("CLI application", () => {
  it("prints the current version", async () => {
    const output = captureProcessOutput();

    await runCli(["--version"]);

    expect(process.exitCode as unknown as number).toBe(0);
    expect(output.stdout()).toContain(`dotweave/${packageJson.version}`);
    expect(output.stderr()).toBe("");
  });

  it("prints root help from the real application", async () => {
    const output = captureProcessOutput();

    await runCli([]);

    expect(process.exitCode as unknown as number).toBe(0);
    expect(output.stderr()).toBe("");

    for (const commandName of rootCommandNames) {
      expect(output.stdout()).toContain(commandName);
    }

    expect(output.stdout()).toContain(
      "Manage active and assigned sync profiles",
    );
  });

  it("prints autocomplete scripts and internal completions", async () => {
    const scriptOutput = captureProcessOutput();

    await runCli(["autocomplete", "bash"]);

    expect(process.exitCode as unknown as number).toBe(0);
    expect(scriptOutput.stdout()).toContain("__dotweave_complete() {");
    expect(scriptOutput.stderr()).toBe("");

    mock.restore();
    process.exitCode = undefined;

    const completionOutput = captureProcessOutput();

    await runCli(["__complete", "dotweave", "aut"]);

    expect(process.exitCode as unknown as number).toBe(0);
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

  it("reports parser errors for invalid flags and missing arguments", async () => {
    const invalidEnumOutput = captureProcessOutput();

    await runCli(["track", "--mode", "bogus", "target"]);

    expect(Number(process.exitCode)).not.toBe(0);
    expect(invalidEnumOutput.stdout()).toBe("");
    expect(invalidEnumOutput.stderr()).toContain(
      'Expected "bogus" to be one of (normal|secret|ignore)',
    );

    mock.restore();
    process.exitCode = undefined;

    const missingArgumentOutput = captureProcessOutput();

    await runCli(["untrack"]);

    expect(Number(process.exitCode)).not.toBe(0);
    expect(missingArgumentOutput.stdout()).toBe("");
    expect(missingArgumentOutput.stderr()).toContain(
      "Expected argument for target",
    );
  });
});
