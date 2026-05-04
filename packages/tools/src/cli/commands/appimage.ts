import { chmod, copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildCommand, buildRouteMap } from "@stricli/core";
import { execa } from "execa";
import { getRepoRoot } from "../../lib/git.ts";

const buildAppImageCommand = buildCommand<
  { artifactName: string; arch: string },
  []
>({
  parameters: {
    flags: {
      artifactName: {
        kind: "parsed",
        brief: "Name of the SEA artifact",
        parse: String,
      },
      arch: {
        kind: "parsed",
        brief: "Architecture (x86_64, aarch64)",
        parse: String,
      },
    },
  },
  docs: {
    brief: "Build AppImage for Linux",
  },
  async func(flags) {
    const repoRoot = await getRepoRoot(process.cwd());
    const appDir = join(repoRoot, "AppDir");
    const binPath = join(repoRoot, "packages/cli/dist/sea", flags.artifactName);

    await rm(appDir, { force: true, recursive: true });
    await mkdir(join(appDir, "usr/bin"), { recursive: true });
    await copyFile(binPath, join(appDir, "usr/bin/dotweave"));
    await chmod(join(appDir, "usr/bin/dotweave"), 0o755);

    await writeFile(
      join(appDir, "dotweave.desktop"),
      `[Desktop Entry]
Name=Dotweave
Exec=dotweave %F
Icon=dotweave
Type=Application
Categories=Utility;
Terminal=true
`,
    );

    await copyFile(
      join(repoRoot, "packages/homepage/src/assets/logo.svg"),
      join(appDir, "dotweave.svg"),
    );

    await writeFile(
      join(appDir, "AppRun"),
      `#!/bin/sh
HERE="$(dirname "$(readlink -f "\${0}")")"
export PATH="\${HERE}/usr/bin:\${PATH}"
exec dotweave "$@"
`,
    );
    await chmod(join(appDir, "AppRun"), 0o755);

    const appImageToolName = `appimagetool-${flags.arch}.AppImage`;
    const appImageToolUrl = `https://github.com/AppImage/AppImageKit/releases/download/continuous/${appImageToolName}`;

    console.log(`Downloading ${appImageToolName}...`);
    await execa("wget", [appImageToolUrl, "-O", "appimagetool"]);
    await chmod("appimagetool", 0o755);

    console.log("Building AppImage...");
    await execa(
      "./appimagetool",
      [
        "--appimage-extract-and-run",
        "AppDir",
        `${flags.artifactName}.AppImage`,
      ],
      {
        env: { ARCH: flags.arch },
      },
    );
  },
});

export const appimageRoute = buildRouteMap({
  routes: {
    build: buildAppImageCommand,
  },
  docs: {
    brief: "AppImage commands",
  },
});

export default appimageRoute;
