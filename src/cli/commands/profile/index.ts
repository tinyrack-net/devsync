import { buildRouteMap } from "@stricli/core";

import profileListCommand from "#app/cli/commands/profile/list.js";
import profileUseCommand from "#app/cli/commands/profile/use.js";

const profileRoute = buildRouteMap({
  docs: {
    brief: "Manage active and assigned sync profiles",
    fullDescription:
      "Inspect configured profiles or update which profile devsync should use by default.",
  },
  routes: {
    list: profileListCommand,
    use: profileUseCommand,
  },
});

export default profileRoute;
