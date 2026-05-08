import pc from "picocolors";
import { createSpinner, type Spinner } from "./spinner.ts";
import { c, S } from "./theme.ts";

export interface CliLogger {
  log(message: string): void;
  info(message: string): void;
  success(message: string): void;
  fail(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  start(message: string): void;
  withTag(tag: string): CliLogger;

  section(title: string): void;
  kv(key: string, value: string): void;
  list(
    items: string[],
    opts?: { bullet?: string; highlightLast?: boolean },
  ): void;
  listKeyValue(items: { key: string; value?: string }[]): void;
  divider(): void;

  spinner(text: string): Spinner;
}

type Stream = Pick<
  NodeJS.WriteStream,
  "write" | "isTTY" | "clearLine" | "cursorTo"
>;

const INDENT = "  ";

const createImpl = (
  stdout: Stream,
  stderr: Stream,
  tag: string | undefined,
): CliLogger => {
  const prefix = tag === undefined ? "" : pc.dim(`[${tag}] `);

  const w = (dest: Stream, msg: string) => {
    dest.write(`${prefix}${msg}\n`);
  };

  const logger: CliLogger = {
    log: (m) => w(stdout, m),
    info: (m) => w(stdout, `${c.info(S.info)} ${m}`),
    success: (m) => w(stdout, `${c.success(S.success)} ${m}`),
    fail: (m) => w(stdout, `${c.error(S.error)} ${m}`),
    warn: (m) => w(stderr, `${c.warn(S.warn)} ${m}`),
    error: (m) => w(stderr, `${c.error(S.error)} ${m}`),
    start: (m) => w(stdout, `${c.info(S.bullet)} ${c.dim(m)}`),

    section: (title) => {
      w(stdout, "");
      w(stdout, c.bold(title));
    },

    kv: (key, value) => {
      w(stdout, `${INDENT}${c.label(key)}: ${value}`);
    },

    list: (items, opts) => {
      const bullet = opts?.bullet ?? "-";
      for (let i = 0; i < items.length; i++) {
        const isLast = i === items.length - 1;
        const highlight = opts?.highlightLast === true && isLast;
        const line = `${INDENT}${bullet} ${items[i]}`;
        w(stdout, highlight ? c.highlight(line) : line);
      }
    },

    listKeyValue: (items) => {
      const maxKeyLen = Math.max(...items.map((item) => item.key.length));
      for (const item of items) {
        const paddedKey = item.key.padEnd(maxKeyLen);
        if (item.value !== undefined) {
          w(stdout, `${INDENT}${c.label(paddedKey)}  ${item.value}`);
        } else {
          w(stdout, `${INDENT}${c.label(item.key)}`);
        }
      }
    },

    divider: () => {
      w(stdout, c.dim("————————————————"));
    },

    spinner: (text: string) => {
      return createSpinner(stdout, text);
    },

    withTag: (t) => createImpl(stdout, stderr, t),
  };

  return logger;
};

export const createCliLogger = (
  options: Readonly<{
    stderr?: NodeJS.WriteStream;
    stdout?: NodeJS.WriteStream;
    tag?: string;
  }> = {},
): CliLogger =>
  createImpl(
    options.stdout ?? process.stdout,
    options.stderr ?? process.stderr,
    options.tag,
  );
