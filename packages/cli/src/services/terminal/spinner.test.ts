import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSpinner } from "./spinner.ts";

vi.mock("./theme.ts", () => {
  const tag = (name: string) => (input: string) => `${name}(${input})`;
  return {
    c: {
      success: tag("success"),
      error: tag("error"),
      warn: tag("warn"),
      info: tag("info"),
      dim: tag("dim"),
    },
    S: {
      success: "✔",
      error: "✖",
      warn: "⚠",
      bullet: "·",
      spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
    },
  };
});

const createMockStream = (isTTY = true) => {
  const writes: string[] = [];
  return {
    writes,
    stream: {
      write: (chunk: string) => {
        writes.push(chunk);
        return true;
      },
      isTTY,
      clearLine: vi.fn((_: unknown, dir: unknown) => {
        if (dir === 0) writes.push("[CLEAR]");
      }),
      cursorTo: vi.fn(),
    } as never,
  };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("spinner", () => {
  describe("non-TTY path", () => {
    it("writes a static bullet line on creation when isTTY is false", () => {
      const { writes, stream } = createMockStream(false);

      createSpinner(stream, "loading...");
      expect(writes).toHaveLength(1);
      expect(writes[0]).toContain("loading...");
    });

    it("succeed writes a final success line", () => {
      const { writes, stream } = createMockStream(false);

      const spinner = createSpinner(stream, "loading...");
      writes.length = 0;

      spinner.succeed("done");
      expect(writes).toHaveLength(1);
      expect(writes[0]).toContain("done");
      expect(writes[0]).toContain("success(");
    });

    it("fail writes a final error line", () => {
      const { writes, stream } = createMockStream(false);

      const spinner = createSpinner(stream, "loading...");
      writes.length = 0;

      spinner.fail("error");
      expect(writes).toHaveLength(1);
      expect(writes[0]).toContain("error");
      expect(writes[0]).toContain("error(");
    });

    it("warn writes a final warn line", () => {
      const { writes, stream } = createMockStream(false);

      const spinner = createSpinner(stream, "loading...");
      writes.length = 0;

      spinner.warn("caution");
      expect(writes).toHaveLength(1);
      expect(writes[0]).toContain("caution");
      expect(writes[0]).toContain("warn(");
    });

    it("stop does nothing visible on non-TTY", () => {
      const { writes, stream } = createMockStream(false);

      const spinner = createSpinner(stream, "loading...");
      writes.length = 0;

      spinner.stop();
      expect(writes).toHaveLength(0);
    });
  });

  describe("TTY path", () => {
    beforeEach(() => {
      vi.stubEnv("CI", "");
      vi.stubEnv("NO_COLOR", "");
      vi.stubEnv("FORCE_COLOR", "");
    });

    it("starts an interval and renders the first frame", () => {
      const { writes, stream } = createMockStream(true);

      vi.useFakeTimers();
      createSpinner(stream, "working");
      vi.useRealTimers();

      expect(writes.length).toBeGreaterThanOrEqual(1);
    });

    it("succeed clears interval and writes final line", () => {
      const { writes, stream } = createMockStream(true);

      vi.useFakeTimers();
      const spinner = createSpinner(stream, "working");
      vi.advanceTimersByTime(200);
      writes.length = 0;

      spinner.succeed("complete");
      vi.useRealTimers();

      expect(writes.some((w) => w.includes("complete"))).toBe(true);
    });

    it("fail clears interval and writes final line", () => {
      const { writes, stream } = createMockStream(true);

      vi.useFakeTimers();
      const spinner = createSpinner(stream, "working");
      vi.advanceTimersByTime(200);
      writes.length = 0;

      spinner.fail("broken");
      vi.useRealTimers();

      expect(writes.some((w) => w.includes("broken"))).toBe(true);
    });

    it("stop clears interval and clears the line", () => {
      const { stream } = createMockStream(true);

      vi.useFakeTimers();
      const spinner = createSpinner(stream, "working");
      vi.advanceTimersByTime(200);

      spinner.stop();
      vi.useRealTimers();

      expect(
        (stream as unknown as { clearLine: ReturnType<typeof vi.fn> })
          .clearLine,
      ).toHaveBeenCalled();
    });

    it("warn clears interval and writes final line", () => {
      const { writes, stream } = createMockStream(true);

      vi.useFakeTimers();
      const spinner = createSpinner(stream, "working");
      vi.advanceTimersByTime(200);
      writes.length = 0;

      spinner.warn("caution");
      vi.useRealTimers();

      expect(writes.some((w) => w.includes("caution"))).toBe(true);
    });

    it("does not render after stop is called", () => {
      const { writes, stream } = createMockStream(true);

      vi.useFakeTimers();
      const spinner = createSpinner(stream, "working");
      vi.advanceTimersByTime(200);
      spinner.stop();
      writes.length = 0;

      vi.advanceTimersByTime(200);
      vi.useRealTimers();

      expect(writes).toHaveLength(0);
    });
  });
});
