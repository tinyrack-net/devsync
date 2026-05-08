import pc from "picocolors";

export const S = {
  success: "✔",
  error: "✖",
  warn: "⚠",
  info: "~",
  add: "+",
  modify: "~",
  delete: "-",
  bullet: "·",
  arrow: "→",
  section: "▼",
  spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
} as const;

export const c = {
  success: (s: string) => pc.green(s),
  error: (s: string) => pc.red(s),
  warn: (s: string) => pc.yellow(s),
  info: (s: string) => pc.cyan(s),
  dim: (s: string) => pc.dim(s),
  bold: (s: string) => pc.bold(s),
  header: (s: string) => pc.bold(s),
  path: (s: string) => pc.dim(s),
  label: (s: string) => pc.dim(s),
  highlight: (s: string) => pc.cyan(s),
  action: {
    add: (s: string) => pc.green(s),
    modify: (s: string) => pc.yellow(s),
    delete: (s: string) => pc.red(s),
  },
} as const;
