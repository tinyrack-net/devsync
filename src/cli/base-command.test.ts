import { Command } from "@oclif/core";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  createCliProgressReporter: vi.fn(
    (options?: { verbose?: boolean }) =>
      ({
        detail: vi.fn(),
        phase: vi.fn(),
        verbose: options?.verbose ?? false,
      }) as const,
  ),
  formatDevsyncError: vi.fn((error: Error | string) =>
    typeof error === "string" ? error : `formatted:${error.message}`,
  ),
  formatErrorMessage: vi.fn(
    (message: Error | string) =>
      `stderr:${typeof message === "string" ? message : message.message}`,
  ),
  writeStderr: vi.fn(),
  writeStdout: vi.fn(),
}));

vi.mock("#app/cli/progress-reporter.js", () => ({
  createCliProgressReporter: mocked.createCliProgressReporter,
}));

vi.mock("#app/lib/output.js", () => ({
  formatErrorMessage: mocked.formatErrorMessage,
  writeStderr: mocked.writeStderr,
  writeStdout: mocked.writeStdout,
}));

vi.mock("#app/services/error.js", () => ({
  formatDevsyncError: mocked.formatDevsyncError,
}));

import { BaseCommand } from "./base-command.js";

class TestCommand extends BaseCommand {
  public async run() {}

  public callCreateProgressReporter(verbose = false) {
    return this.createProgressReporter(verbose);
  }

  public callPrint(output: string) {
    this.print(output);
  }

  public callPrintError(message: Error | string) {
    this.printError(message);
  }
}

const createCommand = () => {
  const command = Object.create(TestCommand.prototype) as TestCommand;
  const exitSpy = vi.fn((code?: number): never => {
    throw new Error(`exit:${code}`);
  });
  Object.defineProperty(command, "exit", {
    configurable: true,
    value: exitSpy,
  });

  return {
    command,
    exitSpy,
  };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("base command", () => {
  it("prints standard output and formatted errors", () => {
    const { command } = createCommand();

    command.callPrint("hello");
    command.callPrintError(new Error("nope"));

    expect(mocked.writeStdout).toHaveBeenCalledWith("hello");
    expect(mocked.formatErrorMessage).toHaveBeenCalledWith(expect.any(Error));
    expect(mocked.writeStderr).toHaveBeenCalledWith("stderr:nope");
  });

  it("creates a CLI progress reporter with the requested verbosity", () => {
    const { command } = createCommand();

    const reporter = command.callCreateProgressReporter(true);

    expect(mocked.createCliProgressReporter).toHaveBeenCalledWith({
      verbose: true,
    });
    expect(reporter.verbose).toBe(true);
  });

  it("prints formatted Devsync errors and prefers the oclif exit code", async () => {
    const { command, exitSpy } = createCommand();
    const error = Object.assign(new Error("boom"), {
      exitCode: 2,
      oclif: { exit: 7 },
    });
    exitSpy.mockImplementation((code?: number): never => {
      throw new Error(`exit:${code}`);
    });

    await expect(command.catch(error)).rejects.toThrowError("exit:7");

    expect(mocked.formatDevsyncError).toHaveBeenCalledWith(error);
    expect(mocked.writeStderr).toHaveBeenCalledWith("stderr:formatted:boom");
    expect(exitSpy).toHaveBeenCalledWith(7);
  });

  it("falls back to exitCode and then 1 for regular errors", async () => {
    const withExitCode = createCommand();
    const withoutExitCode = createCommand();
    withExitCode.exitSpy.mockImplementation((code?: number): never => {
      throw new Error(`exit:${code}`);
    });
    withoutExitCode.exitSpy.mockImplementation((code?: number): never => {
      throw new Error(`exit:${code}`);
    });

    await expect(
      withExitCode.command.catch(
        Object.assign(new Error("bad"), { exitCode: 4 }),
      ),
    ).rejects.toThrowError("exit:4");
    await expect(
      withoutExitCode.command.catch(new Error("worse")),
    ).rejects.toThrowError("exit:1");

    expect(withExitCode.exitSpy).toHaveBeenCalledWith(4);
    expect(withoutExitCode.exitSpy).toHaveBeenCalledWith(1);
  });

  it("delegates non-Error values to the parent command handler", async () => {
    const { command } = createCommand();
    const parentCatch = vi
      .spyOn(
        Command.prototype as unknown as {
          catch(error: unknown): Promise<unknown>;
        },
        "catch",
      )
      .mockResolvedValue("handled-by-parent");

    await expect(command.catch("boom" as never)).resolves.toBe(
      "handled-by-parent",
    );

    expect(parentCatch).toHaveBeenCalledWith("boom");
  });
});
