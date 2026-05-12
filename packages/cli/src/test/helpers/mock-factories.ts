import { vi } from "vitest";

export type MockStream = Pick<
  NodeJS.WriteStream,
  "write" | "isTTY" | "clearLine" | "cursorTo"
> & {
  writes: string[];
};

export const createMockStream = (isTTY = true): MockStream => {
  const writes: string[] = [];
  return {
    writes,
    write: (chunk: string) => {
      writes.push(String(chunk));
      return true;
    },
    isTTY,
    clearLine: vi.fn(),
    cursorTo: vi.fn(),
  };
};

export const createMockReadEnv = (
  env: Partial<Record<string, string>> = {},
): ((name: string) => string | undefined) => {
  return (name: string): string | undefined => env[name];
};

export const readManifestJson = (text: string) => {
  const raw = JSON.parse(text);
  const entries = Array.isArray(raw?.entries) ? raw.entries : [];
  const version = typeof raw?.version === "number" ? raw.version : 0;
  return { entries, version };
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getStringRecord = (
  value: unknown,
  key: string,
): Record<string, string> | undefined => {
  if (!isObject(value)) return undefined;
  const prop = value[key];
  if (!isObject(prop)) return undefined;
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(prop)) {
    if (typeof v === "string") result[k] = v;
  }
  return result;
};

export const parseManifestEntries = (text: string) => {
  const { entries } = readManifestJson(text);
  return entries.map((entry: unknown) => {
    if (!isObject(entry)) return {};
    return {
      get kind() {
        return typeof entry.kind === "string" ? entry.kind : undefined;
      },
      get localPath() {
        return getStringRecord(entry, "localPath");
      },
      get mode() {
        return getStringRecord(entry, "mode");
      },
      get repoPath() {
        return getStringRecord(entry, "repoPath");
      },
      get permission() {
        return getStringRecord(entry, "permission");
      },
      get profiles() {
        return Array.isArray(entry.profiles)
          ? entry.profiles.filter((p: unknown) => typeof p === "string")
          : undefined;
      },
    };
  });
};

export const readSettingsJson = (text: string) => {
  const raw = JSON.parse(text);
  const activeProfile =
    typeof raw?.activeProfile === "string" ? raw.activeProfile : undefined;
  const version = typeof raw?.version === "number" ? raw.version : undefined;
  return {
    ...(activeProfile !== undefined ? { activeProfile } : {}),
    ...(version !== undefined ? { version } : {}),
  };
};
