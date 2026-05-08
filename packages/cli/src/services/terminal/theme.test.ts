import { describe, expect, it, vi } from "vitest";

import { c, S } from "./theme.ts";

vi.mock("picocolors", () => {
  const tag = (name: string) => (input: string) => `${name}(${input})`;
  return {
    default: {
      bold: tag("bold"),
      cyan: tag("cyan"),
      dim: tag("dim"),
      green: tag("green"),
      red: tag("red"),
      yellow: tag("yellow"),
    },
  };
});

describe("theme", () => {
  describe("S constants", () => {
    it("has expected symbol values", () => {
      expect(S.success).toBe("✔");
      expect(S.error).toBe("✖");
      expect(S.warn).toBe("⚠");
      expect(S.info).toBe("~");
      expect(S.bullet).toBe("·");
      expect(S.arrow).toBe("→");
      expect(S.section).toBe("▼");
    });

    it("has spinner frames array", () => {
      expect(Array.isArray(S.spinner)).toBe(true);
      expect(S.spinner.length).toBeGreaterThan(0);
    });
  });

  describe("c color functions", () => {
    it("delegates success to green", () => {
      expect(c.success("ok")).toBe("green(ok)");
    });

    it("delegates error to red", () => {
      expect(c.error("fail")).toBe("red(fail)");
    });

    it("delegates warn to yellow", () => {
      expect(c.warn("caution")).toBe("yellow(caution)");
    });

    it("delegates info to cyan", () => {
      expect(c.info("note")).toBe("cyan(note)");
    });

    it("delegates dim to dim", () => {
      expect(c.dim("faded")).toBe("dim(faded)");
    });

    it("delegates bold to bold", () => {
      expect(c.bold("title")).toBe("bold(title)");
    });

    it("delegates header to bold", () => {
      expect(c.header("heading")).toBe("bold(heading)");
    });

    it("delegates path to dim", () => {
      expect(c.path("/some/path")).toBe("dim(/some/path)");
    });

    it("delegates label to dim", () => {
      expect(c.label("key")).toBe("dim(key)");
    });

    it("delegates highlight to cyan", () => {
      expect(c.highlight("item")).toBe("cyan(item)");
    });

    it("delegates action.add to green", () => {
      expect(c.action.add("+")).toBe("green(+)");
    });

    it("delegates action.modify to yellow", () => {
      expect(c.action.modify("~")).toBe("yellow(~)");
    });

    it("delegates action.delete to red", () => {
      expect(c.action.delete("-")).toBe("red(-)");
    });
  });
});
