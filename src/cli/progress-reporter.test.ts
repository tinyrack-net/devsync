import { afterEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  formatProgressMessage: vi.fn(
    (message: string, options?: { detail?: boolean }) =>
      `${options?.detail === true ? "detail" : "phase"}:${message}`,
  ),
  writeStderr: vi.fn(),
}));

vi.mock("#app/lib/output.js", () => ({
  formatProgressMessage: mocked.formatProgressMessage,
  writeStderr: mocked.writeStderr,
}));

import { createCliProgressReporter } from "./progress-reporter.js";

afterEach(() => {
  vi.clearAllMocks();
});

describe("cli progress reporter", () => {
  it("emits phase messages and suppresses details when not verbose", () => {
    const reporter = createCliProgressReporter();

    reporter.phase("Scanning...");
    reporter.detail("scanned file");

    expect(reporter.verbose).toBe(false);
    expect(mocked.formatProgressMessage).toHaveBeenCalledTimes(1);
    expect(mocked.formatProgressMessage).toHaveBeenCalledWith("Scanning...");
    expect(mocked.writeStderr).toHaveBeenCalledTimes(1);
    expect(mocked.writeStderr).toHaveBeenCalledWith("phase:Scanning...");
  });

  it("emits detail messages when verbose output is enabled", () => {
    const reporter = createCliProgressReporter({ verbose: true });

    reporter.phase("Scanning...");
    reporter.detail("scanned file");

    expect(reporter.verbose).toBe(true);
    expect(mocked.formatProgressMessage).toHaveBeenNthCalledWith(
      1,
      "Scanning...",
    );
    expect(mocked.formatProgressMessage).toHaveBeenNthCalledWith(
      2,
      "scanned file",
      { detail: true },
    );
    expect(mocked.writeStderr).toHaveBeenNthCalledWith(1, "phase:Scanning...");
    expect(mocked.writeStderr).toHaveBeenNthCalledWith(
      2,
      "detail:scanned file",
    );
  });
});
