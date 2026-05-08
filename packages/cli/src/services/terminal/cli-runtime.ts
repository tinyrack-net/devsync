import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type DotweaveCliContext = {
  fs: {
    promises: typeof fs.promises;
  };
  os: typeof os;
  path: typeof path;
  process: NodeJS.Process;
};

export const createCliContext = (): DotweaveCliContext => {
  return {
    fs: {
      promises: fs.promises,
    },
    os,
    path,
    process,
  };
};
