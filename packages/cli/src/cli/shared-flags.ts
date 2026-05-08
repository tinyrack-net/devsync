export const profileFlag = {
  brief: "Use a specific profile layer for this command",
  kind: "parsed",
  optional: true,
  parse: String,
  placeholder: "profile",
} as const;

export const verboseFlag = {
  brief: "Show detailed debug output",
  kind: "boolean",
  optional: true,
} as const;
