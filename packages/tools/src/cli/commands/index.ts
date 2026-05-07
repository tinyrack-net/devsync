import { buildRouteMap } from "@stricli/core";
import { appimageRoute } from "./appimage.ts";
import { homebrewRoute } from "./homebrew.ts";
import { msixRoute } from "./msix.ts";
import { pkgRoute } from "./pkg.ts";
import { releaseCommand } from "./release.ts";
import { signRoute } from "./sign.ts";
import { verifyRoute } from "./verify.ts";

export const commands = buildRouteMap({
  routes: {
    release: releaseCommand,
    pkg: pkgRoute,
    verify: verifyRoute,
    sign: signRoute,
    appimage: appimageRoute,
    homebrew: homebrewRoute,
    msix: msixRoute,
  },
  docs: {
    brief: "dotweave repository tools",
    fullDescription: "dotweave repository tools",
  },
});

export default commands;
