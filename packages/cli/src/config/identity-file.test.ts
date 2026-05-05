import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";

import { resolveDefaultIdentityFile } from "./identity-file.ts";

describe("identity file config", () => {
  it("always uses ~/.config/dotweave/keys.txt under HOME", () => {
    expect(resolveDefaultIdentityFile("/tmp/home", "/tmp/xdg-config")).toBe(
      resolve("/tmp/home", ".config", "dotweave", "keys.txt"),
    );
  });
});
