import { describe, expect, test } from "vitest";
import z from "zod";
import { parseWithZod } from "./zod.ts";

describe("parseWithZod", () => {
  test("returns parsed data for valid input", async () => {
    const schema = z.string();
    const result = await parseWithZod("hello", { schema });

    expect(result).toBe("hello");
  });

  test("throws with formatted error for invalid input", async () => {
    const schema = z.enum(["a", "b"] as const);

    await expect(parseWithZod("c", { schema })).rejects.toThrow(/Invalid/u);
  });

  test("includes label in error path formatting", async () => {
    const schema = z.object({ name: z.string() });

    await expect(
      parseWithZod("not-an-object", { label: "config", schema }),
    ).rejects.toThrow(/^config[:.]/u);
  });

  test("omits label prefix when label not provided", async () => {
    const schema = z.string().min(1);

    await expect(parseWithZod("", { schema })).rejects.not.toThrow(/^\./u);
  });

  test("handles empty path in error issue", async () => {
    const schema = z.string().email();

    await expect(parseWithZod("not-email", { schema })).rejects.toThrow(
      /^[^\n]+$/u,
    );
  });
});
