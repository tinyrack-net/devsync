import { buildRouteMap } from "@stricli/core";

import profileListCommand from "#app/cli/profile/list.ts";
import profileUseCommand from "#app/cli/profile/use.ts";

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
