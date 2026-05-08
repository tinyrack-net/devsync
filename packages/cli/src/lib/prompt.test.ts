import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateInterface = vi.hoisted(() => ({
  question: vi.fn<(q: string) => Promise<string>>(),
  close: vi.fn(),
}));

vi.mock("node:readline/promises", () => ({
  createInterface: () => mockCreateInterface,
}));

import { ask } from "./prompt.ts";

describe("prompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the answer from readline", async () => {
    mockCreateInterface.question.mockResolvedValue("yes");
    mockCreateInterface.close.mockReturnValue(undefined);

    const result = await ask("Continue? ");

    expect(result).toBe("yes");
    expect(mockCreateInterface.question).toHaveBeenCalledWith("Continue? ");
    expect(mockCreateInterface.close).toHaveBeenCalled();
  });

  it("closes readline even when question rejects", async () => {
    mockCreateInterface.question.mockRejectedValue(new Error("interrupted"));
    mockCreateInterface.close.mockReturnValue(undefined);

    await expect(ask("Continue? ")).rejects.toThrow("interrupted");
    expect(mockCreateInterface.close).toHaveBeenCalled();
  });

  it("returns empty string when user provides no input", async () => {
    mockCreateInterface.question.mockResolvedValue("");
    mockCreateInterface.close.mockReturnValue(undefined);

    const result = await ask("Continue? ");

    expect(result).toBe("");
    expect(mockCreateInterface.close).toHaveBeenCalled();
  });

  it("handles multiple sequential ask calls", async () => {
    mockCreateInterface.question
      .mockResolvedValueOnce("a1")
      .mockResolvedValueOnce("a2");
    mockCreateInterface.close.mockReturnValue(undefined);

    const r1 = await ask("Q1? ");
    const r2 = await ask("Q2? ");

    expect(r1).toBe("a1");
    expect(r2).toBe("a2");
    expect(mockCreateInterface.question).toHaveBeenCalledWith("Q1? ");
    expect(mockCreateInterface.question).toHaveBeenCalledWith("Q2? ");
    expect(mockCreateInterface.close).toHaveBeenCalledTimes(2);
  });

  it("handles special characters in question prompts", async () => {
    mockCreateInterface.question.mockResolvedValue("val");
    mockCreateInterface.close.mockReturnValue(undefined);

    await ask("Enter value for --flag: ");

    expect(mockCreateInterface.question).toHaveBeenCalledWith(
      "Enter value for --flag: ",
    );
  });

  it("calls close for every ask call regardless of question result", async () => {
    mockCreateInterface.question.mockResolvedValue("ok");
    mockCreateInterface.close.mockReturnValue(undefined);

    await ask("Q1? ");
    await ask("Q2? ");
    await ask("Q3? ");

    expect(mockCreateInterface.close).toHaveBeenCalledTimes(3);
  });
});
