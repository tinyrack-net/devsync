import { describe, expect, it, vi } from "vitest";

import { createCliLogger } from "./logger.ts";

vi.mock("./spinner.ts", () => ({
  createSpinner: vi.fn(() => ({
    succeed: vi.fn(),
    fail: vi.fn(),
    warn: vi.fn(),
    stop: vi.fn(),
  })),
}));

vi.mock("./theme.ts", () => {
  const tag = (name: string) => (input: string) => `${name}(${input})`;
  return {
    c: {
      success: tag("success"),
      error: tag("error"),
      warn: tag("warn"),
      info: tag("info"),
      dim: tag("dim"),
      bold: tag("bold"),
      label: tag("label"),
      highlight: tag("highlight"),
    },
    S: {
      success: "✔",
      error: "✖",
      warn: "⚠",
      info: "~",
      bullet: "·",
    },
  };
});

const createMockStream = () => {
  const writes: string[] = [];
  return {
    writes,
    stream: {
      write: (chunk: string) => {
        writes.push(chunk);
        return true;
      },
      isTTY: true,
      clearLine: vi.fn(),
      cursorTo: vi.fn(),
    },
  };
};

describe("cli logger", () => {
  describe("without tag", () => {
    it("writes log messages to stdout", () => {
      const { writes, stream } = createMockStream();
      const logger = createCliLogger({ stdout: stream as never });

      logger.log("hello");
      expect(writes).toContain("hello\n");
    });

    it("writes info messages with info symbol to stdout", () => {
      const { writes, stream } = createMockStream();
      const logger = createCliLogger({ stdout: stream as never });

      logger.info("information");
      expect(writes[0]).toContain("information");
      expect(writes[0]).toContain("info(");
    });

    it("writes success messages with success symbol to stdout", () => {
      const { writes, stream } = createMockStream();
      const logger = createCliLogger({ stdout: stream as never });

      logger.success("done");
      expect(writes[0]).toContain("done");
      expect(writes[0]).toContain("success(");
    });

    it("writes fail messages with error symbol to stdout", () => {
      const { writes, stream } = createMockStream();
      const logger = createCliLogger({ stdout: stream as never });

      logger.fail("broken");
      expect(writes[0]).toContain("broken");
      expect(writes[0]).toContain("error(");
    });

    it("writes start messages with bullet and dim to stdout", () => {
      const { writes, stream } = createMockStream();
      const logger = createCliLogger({ stdout: stream as never });

      logger.start("loading...");
      expect(writes[0]).toContain("loading...");
    });

    it("writes warn messages to stderr", () => {
      const { writes, stream } = createMockStream();
      const logger = createCliLogger({ stderr: stream as never });

      logger.warn("caution");
      expect(writes[0]).toContain("caution");
      expect(writes[0]).toContain("warn(");
    });

    it("writes error messages to stderr", () => {
      const { writes, stream } = createMockStream();
      const logger = createCliLogger({ stderr: stream as never });

      logger.error("critical");
      expect(writes[0]).toContain("critical");
      expect(writes[0]).toContain("error(");
    });
  });

  describe("with tag", () => {
    it("prepends [tag] to all output lines", () => {
      const { writes, stream } = createMockStream();
      const logger = createCliLogger({ stdout: stream as never, tag: "sync" });

      logger.log("message");
      expect(writes[0]).toContain("[sync]");
      expect(writes[0]).toContain("message");
    });
  });

  describe("section", () => {
    it("writes a blank line then a bold title", () => {
      const { writes, stream } = createMockStream();
      const logger = createCliLogger({ stdout: stream as never });

      logger.section("Details");
      expect(writes[0]).toBe("\n");
      expect(writes[1]).toContain("Details");
      expect(writes[1]).toContain("bold(");
    });
  });

  describe("kv", () => {
    it("renders indented label: value", () => {
      const { writes, stream } = createMockStream();
      const logger = createCliLogger({ stdout: stream as never });

      logger.kv("key", "value");
      expect(writes[0]).toContain("key");
      expect(writes[0]).toContain("value");
      expect(writes[0]).toContain("label(");
    });
  });

  describe("list", () => {
    it("renders items with default bullet", () => {
      const { writes, stream } = createMockStream();
      const logger = createCliLogger({ stdout: stream as never });

      logger.list(["alpha", "beta"]);
      expect(writes).toHaveLength(2);
      expect(writes[0]).toContain("- alpha");
      expect(writes[1]).toContain("- beta");
    });

    it("renders items with custom bullet", () => {
      const { writes, stream } = createMockStream();
      const logger = createCliLogger({ stdout: stream as never });

      logger.list(["alpha"], { bullet: "*" });
      expect(writes[0]).toContain("* alpha");
    });

    it("highlights last item when highlightLast is true", () => {
      const { writes, stream } = createMockStream();
      const logger = createCliLogger({ stdout: stream as never });

      logger.list(["alpha", "beta"], { highlightLast: true });
      expect(writes[1]).toContain("highlight(");
    });

    it("renders nothing for an empty list", () => {
      const { writes, stream } = createMockStream();
      const logger = createCliLogger({ stdout: stream as never });

      logger.list([]);
      expect(writes).toHaveLength(0);
    });
  });

  describe("listKeyValue", () => {
    it("renders aligned key/value pairs", () => {
      const { writes, stream } = createMockStream();
      const logger = createCliLogger({ stdout: stream as never });

      logger.listKeyValue([
        { key: "Name", value: "dotweave" },
        { key: "Version", value: "1.0" },
      ]);
      expect(writes).toHaveLength(2);
      expect(writes[0]).toContain("Name");
      expect(writes[0]).toContain("dotweave");
      expect(writes[1]).toContain("Version");
      expect(writes[1]).toContain("1.0");
    });

    it("renders key-only lines when value is undefined", () => {
      const { writes, stream } = createMockStream();
      const logger = createCliLogger({ stdout: stream as never });

      logger.listKeyValue([{ key: "Section" }]);
      expect(writes).toHaveLength(1);
      expect(writes[0]).toContain("Section");
    });
  });

  describe("divider", () => {
    it("writes a dim separator line", () => {
      const { writes, stream } = createMockStream();
      const logger = createCliLogger({ stdout: stream as never });

      logger.divider();
      expect(writes[0]).toContain("dim(");
    });
  });

  describe("spinner", () => {
    it("delegates to createSpinner with stdout", () => {
      const { stream } = createMockStream();
      const logger = createCliLogger({ stdout: stream as never });

      const spinner = logger.spinner("working...");
      expect(spinner).toBeDefined();
      expect(spinner.succeed).toBeInstanceOf(Function);
    });
  });
});
