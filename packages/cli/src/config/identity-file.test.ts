import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveDefaultIdentityFile } from "./identity-file.ts";

describe("identity file config", () => {
  it("always uses ~/.config/dotweave/keys.txt under HOME", () => {
    expect(resolveDefaultIdentityFile("/tmp/home", "/tmp/xdg-config")).toBe(
      resolve("/tmp/home", ".config", "dotweave", "keys.txt"),
    );
  });
});
