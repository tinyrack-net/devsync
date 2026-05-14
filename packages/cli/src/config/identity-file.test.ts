import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveDefaultIdentityFile } from "./identity-file.ts";

describe("identity file config", () => {
  it("uses keys.txt under the resolved dotweave home directory", () => {
    expect(resolveDefaultIdentityFile("/tmp/dotweave-home")).toBe(
      resolve("/tmp/dotweave-home", "keys.txt"),
    );
  });
});
