import { execFileSync } from "node:child_process";

const getShellPath = (shell: string): string | undefined => {
  const lookupCommand = process.platform === "win32" ? "where" : "which";

  try {
    return execFileSync(lookupCommand, [shell], { encoding: "utf8" })
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
  } catch {
    return undefined;
  }
};

export const bashPath = getShellPath("bash");
export const powerShellPath =
  getShellPath("pwsh") ?? getShellPath("powershell");
export const zshPath = getShellPath("zsh");

export const isBashAvailable = bashPath !== undefined;
export const isPowerShellAvailable = powerShellPath !== undefined;
export const isZshAvailable = zshPath !== undefined;
