import { pathExists } from "#app/lib/filesystem.ts";

/**
 * Strips single-line (//) and block (/* *\/) comments from a JSONC string.
 * Uses a state machine to avoid stripping comment-like sequences inside string literals.
 */
export const stripJsoncComments = (input: string): string => {
  let result = "";
  let i = 0;

  while (i < input.length) {
    const char = input[i] ?? "";

    // String literal — pass through verbatim, handling escape sequences
    if (char === '"') {
      result += char;
      i++;
      while (i < input.length) {
        const c = input[i] ?? "";
        result += c;
        if (c === "\\") {
          i++;
          if (i < input.length) {
            result += input[i];
            i++;
          }
          continue;
        }
        i++;
        if (c === '"') break;
      }
      continue;
    }

    // Single-line comment: skip until end of line
    if (char === "/" && input[i + 1] === "/") {
      while (i < input.length && input[i] !== "\n") {
        i++;
      }
      continue;
    }

    // Block comment: skip until */, preserving newlines for line numbers
    if (char === "/" && input[i + 1] === "*") {
      i += 2;
      while (i < input.length) {
        if (input[i] === "*" && input[i + 1] === "/") {
          i += 2;
          break;
        }
        if (input[i] === "\n") {
          result += "\n";
        }
        i++;
      }
      continue;
    }

    result += char;
    i++;
  }

  return result;
};

export const parseJsonc = (input: string): unknown => {
  return JSON.parse(stripJsoncComments(input));
};

/**
 * Resolves the actual config file path to use for reading.
 * Prefers the given path (expected to end in .jsonc).
 * Falls back to the .json equivalent when the .jsonc file does not exist.
 */
export const resolveExistingConfigPath = async (
  preferredPath: string,
): Promise<string> => {
  if (await pathExists(preferredPath)) {
    return preferredPath;
  }

  if (preferredPath.endsWith(".jsonc")) {
    const jsonPath = preferredPath.slice(0, -1); // .jsonc → .json
    if (await pathExists(jsonPath)) {
      return jsonPath;
    }
  }

  return preferredPath;
};
