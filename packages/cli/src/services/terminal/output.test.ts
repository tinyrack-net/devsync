import { afterEach, describe, expect, it, vi } from "vitest";
import { output, writeStderr, writeStdout } from "./output.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("terminal output", () => {
  it("joins printable lines and appends a trailing newline", () => {
    expect(output("first", undefined, false, null, "second")).toBe(
      "first\nsecond\n",
    );
  });

  it("writes directly to stdout and stderr", () => {
    const stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const stderrWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    writeStdout("hello");
    writeStderr("oops");

    expect(stdoutWrite).toHaveBeenCalledWith("hello");
    expect(stderrWrite).toHaveBeenCalledWith("oops");
  });
});
