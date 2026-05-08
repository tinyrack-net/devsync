export type NoFlags = Record<never, never>;

export const profileFlag = {
  brief: "Use a specific profile layer for this command",
  kind: "parsed",
  optional: true,
  parse: String,
  placeholder: "profile",
} as const;
