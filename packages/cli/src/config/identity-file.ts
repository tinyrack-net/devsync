import { AppConstants } from "#app/config/constants.ts";
import { resolveConfiguredAbsolutePath } from "#app/config/xdg.ts";

export const resolveDefaultIdentityFile = (
  home: string | undefined,
  xdgConfigHome: string | undefined,
) => {
  return resolveConfiguredAbsolutePath(
    AppConstants.INIT.DEFAULT_IDENTITY_FILE,
    home,
    xdgConfigHome,
  );
};
