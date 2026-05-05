import { describe, expect, it, mock } from "bun:test";
import { limitConcurrency } from "./promise.ts";

describe("limitConcurrency", () => {
  it("maps items correctly", async () => {
    const items = [1, 2, 3, 4, 5];
    const mapper = mock().mockImplementation(async (item: number) => {
      return item * 2;
    });

    const results = await limitConcurrency(2, items, mapper);

    expect(results).toEqual([2, 4, 6, 8, 10]);
    expect(mapper).toHaveBeenCalledTimes(5);
  });

  it("limits concurrency", async () => {
    const items = [1, 2, 3, 4, 5];
    let activeCount = 0;
    let maxActiveCount = 0;

    const mapper = async () => {
      activeCount += 1;
      maxActiveCount = Math.max(maxActiveCount, activeCount);
      await new Promise((resolve) => {
        return setTimeout(resolve, 10);
      });
      activeCount -= 1;
    };

    await limitConcurrency(2, items, mapper);

    expect(maxActiveCount).toBeLessThanOrEqual(2);
  });

  it("passes correct indices to the mapper", async () => {
    const items = ["a", "b", "c"];
    const indices: number[] = [];

    await limitConcurrency(2, items, async (_, index) => {
      indices.push(index);
    });

    expect(indices.sort()).toEqual([0, 1, 2]);
  });

  it("handles empty arrays", async () => {
    const results = await limitConcurrency(2, [], async () => {
      return "never";
    });
    expect(results).toEqual([]);
  });

  it("handles concurrency greater than item count", async () => {
    const items = [1, 2];
    const results = await limitConcurrency(10, items, async (item) => {
      return item;
    });
    expect(results).toEqual([1, 2]);
  });

  it("propagates errors", async () => {
    const items = [1, 2, 3];
    const mapper = async (item: number) => {
      if (item === 2) {
        throw new Error("fail");
      }
      return item;
    };

    await expect(limitConcurrency(2, items, mapper)).rejects.toThrow("fail");
  });
});
