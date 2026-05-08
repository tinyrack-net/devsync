import { describe, expect, it, vi } from "vitest";

import { color, SYMBOLS } from "./theme.ts";

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
  describe("SYMBOLS constants", () => {
    it("has expected symbol values", () => {
      expect(SYMBOLS.success).toBe("✔");
      expect(SYMBOLS.error).toBe("✖");
      expect(SYMBOLS.warn).toBe("⚠");
      expect(SYMBOLS.info).toBe("~");
      expect(SYMBOLS.bullet).toBe("·");
      expect(SYMBOLS.arrow).toBe("→");
      expect(SYMBOLS.section).toBe("▼");
    });

    it("has spinner frames array", () => {
      expect(Array.isArray(SYMBOLS.spinner)).toBe(true);
      expect(SYMBOLS.spinner.length).toBeGreaterThan(0);
    });
  });

  describe("color functions", () => {
    it("delegates success to green", () => {
      expect(color.success("ok")).toBe("green(ok)");
    });

    it("delegates error to red", () => {
      expect(color.error("fail")).toBe("red(fail)");
    });

    it("delegates warn to yellow", () => {
      expect(color.warn("caution")).toBe("yellow(caution)");
    });

    it("delegates info to cyan", () => {
      expect(color.info("note")).toBe("cyan(note)");
    });

    it("delegates dim to dim", () => {
      expect(color.dim("faded")).toBe("dim(faded)");
    });

    it("delegates bold to bold", () => {
      expect(color.bold("title")).toBe("bold(title)");
    });

    it("delegates header to bold", () => {
      expect(color.header("heading")).toBe("bold(heading)");
    });

    it("delegates path to dim", () => {
      expect(color.path("/some/path")).toBe("dim(/some/path)");
    });

    it("delegates label to dim", () => {
      expect(color.label("key")).toBe("dim(key)");
    });

    it("delegates highlight to cyan", () => {
      expect(color.highlight("item")).toBe("cyan(item)");
    });

    it("delegates action.add to green", () => {
      expect(color.action.add("+")).toBe("green(+)");
    });

    it("delegates action.modify to yellow", () => {
      expect(color.action.modify("~")).toBe("yellow(~)");
    });

    it("delegates action.delete to red", () => {
      expect(color.action.delete("-")).toBe("red(-)");
    });
  });
});
