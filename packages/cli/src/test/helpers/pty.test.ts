import { describe, expect, it } from "vitest";

import { createPtyOutputWaiter } from "./pty.ts";

describe("createPtyOutputWaiter", () => {
  it("waits until the output predicate matches the complete output", async () => {
    let output = "";
    const listeners = new Set<() => void>();
    const waiter = createPtyOutputWaiter({
      getOutput: () => output,
      onOutput: (listener) => {
        listeners.add(listener);

        return {
          dispose: () => {
            listeners.delete(listener);
          },
        };
      },
    });
    const notify = () => {
      for (const listener of listeners) {
        listener();
      }
    };

    const waiting = waiter.waitForOutput((currentOutput) => {
      return ["autocomplete", "profile", "status"].every((commandName) =>
        currentOutput.includes(commandName),
      );
    }, 100);

    output = "autocomplete";
    notify();

    output = "autocomplete\nprofile\nstatus";
    notify();

    await expect(waiting).resolves.toBe(output);
    expect(listeners.size).toBe(0);
  });
});
