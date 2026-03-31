export type ProgressReporter = Readonly<{
  detail(message: string): void;
  phase(message: string): void;
  verbose: boolean;
}>;

/**
 * @description
 * Sends a high-level progress update when a reporter is available.
 */
export const reportPhase = (
  reporter: ProgressReporter | undefined,
  message: string,
) => {
  reporter?.phase(message);
};

/**
 * @description
 * Sends a verbose progress detail when a reporter is available.
 */
export const reportDetail = (
  reporter: ProgressReporter | undefined,
  message: string,
) => {
  reporter?.detail(message);
};
