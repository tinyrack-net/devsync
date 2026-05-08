import { buildRouteMap } from "@stricli/core";
import { buildAutocompleteRoute } from "#app/cli/autocomplete.ts";
import { rootCommandRoutes } from "#app/cli/root-commands.ts";
import { AppConstants } from "#app/config/constants.ts";

export const buildRootRoute = () => {
  const { autocompleteRoute, completeCommand } = buildAutocompleteRoute();

  return buildRouteMap({
    docs: {
      brief: "A personal CLI tool for git-backed configuration sync.",
      fullDescription:
        "Manage tracked configuration files under your home directory, mirror them into a git-backed sync directory, and restore them later on other devices.",
      hideRoute: {
        [AppConstants.AUTOCOMPLETE.COMPLETE_SUBCOMMAND]: true,
      },
    },
    routes: {
      [AppConstants.AUTOCOMPLETE.COMPLETE_SUBCOMMAND]: completeCommand,
      autocomplete: autocompleteRoute,
      ...rootCommandRoutes,
    },
  });
};
