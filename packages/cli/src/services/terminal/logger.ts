import pc from "picocolors";

export interface CliLogger {
  readonly level: number;
  log(message: string): void;
  info(message: string): void;
  success(message: string): void;
  fail(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  start(message: string): void;
  verbose(message: string): void;
  withTag(tag: string): CliLogger;
}

type Stream = Pick<NodeJS.WriteStream, "write">;

const createImpl = (
  stdout: Stream,
  stderr: Stream,
  tag: string | undefined,
  level: number,
): CliLogger => {
  const prefix = tag === undefined ? "" : pc.dim(`[${tag}] `);

  const w = (dest: Stream, msg: string) => {
    dest.write(`${prefix}${msg}\n`);
  };

  const logger: CliLogger = {
    level,
    log: (m) => w(stdout, m),
    info: (m) => w(stdout, pc.cyan(`${pc.bold("i")} ${m}`)),
    success: (m) => w(stdout, pc.green(`${pc.bold("✔")} ${m}`)),
    fail: (m) => w(stdout, pc.red(`${pc.bold("✖")} ${m}`)),
    warn: (m) => w(stderr, pc.yellow(`${pc.bold("⚠")} ${m}`)),
    error: (m) => w(stderr, pc.red(`${pc.bold("✖")} ${m}`)),
    start: (m) => w(stdout, pc.cyan(`${pc.bold("▶")} ${m}`)),
    verbose(m) {
      if (level >= 4) {
        w(stdout, pc.dim(m));
      }
    },
    withTag: (t) => createImpl(stdout, stderr, t, level),
  };

  return logger;
};

export const createCliLogger = (
  options: Readonly<{
    stderr?: NodeJS.WriteStream;
    stdout?: NodeJS.WriteStream;
    tag?: string;
    verbose?: boolean;
  }> = {},
): CliLogger =>
  createImpl(
    options.stdout ?? process.stdout,
    options.stderr ?? process.stderr,
    options.tag,
    options.verbose === true ? 4 : 3,
  );
