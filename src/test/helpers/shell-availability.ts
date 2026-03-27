import { execFileSync } from "node:child_process";

const isShellAvailable = (shell: string): boolean => {
  if (process.platform === "win32") {
    return false;
  }
  try {
    execFileSync("which", [shell], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

export const isBashAvailable = isShellAvailable("bash");
export const isZshAvailable = isShellAvailable("zsh");
