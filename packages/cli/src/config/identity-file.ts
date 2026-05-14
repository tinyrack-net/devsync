import { resolve } from "node:path";
import { AppConstants } from "#app/config/constants.ts";

export const resolveDefaultIdentityFile = (dotweaveHomeDirectory: string) => {
  return resolve(
    dotweaveHomeDirectory,
    AppConstants.INIT.DEFAULT_IDENTITY_FILE_NAME,
  );
};
