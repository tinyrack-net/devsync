import type { ApplicationContext } from "@stricli/core";

export type DotweaveCliContext = ApplicationContext;

export const createCliContext = (): DotweaveCliContext => {
  return {
    process: {
      stdout: process.stdout,
      stderr: process.stderr,
      get env() {
        return process.env;
      },
      get exitCode() {
        return process.exitCode;
      },
      set exitCode(value) {
        process.exitCode = value;
      },
    },
  };
};
