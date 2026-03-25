export type ProgressReporter = Readonly<{
  detail(message: string): void;
  phase(message: string): void;
  verbose: boolean;
}>;

export const reportPhase = (
  reporter: ProgressReporter | undefined,
  message: string,
) => {
  reporter?.phase(message);
};

export const reportDetail = (
  reporter: ProgressReporter | undefined,
  message: string,
) => {
  reporter?.detail(message);
};
