import { type Application, buildRouteMap } from "@stricli/core";
import { buildAutocompleteRoute } from "#app/cli/autocomplete.js";
import cdCommand from "#app/cli/cd.js";
import doctorCommand from "#app/cli/doctor.js";
import initCommand from "#app/cli/init.js";
import profileRoute from "#app/cli/profile/index.js";
import pullCommand from "#app/cli/pull.js";
import pushCommand from "#app/cli/push.js";
import statusCommand from "#app/cli/status.js";
import trackCommand from "#app/cli/track.js";
import untrackCommand from "#app/cli/untrack.js";
import type { DevsyncCliContext } from "#app/services/terminal/cli-runtime.js";

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
      cd: cdCommand,
      doctor: doctorCommand,
      init: initCommand,
      profile: profileRoute,
      pull: pullCommand,
      push: pushCommand,
      status: statusCommand,
      track: trackCommand,
      untrack: untrackCommand,
    },
  });
};
