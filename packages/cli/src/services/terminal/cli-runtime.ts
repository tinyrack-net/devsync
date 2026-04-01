import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { TypedFlagParameter } from "@stricli/core";

export type DevsyncCliContext = {
  fs: {
    promises: typeof fs.promises;
  };
  os: typeof os;
  path: typeof path;
  process: NodeJS.Process;
};

export const verboseFlag = {
  brief: "Show detailed output including file paths and progress details",
  kind: "boolean",
  optional: true,
} satisfies TypedFlagParameter<boolean | undefined, DevsyncCliContext>;

export const createCliContext = (): DevsyncCliContext => {
  return {
    fs: {
      promises: fs.promises,
    },
    os,
    path,
    process,
  };
};
