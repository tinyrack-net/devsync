import { buildRouteMap } from "@stricli/core";
import skillInstallCommand from "#app/cli/skill/install.ts";

const skillRoute = buildRouteMap({
  docs: {
    brief: "Manage portable agent skills",
    fullDescription: "Install Dotweave's bundled portable agent skill.",
  },
  routes: {
    install: skillInstallCommand,
  },
});

export default skillRoute;
