export type NoFlags = Record<never, never>;

export const profileFlag = {
  brief:
    "Use a registered profile layer for this command (add non-default profiles with 'dotweave profile add')",
  kind: "parsed",
  optional: true,
  parse: String,
  placeholder: "profile",
} as const;
