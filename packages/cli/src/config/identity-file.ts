import { CONSTANTS } from "#app/config/constants.ts";
import { resolveConfiguredAbsolutePath } from "#app/config/xdg.ts";

export const resolveDefaultIdentityFile = (
  home: string | undefined,
  xdgConfigHome: string | undefined,
) => {
  return resolveConfiguredAbsolutePath(
    CONSTANTS.INIT.DEFAULT_IDENTITY_FILE,
    home,
    xdgConfigHome,
  );
};

export const resolveLegacyIdentityFile = (
  home: string | undefined,
  xdgConfigHome: string | undefined,
) => {
  return resolveConfiguredAbsolutePath(
    CONSTANTS.INIT.LEGACY_IDENTITY_FILE,
    home,
    xdgConfigHome,
  );
};
