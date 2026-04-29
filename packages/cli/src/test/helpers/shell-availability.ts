import { execFileSync } from "node:child_process";

const getShellPath = (shell: string): string | undefined => {
  if (process.platform === "win32") {
    return undefined;
  }
  try {
    return execFileSync("which", [shell], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
};

export const bashPath = getShellPath("bash");
export const zshPath = getShellPath("zsh");

export const isBashAvailable = bashPath !== undefined;
export const isZshAvailable = zshPath !== undefined;
