import { type Application, buildRouteMap } from "@stricli/core";
import { buildAutocompleteRoute } from "#app/cli/autocomplete.ts";
import { rootCommandRoutes } from "#app/cli/root-commands.ts";
import type { DevsyncCliContext } from "#app/services/terminal/cli-runtime.ts";

export const buildRootRoute = (
  getApplication: () => Application<DevsyncCliContext>,
) => {
  const { autocompleteRoute, completeCommand } =
    buildAutocompleteRoute(getApplication);

  return buildRouteMap({
    docs: {
      brief: "A personal CLI tool for git-backed configuration sync.",
      fullDescription:
        "Manage tracked configuration files under your home directory, mirror them into a git-backed sync repository, and restore them later on other devices.",
      hideRoute: {
        __complete: true,
      },
    },
    routes: {
      __complete: completeCommand,
      autocomplete: autocompleteRoute,
      ...rootCommandRoutes,
    },
  });
};
