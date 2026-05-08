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
