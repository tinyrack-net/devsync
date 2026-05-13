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

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type RawManifest = {
  entries?: unknown;
  profiles?: unknown;
  version?: unknown;
};

type RawManifestEntry = {
  kind?: unknown;
  profiles?: unknown;
};

export const readManifestJson = (text: string) => {
  const raw: unknown = JSON.parse(text);
  const manifest = isObject(raw) ? (raw as RawManifest) : {};
  const entries =
    isObject(raw) && Array.isArray(manifest.entries) ? manifest.entries : [];
  const profiles =
    isObject(raw) && Array.isArray(manifest.profiles) ? manifest.profiles : [];
  const version =
    isObject(raw) && typeof manifest.version === "number"
      ? manifest.version
      : 0;
  return { entries, profiles, version };
};

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

export type ParsedManifestEntry = Readonly<{
  kind?: string;
  localPath?: Record<string, string> & { default?: string };
  mode?: Record<string, string> & { default?: string };
  permission?: Record<string, string> & { default?: string };
  profiles?: string[];
  repoPath?: Record<string, string> & { default?: string };
}>;

export const parseManifestEntries = (text: string): ParsedManifestEntry[] => {
  const { entries } = readManifestJson(text);
  return entries.map((entry: unknown) => {
    if (!isObject(entry)) return {};
    const manifestEntry = entry as RawManifestEntry;
    return {
      get kind() {
        return typeof manifestEntry.kind === "string"
          ? manifestEntry.kind
          : undefined;
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
        return Array.isArray(manifestEntry.profiles)
          ? manifestEntry.profiles.filter((p: unknown) => typeof p === "string")
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
