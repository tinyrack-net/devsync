import pc from "picocolors";
import { createSpinner, type Spinner } from "./spinner.ts";
import { color, SYMBOLS } from "./theme.ts";

export interface CliLogger {
  log(message: string): void;
  info(message: string): void;
  success(message: string): void;
  fail(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  start(message: string): void;

  section(title: string): void;

  /** Render a key/value pair aligned to the configured label width. */
  kv(key: string, value: string): void;

  /** Render each item as a list entry using optional bullet and optional last-item highlight. */
  list(
    items: string[],
    opts?: { bullet?: string; highlightLast?: boolean },
  ): void;

  /** Render key/value pairs as aligned list lines, preserving empty-value keys. */
  listKeyValue(items: { key: string; value?: string }[]): void;

  /** Render a visual divider line. */
  divider(): void;

  /** Start and return a spinner bound to stdout for long-running operations. */
  spinner(text: string): Spinner;
}

export type Stream = Pick<
  NodeJS.WriteStream,
  "write" | "isTTY" | "clearLine" | "cursorTo"
>;

const INDENT = "  ";

export const createCliLogger = (
  options: Readonly<{
    stderr?: Stream;
    stdout?: Stream;
    tag?: string;
  }> = {},
): CliLogger =>
  // Build a logger with optional stream overrides and optional prefix tag.
  // Tag is only cosmetic and prepends a dim "[tag]" prefix to every output line.
  (() => {
    // Default to process streams when callers don't pass explicit destination streams.
    const stdout = options.stdout ?? process.stdout;
    const stderr = options.stderr ?? process.stderr;
    const prefix = options.tag === undefined ? "" : pc.dim(`[${options.tag}] `);

    // Single write helper for all stdout/stderr output paths.
    const w = (dest: Stream, msg: string) => {
      dest.write(`${prefix}${msg}\n`);
    };

    // Core logger surface used across commands; each method formats consistently.
    return {
      log: (m) => w(stdout, m),
      info: (m) => w(stdout, `${color.info(SYMBOLS.info)} ${m}`),
      success: (m) => w(stdout, `${color.success(SYMBOLS.success)} ${m}`),
      fail: (m) => w(stdout, `${color.error(SYMBOLS.error)} ${m}`),
      warn: (m) => w(stderr, `${color.warn(SYMBOLS.warn)} ${m}`),
      error: (m) => w(stderr, `${color.error(SYMBOLS.error)} ${m}`),
      start: (m) => w(stdout, `${color.info(SYMBOLS.bullet)} ${color.dim(m)}`),

      section: (title) => {
        w(stdout, "");
        w(stdout, color.bold(title));
      },

      kv: (key, value) => {
        w(stdout, `${INDENT}${color.label(key)}: ${value}`);
      },

      list: (items, opts) => {
        const bullet = opts?.bullet ?? "-";
        for (let i = 0; i < items.length; i++) {
          const isLast = i === items.length - 1;
          const highlight = opts?.highlightLast === true && isLast;
          const line = `${INDENT}${bullet} ${items[i]}`;
          w(stdout, highlight ? color.highlight(line) : line);
        }
      },

      listKeyValue: (items) => {
        const maxKeyLen = Math.max(...items.map((item) => item.key.length));
        for (const item of items) {
          const paddedKey = item.key.padEnd(maxKeyLen);
          if (item.value !== undefined) {
            w(stdout, `${INDENT}${color.label(paddedKey)}  ${item.value}`);
          } else {
            w(stdout, `${INDENT}${color.label(item.key)}`);
          }
        }
      },

      divider: () => {
        w(stdout, color.dim("————————————————"));
      },

      spinner: (text: string) => {
        return createSpinner(stdout, text);
      },
    };
  })();
