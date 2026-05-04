import { buildRouteMap } from "@stricli/core";
import { appimageRoute } from "./appimage.ts";
import { homebrewRoute } from "./homebrew.ts";
import { releaseCommand } from "./release.ts";
import { seaRoute } from "./sea.ts";
import { signRoute } from "./sign.ts";
import { verifyRoute } from "./verify.ts";

export const commands = buildRouteMap({
  routes: {
    release: releaseCommand,
    sea: seaRoute,
    verify: verifyRoute,
    sign: signRoute,
    appimage: appimageRoute,
    homebrew: homebrewRoute,
  },
  docs: {
    brief: "dotweave repository tools",
    fullDescription: "dotweave repository tools",
  },
});

export default commands;
