import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildCommand, buildRouteMap } from "@stricli/core";
import { getRepoRoot } from "../../lib/git.ts";

const verifyReleaseTagCommand = buildCommand<Record<string, never>, []>({
  parameters: {
    flags: {},
  },
  docs: {
    brief: "Verify that GITHUB_REF_NAME matches the CLI package version",
  },
  async func() {
    const repoRoot = await getRepoRoot(process.cwd());
    const pkgPath = join(repoRoot, "packages/cli/package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
    const tag = process.env["GITHUB_REF_NAME"];
    const expectedTag = `v${pkg.version}`;

    if (!tag) {
      throw new Error("GITHUB_REF_NAME environment variable is not set");
    }

    if (tag !== expectedTag) {
      throw new Error(
        `Tag ${tag} does not match package.json version ${expectedTag}`,
      );
    }

    console.log(`Verified tag ${tag} matches version ${pkg.version}`);
  },
});

export const verifyRoute = buildRouteMap({
  routes: {
    "release-tag": verifyReleaseTagCommand,
  },
  docs: {
    brief: "Verification commands",
  },
});

export default verifyRoute;
