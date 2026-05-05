import { afterEach, describe, expect, it } from "bun:test";
import {
  BASH_AUTOCOMPLETE_SCRIPT,
  POWERSHELL_AUTOCOMPLETE_SCRIPT,
  resolveCompletionInputs,
  ZSH_AUTOCOMPLETE_SCRIPT,
} from "./autocomplete.ts";

let originalCompLine: string | undefined;

afterEach(() => {
  if (originalCompLine !== undefined) {
    process.env["COMP_LINE"] = originalCompLine;
    originalCompLine = undefined;
  } else {
    delete process.env["COMP_LINE"];
  }
});

describe("autocomplete helpers", () => {
  it("emits stable shell script invariants", () => {
    expect(BASH_AUTOCOMPLETE_SCRIPT).toContain("__dotweave_complete() {");
    expect(BASH_AUTOCOMPLETE_SCRIPT).toContain(
      'env -u COMP_LINE dotweave __complete "${inputs[@]}"',
    );
    expect(POWERSHELL_AUTOCOMPLETE_SCRIPT).toContain(
      "Register-ArgumentCompleter -Native -CommandName dotweave",
    );
    expect(ZSH_AUTOCOMPLETE_SCRIPT).toContain(
      "add-zsh-hook precmd __dotweave_ensure_completion",
    );
  });

  it("strips the cli binary token from raw completion inputs", () => {
    expect(resolveCompletionInputs(["dotweave", "track", "fi"])).toEqual([
      "track",
      "fi",
    ]);
    expect(
      resolveCompletionInputs(["C:\\Users\\test\\bin\\dotweave.exe", "status"]),
    ).toEqual(["status"]);
  });

  it("prefers COMP_LINE when shells provide a richer completion line", () => {
    originalCompLine = process.env["COMP_LINE"];
    process.env["COMP_LINE"] = "  dotweave   profile   use   work  ";

    expect(resolveCompletionInputs(["ignored", "tokens"])).toEqual([
      "profile",
      "use",
      "work",
      "",
    ]);
  });

  it("returns an empty input list for blank completion lines", () => {
    originalCompLine = process.env["COMP_LINE"];
    process.env["COMP_LINE"] = "   ";

    expect(resolveCompletionInputs(["dotweave", "track"])).toEqual([]);
  });
});
