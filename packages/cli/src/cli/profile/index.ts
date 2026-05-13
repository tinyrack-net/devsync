import { buildRouteMap } from "@stricli/core";

import profileAddCommand from "#app/cli/profile/add.ts";
import profileListCommand from "#app/cli/profile/list.ts";
import profileRemoveCommand from "#app/cli/profile/remove.ts";
import profileUseCommand from "#app/cli/profile/use.ts";

const profileRoute = buildRouteMap({
  docs: {
    brief: "Manage active and assigned sync profiles",
    fullDescription:
      "Inspect, add, remove, or select manifest-registered profiles.",
  },
  routes: {
    add: profileAddCommand,
    list: profileListCommand,
    remove: profileRemoveCommand,
    use: profileUseCommand,
  },
});

export default profileRoute;
