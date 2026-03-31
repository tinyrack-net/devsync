import { afterEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  createCliProgressReporter: vi.fn(),
  writeStdout: vi.fn(),
}));

vi.mock("#app/lib/output.ts", () => ({
  writeStdout: mocked.writeStdout,
}));

vi.mock("./progress-reporter.ts", () => ({
  createCliProgressReporter: mocked.createCliProgressReporter,
}));

import {
  createCliContext,
  createProgressReporter,
  isVerbose,
  print,
} from "./cli-runtime.ts";

afterEach(() => {
  vi.clearAllMocks();
});

describe("cli runtime", () => {
  it("builds a context from the current node runtime", () => {
    expect(createCliContext()).toMatchObject({
      fs: {
        promises: expect.any(Object),
      },
      os: expect.any(Object),
      path: expect.any(Object),
      process,
    });
  });

  it("normalizes verbose flags before creating reporters", () => {
    const reporter = { detail: vi.fn(), phase: vi.fn(), verbose: false };
    mocked.createCliProgressReporter.mockReturnValue(reporter);

    expect(isVerbose(undefined)).toBe(false);
    expect(isVerbose(false)).toBe(false);
    expect(isVerbose(true)).toBe(true);
    expect(createProgressReporter()).toBe(reporter);
    expect(createProgressReporter(true)).toBe(reporter);
    expect(mocked.createCliProgressReporter).toHaveBeenNthCalledWith(1, {
      verbose: false,
    });
    expect(mocked.createCliProgressReporter).toHaveBeenNthCalledWith(2, {
      verbose: true,
    });
  });

  it("prints through the shared stdout writer", () => {
    print("hello");

    expect(mocked.writeStdout).toHaveBeenCalledWith("hello");
  });
});
