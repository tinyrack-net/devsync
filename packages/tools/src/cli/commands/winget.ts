import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { buildCommand, buildRouteMap } from "@stricli/core";
import { getRepoRoot } from "../../lib/git.ts";

async function calculateSha256(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

type GenerateManifestFlags = {
  version: string;
  artifactsDir: string;
};

async function generateManifests(flags: GenerateManifestFlags) {
  const { version, artifactsDir: rawArtifactsDir } = flags;
  const cleanVersion = version.startsWith("v") ? version.slice(1) : version;

  const repoRoot = await getRepoRoot(process.cwd());
  const artifactsDir = path.isAbsolute(rawArtifactsDir)
    ? rawArtifactsDir
    : path.resolve(repoRoot, rawArtifactsDir);

  const assets = [
    { name: "dotweave-win-x64.exe", arch: "x64" },
    { name: "dotweave-win-arm64.exe", arch: "arm64" },
  ];

  const hashes: Record<string, string> = {};

  for (const asset of assets) {
    const filePath = path.join(artifactsDir, asset.name);
    try {
      hashes[asset.name] = await calculateSha256(filePath);
    } catch (error) {
      throw new Error(
        `Failed to calculate hash for ${asset.name} at ${filePath}: ${error}`,
      );
    }
  }

  const manifestsDir = path.join(artifactsDir, `winget-${cleanVersion}`);
  await fs.mkdir(manifestsDir, { recursive: true });

  const rootManifest = `# Created with wingetcreate
# yaml-language-server: $schema=https://aka.ms/winget-manifest.singleton.1.12.0.schema.json
PackageIdentifier: tinyrack.dotweave
PackageVersion: ${cleanVersion}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.12.0
`;

  const localeManifest = `# Created with wingetcreate
# yaml-language-server: $schema=https://aka.ms/winget-manifest.defaultLocale.1.12.0.schema.json
PackageIdentifier: tinyrack.dotweave
PackageVersion: ${cleanVersion}
PackageLocale: en-US
Publisher: tinyrack
PackageName: dotweave
PackageUrl: https://github.com/tinyrack-net/dotweave
License: MIT
LicenseUrl: https://github.com/tinyrack-net/dotweave/blob/main/LICENSE
Copyright: Copyright (c) winetree94
ShortDescription: Git-backed configuration synchronization tool for dotfiles
ReleaseNotesUrl: https://github.com/tinyrack-net/dotweave/releases/tag/v${cleanVersion}
Tags:
  - cli
  - dotfiles
  - sync
  - configuration
ManifestType: defaultLocale
ManifestVersion: 1.12.0
`;

  const installerManifest = `# Created with wingetcreate
# yaml-language-server: $schema=https://aka.ms/winget-manifest.installer.1.12.0.schema.json
PackageIdentifier: tinyrack.dotweave
PackageVersion: ${cleanVersion}
InstallerLocale: en-US
Commands:
  - dotweave
InstallerType: portable
ReleaseDate: ${new Date().toISOString().slice(0, 10)}
Installers:
  - Architecture: x64
    InstallerUrl: https://github.com/tinyrack-net/dotweave/releases/download/v${cleanVersion}/dotweave-win-x64.exe
    InstallerSha256: ${hashes["dotweave-win-x64.exe"]}
  - Architecture: arm64
    InstallerUrl: https://github.com/tinyrack-net/dotweave/releases/download/v${cleanVersion}/dotweave-win-arm64.exe
    InstallerSha256: ${hashes["dotweave-win-arm64.exe"]}
ManifestType: installer
ManifestVersion: 1.12.0
`;

  const rootPath = path.join(manifestsDir, "tinyrack.dotweave.yaml");
  const localePath = path.join(
    manifestsDir,
    "tinyrack.dotweave.locale.en-US.yaml",
  );
  const installerPath = path.join(
    manifestsDir,
    "tinyrack.dotweave.installer.yaml",
  );

  await fs.writeFile(rootPath, rootManifest);
  await fs.writeFile(localePath, localeManifest);
  await fs.writeFile(installerPath, installerManifest);

  console.log(
    `Generated winget manifests: ${rootPath}, ${localePath}, ${installerPath}`,
  );
}

export const generateManifestCommand = buildCommand<GenerateManifestFlags, []>({
  parameters: {
    flags: {
      version: {
        kind: "parsed",
        brief: "Release version (e.g., v1.0.0)",
        parse: String,
      },
      artifactsDir: {
        kind: "parsed",
        brief: "Directory containing the release artifacts",
        parse: String,
      },
    },
    positional: {
      kind: "tuple",
      parameters: [],
    },
  },
  async func(flags) {
    await generateManifests(flags);
  },
  docs: {
    brief: "Generate winget manifest files for Windows package manager",
  },
});

export const wingetRoute = buildRouteMap({
  routes: {
    generate: generateManifestCommand,
  },
  docs: {
    brief: "Winget commands",
  },
});
