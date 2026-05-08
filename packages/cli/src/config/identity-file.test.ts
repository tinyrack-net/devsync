import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveDefaultIdentityFile } from "./identity-file.ts";

describe("identity file config", () => {
  it("always uses ~/.config/dotweave/keys.txt under HOME", () => {
    expect(resolveDefaultIdentityFile("/tmp/home", "/tmp/xdg-config")).toBe(
      resolve("/tmp/home", ".config", "dotweave", "keys.txt"),
    );
  });

  it("falls back to HOME-based path when XDG_CONFIG_HOME is undefined", () => {
    expect(resolveDefaultIdentityFile("/tmp/home", undefined)).toBe(
      resolve("/tmp/home", ".config", "dotweave", "keys.txt"),
    );
  });

  it("resolves correctly when HOME contains a trailing slash", () => {
    expect(resolveDefaultIdentityFile("/tmp/home/", "/tmp/xdg")).toBe(
      resolve("/tmp/home", ".config", "dotweave", "keys.txt"),
    );
  });

  it("handles both HOME and XDG_CONFIG_HOME being the same directory", () => {
    expect(
      resolveDefaultIdentityFile("/tmp/home/.config", "/tmp/home/.config"),
    ).toBe(resolve("/tmp/home/.config", ".config", "dotweave", "keys.txt"));
  });
});
