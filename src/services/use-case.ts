import { SyncError } from "./error.ts";

export const asSyncError = (
  error: unknown,
  fallbackMessage: string,
): SyncError => {
  if (error instanceof SyncError) {
    return error;
  }

  return new SyncError(
    error instanceof Error ? error.message : fallbackMessage,
  );
};

export const runSyncUseCase = async <Result>(
  fallbackMessage: string,
  operation: () => Promise<Result>,
): Promise<Result> => {
  try {
    return await operation();
  } catch (error: unknown) {
    throw asSyncError(error, fallbackMessage);
  }
};
