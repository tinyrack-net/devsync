import { describe, expect, it } from "bun:test";
import { createCliContext } from "./cli-runtime.ts";

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
});
