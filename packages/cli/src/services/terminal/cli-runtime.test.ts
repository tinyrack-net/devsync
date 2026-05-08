import { describe, expect, it } from "vitest";
import { createCliContext } from "./cli-runtime.ts";

describe("cli runtime", () => {
  it("builds a context from the current node runtime", () => {
    expect(createCliContext()).toMatchObject({
      process: {
        stdout: expect.any(Object),
        stderr: expect.any(Object),
      },
    });
  });
});
