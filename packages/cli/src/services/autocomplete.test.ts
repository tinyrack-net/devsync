import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BASH_AUTOCOMPLETE_SCRIPT,
  POWERSHELL_AUTOCOMPLETE_SCRIPT,
  resolveCompletionInputs,
  ZSH_AUTOCOMPLETE_SCRIPT,
} from "./autocomplete.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("autocomplete helpers", () => {
  it("emits stable shell script invariants", () => {
    expect(BASH_AUTOCOMPLETE_SCRIPT).toContain("__devsync_complete() {");
    expect(BASH_AUTOCOMPLETE_SCRIPT).toContain(
      'env -u COMP_LINE devsync __complete "${inputs[@]}"',
    );
    expect(POWERSHELL_AUTOCOMPLETE_SCRIPT).toContain(
      "Register-ArgumentCompleter -Native -CommandName devsync",
    );
    expect(ZSH_AUTOCOMPLETE_SCRIPT).toContain(
      "add-zsh-hook precmd __devsync_ensure_completion",
    );
  });

  it("strips the cli binary token from raw completion inputs", () => {
    expect(resolveCompletionInputs(["devsync", "track", "fi"])).toEqual([
      "track",
      "fi",
    ]);
    expect(
      resolveCompletionInputs(["C:\\Users\\test\\bin\\devsync.exe", "status"]),
    ).toEqual(["status"]);
  });

  it("prefers COMP_LINE when shells provide a richer completion line", () => {
    vi.stubEnv("COMP_LINE", "  devsync   profile   use   work  ");

    expect(resolveCompletionInputs(["ignored", "tokens"])).toEqual([
      "profile",
      "use",
      "work",
      "",
    ]);
  });

  it("returns an empty input list for blank completion lines", () => {
    vi.stubEnv("COMP_LINE", "   ");

    expect(resolveCompletionInputs(["devsync", "track"])).toEqual([]);
  });
});
