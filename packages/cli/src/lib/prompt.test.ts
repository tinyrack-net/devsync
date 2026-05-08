import { describe, expect, it, vi } from "vitest";

const mockCreateInterface = vi.hoisted(() => ({
  question: vi.fn<(q: string) => Promise<string>>(),
  close: vi.fn(),
}));

vi.mock("node:readline/promises", () => ({
  createInterface: () => mockCreateInterface,
}));

import { ask } from "./prompt.ts";

describe("prompt", () => {
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
});
