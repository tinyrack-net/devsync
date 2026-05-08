import { buildCommand, buildRouteMap } from "@stricli/core";
import { getRepoRoot } from "../../lib/git.ts";
import {
  type MsixArchitecture,
  performMsixBuild,
  performMsixBundle,
} from "../../lib/msix.ts";

const ARCHITECTURES = new Set<string>(["x64", "arm64"]);

const parseArchitecture = (value: string): MsixArchitecture => {
  if (!ARCHITECTURES.has(value)) {
    throw new Error(
      `Invalid MSIX architecture: ${value}. Must be one of: ${[...ARCHITECTURES].join(", ")}`,
    );
  }

  return value as MsixArchitecture;
};

const buildMsixCommand = buildCommand<
  {
    arch: MsixArchitecture;
    executablePath: string;
    outputPath?: string;
    packageRoot?: string;
  },
  []
>({
  parameters: {
    flags: {
      arch: {
        brief: "MSIX processor architecture (x64 or arm64)",
        kind: "parsed",
        parse: parseArchitecture,
      },
      executablePath: {
        brief: "Path to the Windows executable to package",
        kind: "parsed",
        parse: String,
      },
      outputPath: {
        brief: "Output .msix path, relative to the repo root",
        kind: "parsed",
        optional: true,
        parse: String,
      },
      packageRoot: {
        brief: "Generated package root path, relative to the repo root",
        kind: "parsed",
        optional: true,
        parse: String,
      },
    },
  },
  docs: {
    brief: "Build a Windows MSIX package for Microsoft Store distribution",
  },
  async func(flags) {
    const repoRoot = await getRepoRoot(process.cwd());
    await performMsixBuild({
      arch: flags.arch,
      executablePath: flags.executablePath,
      repoRoot,
      ...(flags.outputPath !== undefined
        ? { outputPath: flags.outputPath }
        : {}),
      ...(flags.packageRoot !== undefined
        ? { packageRoot: flags.packageRoot }
        : {}),
    });
  },
});

const bundleMsixCommand = buildCommand<
  { outputPath?: string; packageDir?: string },
  []
>({
  parameters: {
    flags: {
      outputPath: {
        brief: "Output .msixbundle path, relative to the repo root",
        kind: "parsed",
        optional: true,
        parse: String,
      },
      packageDir: {
        brief: "Directory containing .msix packages to bundle",
        kind: "parsed",
        optional: true,
        parse: String,
      },
    },
  },
  docs: {
    brief: "Bundle Windows MSIX architecture packages",
  },
  async func(flags) {
    const repoRoot = await getRepoRoot(process.cwd());
    await performMsixBundle({
      repoRoot,
      ...(flags.outputPath !== undefined
        ? { outputPath: flags.outputPath }
        : {}),
      ...(flags.packageDir !== undefined
        ? { packageDir: flags.packageDir }
        : {}),
    });
  },
});

export const msixRoute = buildRouteMap({
  routes: {
    build: buildMsixCommand,
    bundle: bundleMsixCommand,
  },
  docs: {
    brief: "Manage Windows MSIX packages",
  },
});
