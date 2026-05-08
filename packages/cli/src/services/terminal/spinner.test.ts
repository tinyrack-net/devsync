import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockStream } from "#test/helpers/mock-factories.ts";
import { createSpinner } from "./spinner.ts";

vi.mock("./theme.ts", () => {
  const tag = (name: string) => (input: string) => `${name}(${input})`;
  return {
    color: {
      success: tag("success"),
      error: tag("error"),
      warn: tag("warn"),
      info: tag("info"),
      dim: tag("dim"),
    },
    SYMBOLS: {
      success: "✔",
      error: "✖",
      warn: "⚠",
      bullet: "·",
      spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("spinner", () => {
  describe("non-TTY path", () => {
    it("writes a static bullet line on creation when isTTY is false", () => {
      const stream = createMockStream(false);

      createSpinner(stream, "loading...");
      expect(stream.writes).toHaveLength(1);
      expect(stream.writes[0]).toContain("loading...");
    });

    it("succeed writes a final success line", () => {
      const stream = createMockStream(false);

      const spinner = createSpinner(stream, "loading...");
      stream.writes.length = 0;

      spinner.succeed("done");
      expect(stream.writes).toHaveLength(1);
      expect(stream.writes[0]).toContain("done");
      expect(stream.writes[0]).toContain("success(");
    });

    it("fail writes a final error line", () => {
      const stream = createMockStream(false);

      const spinner = createSpinner(stream, "loading...");
      stream.writes.length = 0;

      spinner.fail("error");
      expect(stream.writes).toHaveLength(1);
      expect(stream.writes[0]).toContain("error");
      expect(stream.writes[0]).toContain("error(");
    });

    it("warn writes a final warn line", () => {
      const stream = createMockStream(false);

      const spinner = createSpinner(stream, "loading...");
      stream.writes.length = 0;

      spinner.warn("caution");
      expect(stream.writes).toHaveLength(1);
      expect(stream.writes[0]).toContain("caution");
      expect(stream.writes[0]).toContain("warn(");
    });

    it("stop does nothing visible on non-TTY", () => {
      const stream = createMockStream(false);

      const spinner = createSpinner(stream, "loading...");
      stream.writes.length = 0;

      spinner.stop();
      expect(stream.writes).toHaveLength(0);
    });
  });

  describe("TTY path", () => {
    beforeEach(() => {
      vi.stubEnv("CI", "");
      vi.stubEnv("NO_COLOR", "");
      vi.stubEnv("FORCE_COLOR", "");
    });

    it("starts an interval and renders the first frame", () => {
      const stream = createMockStream(true);

      vi.useFakeTimers();
      createSpinner(stream, "working");
      vi.useRealTimers();

      expect(stream.writes.length).toBeGreaterThanOrEqual(1);
    });

    it("succeed clears interval and writes final line", () => {
      const stream = createMockStream(true);

      vi.useFakeTimers();
      const spinner = createSpinner(stream, "working");
      vi.advanceTimersByTime(200);
      stream.writes.length = 0;

      spinner.succeed("complete");
      vi.useRealTimers();

      expect(stream.writes.some((w) => w.includes("complete"))).toBe(true);
    });

    it("fail clears interval and writes final line", () => {
      const stream = createMockStream(true);

      vi.useFakeTimers();
      const spinner = createSpinner(stream, "working");
      vi.advanceTimersByTime(200);
      stream.writes.length = 0;

      spinner.fail("broken");
      vi.useRealTimers();

      expect(stream.writes.some((w) => w.includes("broken"))).toBe(true);
    });

    it("stop clears interval and clears the line", () => {
      const stream = createMockStream(true);

      vi.useFakeTimers();
      const spinner = createSpinner(stream, "working");
      vi.advanceTimersByTime(200);

      spinner.stop();
      vi.useRealTimers();

      expect(stream.clearLine).toHaveBeenCalled();
    });

    it("warn clears interval and writes final line", () => {
      const stream = createMockStream(true);

      vi.useFakeTimers();
      const spinner = createSpinner(stream, "working");
      vi.advanceTimersByTime(200);
      stream.writes.length = 0;

      spinner.warn("caution");
      vi.useRealTimers();

      expect(stream.writes.some((w) => w.includes("caution"))).toBe(true);
    });

    it("does not render after stop is called", () => {
      const stream = createMockStream(true);

      vi.useFakeTimers();
      const spinner = createSpinner(stream, "working");
      vi.advanceTimersByTime(200);
      spinner.stop();
      stream.writes.length = 0;

      vi.advanceTimersByTime(200);
      vi.useRealTimers();

      expect(stream.writes).toHaveLength(0);
    });
  });
});
