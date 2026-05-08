import { describe, expect, it, vi } from "vitest";

import { createMockStream } from "#test/helpers/mock-factories.ts";
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

describe("cli logger", () => {
  describe("without tag", () => {
    it("writes log messages to stdout", () => {
      const stdout = createMockStream();
      const logger = createCliLogger({ stdout });

      logger.log("hello");
      expect(stdout.writes).toContain("hello\n");
    });

    it("writes info messages with info symbol to stdout", () => {
      const stdout = createMockStream();
      const logger = createCliLogger({ stdout });

      logger.info("information");
      expect(stdout.writes[0]).toContain("information");
      expect(stdout.writes[0]).toContain("info(");
    });

    it("writes success messages with success symbol to stdout", () => {
      const stdout = createMockStream();
      const logger = createCliLogger({ stdout });

      logger.success("done");
      expect(stdout.writes[0]).toContain("done");
      expect(stdout.writes[0]).toContain("success(");
    });

    it("writes fail messages with error symbol to stdout", () => {
      const stdout = createMockStream();
      const logger = createCliLogger({ stdout });

      logger.fail("broken");
      expect(stdout.writes[0]).toContain("broken");
      expect(stdout.writes[0]).toContain("error(");
    });

    it("writes start messages with bullet and dim to stdout", () => {
      const stdout = createMockStream();
      const logger = createCliLogger({ stdout });

      logger.start("loading...");
      expect(stdout.writes[0]).toContain("loading...");
    });

    it("writes warn messages to stderr", () => {
      const stderr = createMockStream();
      const logger = createCliLogger({ stderr });

      logger.warn("caution");
      expect(stderr.writes[0]).toContain("caution");
      expect(stderr.writes[0]).toContain("warn(");
    });

    it("writes error messages to stderr", () => {
      const stderr = createMockStream();
      const logger = createCliLogger({ stderr });

      logger.error("critical");
      expect(stderr.writes[0]).toContain("critical");
      expect(stderr.writes[0]).toContain("error(");
    });
  });

  describe("with tag", () => {
    it("prepends [tag] to all output lines", () => {
      const stdout = createMockStream();
      const logger = createCliLogger({ stdout, tag: "sync" });

      logger.log("message");
      expect(stdout.writes[0]).toContain("[sync]");
      expect(stdout.writes[0]).toContain("message");
    });
  });

  describe("section", () => {
    it("writes a blank line then a bold title", () => {
      const stdout = createMockStream();
      const logger = createCliLogger({ stdout });

      logger.section("Details");
      expect(stdout.writes[0]).toBe("\n");
      expect(stdout.writes[1]).toContain("Details");
      expect(stdout.writes[1]).toContain("bold(");
    });
  });

  describe("kv", () => {
    it("renders indented label: value", () => {
      const stdout = createMockStream();
      const logger = createCliLogger({ stdout });

      logger.kv("key", "value");
      expect(stdout.writes[0]).toContain("key");
      expect(stdout.writes[0]).toContain("value");
      expect(stdout.writes[0]).toContain("label(");
    });
  });

  describe("list", () => {
    it("renders items with default bullet", () => {
      const stdout = createMockStream();
      const logger = createCliLogger({ stdout });

      logger.list(["alpha", "beta"]);
      expect(stdout.writes).toHaveLength(2);
      expect(stdout.writes[0]).toContain("- alpha");
      expect(stdout.writes[1]).toContain("- beta");
    });

    it("renders items with custom bullet", () => {
      const stdout = createMockStream();
      const logger = createCliLogger({ stdout });

      logger.list(["alpha"], { bullet: "*" });
      expect(stdout.writes[0]).toContain("* alpha");
    });

    it("highlights last item when highlightLast is true", () => {
      const stdout = createMockStream();
      const logger = createCliLogger({ stdout });

      logger.list(["alpha", "beta"], { highlightLast: true });
      expect(stdout.writes[1]).toContain("highlight(");
    });

    it("renders nothing for an empty list", () => {
      const stdout = createMockStream();
      const logger = createCliLogger({ stdout });

      logger.list([]);
      expect(stdout.writes).toHaveLength(0);
    });
  });

  describe("listKeyValue", () => {
    it("renders aligned key/value pairs", () => {
      const stdout = createMockStream();
      const logger = createCliLogger({ stdout });

      logger.listKeyValue([
        { key: "Name", value: "dotweave" },
        { key: "Version", value: "1.0" },
      ]);
      expect(stdout.writes).toHaveLength(2);
      expect(stdout.writes[0]).toContain("Name");
      expect(stdout.writes[0]).toContain("dotweave");
      expect(stdout.writes[1]).toContain("Version");
      expect(stdout.writes[1]).toContain("1.0");
    });

    it("renders key-only lines when value is undefined", () => {
      const stdout = createMockStream();
      const logger = createCliLogger({ stdout });

      logger.listKeyValue([{ key: "Section" }]);
      expect(stdout.writes).toHaveLength(1);
      expect(stdout.writes[0]).toContain("Section");
    });
  });

  describe("divider", () => {
    it("writes a dim separator line", () => {
      const stdout = createMockStream();
      const logger = createCliLogger({ stdout });

      logger.divider();
      expect(stdout.writes[0]).toContain("dim(");
    });
  });

  describe("spinner", () => {
    it("delegates to createSpinner with stdout", () => {
      const stdout = createMockStream();
      const logger = createCliLogger({ stdout });

      const spinner = logger.spinner("working...");
      expect(spinner).toBeDefined();
      expect(spinner.succeed).toBeInstanceOf(Function);
    });
  });
});
