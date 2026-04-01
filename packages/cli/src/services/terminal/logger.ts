import { type ConsolaInstance, createConsola } from "consola";

export type CliLogger = ConsolaInstance;

export const createCliLogger = (
  options: Readonly<{
    stderr?: NodeJS.WriteStream;
    stdout?: NodeJS.WriteStream;
    tag?: string;
    verbose?: boolean;
  }> = {},
): CliLogger => {
  const logger = createConsola({
    formatOptions: {
      colors: process.stdout.isTTY || process.stderr.isTTY,
      compact: true,
      date: false,
    },
    level: options.verbose === true ? 4 : 3,
    ...(options.stderr === undefined ? {} : { stderr: options.stderr }),
    ...(options.stdout === undefined ? {} : { stdout: options.stdout }),
  });

  return options.tag === undefined ? logger : logger.withTag(options.tag);
};
