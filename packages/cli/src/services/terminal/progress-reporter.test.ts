import { afterEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  logger: {
    start: vi.fn(),
    verbose: vi.fn(),
  },
  createCliLogger: vi.fn(),
}));

vi.mock("./logger.ts", () => ({
  createCliLogger: mocked.createCliLogger,
}));

import { createCliProgressReporter } from "./progress-reporter.ts";

afterEach(() => {
  vi.clearAllMocks();
});

describe("cli progress reporter", () => {
  it("suppresses phase and detail messages when not verbose", () => {
    mocked.createCliLogger.mockReturnValue(mocked.logger);

    const reporter = createCliProgressReporter();

    reporter.phase("Scanning...");
    reporter.detail("scanned file");

    expect(reporter.verbose).toBe(false);
    expect(mocked.createCliLogger).toHaveBeenCalledWith({
      stderr: process.stderr,
      stdout: process.stderr,
      verbose: false,
    });
    expect(mocked.logger.start).not.toHaveBeenCalled();
    expect(mocked.logger.verbose).not.toHaveBeenCalled();
  });

  it("emits phase messages and suppresses details when not verbose", () => {
    mocked.createCliLogger.mockReturnValue(mocked.logger);

    const reporter = createCliProgressReporter({ verbose: true });

    reporter.phase("Scanning...");
    reporter.detail("scanned file");

    expect(reporter.verbose).toBe(true);
    expect(mocked.createCliLogger).toHaveBeenCalledWith({
      stderr: process.stderr,
      stdout: process.stderr,
      verbose: true,
    });
    expect(mocked.logger.start).toHaveBeenCalledWith("Scanning...");
    expect(mocked.logger.verbose).toHaveBeenCalledWith("scanned file");
  });
});
