import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import { promptForSecret } from "./prompt.js";

class FakeTTYInput extends EventEmitter {
  public isRaw = false;
  public isTTY = true;

  public readonly pause = vi.fn();
  public readonly resume = vi.fn();
  public readonly setEncoding = vi.fn();
  public readonly setRawMode = vi.fn((value: boolean) => {
    this.isRaw = value;
  });
}

class FakeTTYOutput {
  public isTTY = true;
  public readonly write = vi.fn();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe.sequential("secret prompt", () => {
  it("reads from piped stdin when no TTY is available", async () => {
    const stdin = Readable.from(["secret-from-pipe\n"]) as Readable & {
      isTTY: boolean;
    };
    const stderr = {
      isTTY: false,
      write: vi.fn(),
    };

    stdin.isTTY = false;

    vi.spyOn(process, "stdin", "get").mockReturnValue(stdin as never);
    vi.spyOn(process, "stderr", "get").mockReturnValue(stderr as never);

    await expect(promptForSecret("Age key: ")).resolves.toBe(
      "secret-from-pipe",
    );
    expect(stderr.write).not.toHaveBeenCalled();
  });

  it("masks typed characters, ignores navigation keys, and supports backspace", async () => {
    const stdin = new FakeTTYInput();
    const stderr = new FakeTTYOutput();

    vi.spyOn(process, "stdin", "get").mockReturnValue(stdin as never);
    vi.spyOn(process, "stderr", "get").mockReturnValue(stderr as never);

    const prompt = promptForSecret("Age key: ");
    await Promise.resolve();

    stdin.emit("keypress", "a", { name: "a" });
    stdin.emit("keypress", "b", { name: "b" });
    stdin.emit("keypress", "", { name: "left" });
    stdin.emit("keypress", "", { name: "delete" });
    stdin.emit("keypress", "", { name: "backspace" });
    stdin.emit("keypress", "c", { name: "c" });
    stdin.emit("keypress", "\r", { name: "return" });

    await expect(prompt).resolves.toBe("ac");
    expect(stderr.write).toHaveBeenNthCalledWith(1, "Age key: ");
    expect(stderr.write).toHaveBeenNthCalledWith(2, "*");
    expect(stderr.write).toHaveBeenNthCalledWith(3, "*");
    expect(stderr.write).toHaveBeenNthCalledWith(4, "\b \b");
    expect(stderr.write).toHaveBeenNthCalledWith(5, "*");
    expect(stderr.write).toHaveBeenLastCalledWith("\n");
    expect(stdin.setEncoding).toHaveBeenCalledWith("utf8");
    expect(stdin.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(stdin.setRawMode).toHaveBeenLastCalledWith(false);
    expect(stdin.resume).toHaveBeenCalled();
    expect(stdin.pause).toHaveBeenCalled();
  });

  it("rejects when the prompt is cancelled with ctrl-c", async () => {
    const stdin = new FakeTTYInput();
    const stderr = new FakeTTYOutput();

    vi.spyOn(process, "stdin", "get").mockReturnValue(stdin as never);
    vi.spyOn(process, "stderr", "get").mockReturnValue(stderr as never);

    const prompt = promptForSecret("Age key: ");
    await Promise.resolve();

    stdin.emit("keypress", "\u0003", {});

    await expect(prompt).rejects.toThrowError("Age key prompt cancelled.");
    expect(stderr.write).toHaveBeenNthCalledWith(1, "Age key: ");
    expect(stderr.write).toHaveBeenLastCalledWith("\n");
    expect(stdin.setRawMode).toHaveBeenLastCalledWith(false);
  });
});
