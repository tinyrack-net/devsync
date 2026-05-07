import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { execa } from "execa";

export type MsixArchitecture = "x64" | "arm64";

export type MsixIdentityOptions = {
  displayName?: string;
  identityName: string;
  publisher: string;
  publisherDisplayName: string;
};

export type MsixBuildOptions = {
  arch: MsixArchitecture;
  executablePath: string;
  outputPath?: string;
  packageRoot?: string;
  repoRoot: string;
};

export type MsixBundleOptions = {
  outputPath?: string;
  packageDir?: string;
  repoRoot: string;
};

const APP_DISPLAY_NAME = "dotweave";
const APP_DESCRIPTION =
  "Git-backed configuration synchronization tool for dotfiles";
const APP_EXECUTABLE_NAME = "dotweave.exe";
const DEFAULT_LANGUAGE = "en-US";
const MIN_WINDOWS_VERSION = "10.0.19041.0";
const MAX_TESTED_WINDOWS_VERSION = "10.0.26100.0";

const resolveRepoPath = (repoRoot: string, path: string): string => {
  return resolve(repoRoot, path);
};

const readRequiredEnv = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = env[name];

  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required to build Windows MSIX packages`);
  }

  return value;
};

export const readMsixIdentityFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): MsixIdentityOptions => {
  // biome-ignore lint/complexity/useLiteralKeys: must use bracket notation for index signature access
  const displayName = env["MSIX_DISPLAY_NAME"];

  return {
    identityName: readRequiredEnv(env, "MSIX_IDENTITY_NAME"),
    publisher: readRequiredEnv(env, "MSIX_PUBLISHER"),
    publisherDisplayName: readRequiredEnv(env, "MSIX_PUBLISHER_DISPLAY_NAME"),
    ...(displayName !== undefined && displayName.trim() !== ""
      ? { displayName }
      : {}),
  };
};

export const convertVersionToMsixVersion = (version: string): string => {
  const coreVersion = version.split("-")[0];

  if (coreVersion === undefined) {
    throw new Error(`Invalid package version for MSIX: ${version}`);
  }

  const parts = coreVersion.split(".");

  if (parts.length !== 3) {
    throw new Error(`Invalid package version for MSIX: ${version}`);
  }

  const numericParts = parts.map((part) => {
    if (!/^\d+$/.test(part)) {
      throw new Error(`Invalid package version for MSIX: ${version}`);
    }

    const value = Number(part);

    if (!Number.isSafeInteger(value) || value < 0 || value > 65_535) {
      throw new Error(`MSIX version segment out of range: ${part}`);
    }

    return value;
  });

  return `${numericParts[0]}.${numericParts[1]}.${numericParts[2]}.0`;
};

const readCliPackageVersion = async (repoRoot: string): Promise<string> => {
  const packageJsonPath = join(repoRoot, "packages", "cli", "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    version?: unknown;
  };

  if (typeof packageJson.version !== "string") {
    throw new Error(`Missing version in ${packageJsonPath}`);
  }

  return convertVersionToMsixVersion(packageJson.version);
};

const escapeXml = (value: string): string => {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
};

export const buildMsixManifest = (options: {
  arch: MsixArchitecture;
  identity: MsixIdentityOptions;
  version: string;
}): string => {
  const displayName = options.identity.displayName ?? APP_DISPLAY_NAME;

  return `<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:uap3="http://schemas.microsoft.com/appx/manifest/uap/windows10/3"
  xmlns:uap8="http://schemas.microsoft.com/appx/manifest/uap/windows10/8"
  xmlns:uap10="http://schemas.microsoft.com/appx/manifest/uap/windows10/10"
  xmlns:desktop="http://schemas.microsoft.com/appx/manifest/desktop/windows10"
  xmlns:desktop4="http://schemas.microsoft.com/appx/manifest/desktop/windows10/4"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap uap3 uap8 uap10 desktop desktop4 rescap">
  <Identity
    Name="${escapeXml(options.identity.identityName)}"
    Publisher="${escapeXml(options.identity.publisher)}"
    Version="${escapeXml(options.version)}"
    ProcessorArchitecture="${options.arch}" />
  <Properties>
    <DisplayName>${escapeXml(displayName)}</DisplayName>
    <PublisherDisplayName>${escapeXml(options.identity.publisherDisplayName)}</PublisherDisplayName>
    <Logo>Assets\\StoreLogo.png</Logo>
  </Properties>
  <Resources>
    <Resource Language="${DEFAULT_LANGUAGE}" />
  </Resources>
  <Dependencies>
    <TargetDeviceFamily
      Name="Windows.Desktop"
      MinVersion="${MIN_WINDOWS_VERSION}"
      MaxVersionTested="${MAX_TESTED_WINDOWS_VERSION}" />
  </Dependencies>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
  <Applications>
    <Application
      Id="dotweave"
      Executable="${APP_EXECUTABLE_NAME}"
      EntryPoint="Windows.FullTrustApplication"
      uap10:RuntimeBehavior="packagedClassicApp"
      uap10:TrustLevel="mediumIL">
      <uap:VisualElements
        DisplayName="${escapeXml(displayName)}"
        Description="${escapeXml(APP_DESCRIPTION)}"
        Square150x150Logo="Assets\\Square150x150Logo.png"
        Square44x44Logo="Assets\\Square44x44Logo.png"
        BackgroundColor="#102A43" />
      <Extensions>
        <uap3:Extension
          Category="windows.appExecutionAlias"
          EntryPoint="Windows.FullTrustApplication">
          <uap3:AppExecutionAlias desktop4:Subsystem="console">
            <desktop:ExecutionAlias Alias="${APP_EXECUTABLE_NAME}" uap8:AllowOverride="true" />
          </uap3:AppExecutionAlias>
        </uap3:Extension>
      </Extensions>
    </Application>
  </Applications>
</Package>
`;
};

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let crc = index;

  for (let bit = 0; bit < 8; bit++) {
    crc = (crc & 1) === 1 ? 0xedb8_8320 ^ (crc >>> 1) : crc >>> 1;
  }

  return crc >>> 0;
});

const crc32 = (buffers: Buffer[]): number => {
  let crc = 0xffff_ffff;

  for (const buffer of buffers) {
    for (const byte of buffer) {
      const tableValue = crcTable[(crc ^ byte) & 0xff];

      if (tableValue === undefined) {
        throw new Error("CRC table lookup failed");
      }

      crc = (crc >>> 8) ^ tableValue;
    }
  }

  return (crc ^ 0xffff_ffff) >>> 0;
};

const pngChunk = (type: string, data: Buffer): Buffer => {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);

  length.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(crc32([typeBuffer, data]), 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
};

const createLogoPng = (size: number): Buffer => {
  const bytesPerPixel = 4;
  const rowSize = 1 + size * bytesPerPixel;
  const raw = Buffer.alloc(rowSize * size);
  const base = [16, 42, 67, 255] as const;
  const accent = [20, 184, 166, 255] as const;
  const light = [245, 247, 250, 255] as const;
  const bandStart = Math.floor(size * 0.22);
  const bandEnd = Math.floor(size * 0.34);
  const markStart = Math.floor(size * 0.42);
  const markEnd = Math.floor(size * 0.58);

  for (let y = 0; y < size; y++) {
    const rowOffset = y * rowSize;
    raw[rowOffset] = 0;

    for (let x = 0; x < size; x++) {
      const pixelOffset = rowOffset + 1 + x * bytesPerPixel;
      const color =
        (x >= bandStart && x <= bandEnd) ||
        (x >= markStart && x <= markEnd && y >= markStart && y <= markEnd)
          ? accent
          : x >= markStart && x <= markEnd
            ? light
            : base;

      raw[pixelOffset] = color[0];
      raw[pixelOffset + 1] = color[1];
      raw[pixelOffset + 2] = color[2];
      raw[pixelOffset + 3] = color[3];
    }
  }

  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
};

const writeMsixAssets = async (assetsDirectory: string): Promise<void> => {
  await mkdir(assetsDirectory, { recursive: true });

  await Promise.all([
    writeFile(join(assetsDirectory, "StoreLogo.png"), createLogoPng(50)),
    writeFile(join(assetsDirectory, "Square44x44Logo.png"), createLogoPng(44)),
    writeFile(
      join(assetsDirectory, "Square150x150Logo.png"),
      createLogoPng(150),
    ),
  ]);
};

const findWindowsSdkTool = async (toolName: string): Promise<string> => {
  const envOverride = process.env[`${toolName.toUpperCase()}_PATH`];

  if (envOverride !== undefined && envOverride.trim() !== "") {
    return envOverride;
  }

  if (process.platform !== "win32") {
    throw new Error(`${toolName}.exe is only available on Windows runners`);
  }

  // biome-ignore lint/complexity/useLiteralKeys: must use bracket notation for index signature access
  const windowsSdkDir = process.env["WindowsSdkDir"];
  // biome-ignore lint/complexity/useLiteralKeys: must use bracket notation for index signature access
  const programFiles = process.env["ProgramFiles"];
  const programFilesX86 = process.env["ProgramFiles(x86)"];

  const sdkRoots = [
    windowsSdkDir !== undefined ? join(windowsSdkDir, "bin") : undefined,
    programFilesX86 !== undefined
      ? join(programFilesX86, "Windows Kits", "10", "bin")
      : undefined,
    programFiles !== undefined
      ? join(programFiles, "Windows Kits", "10", "bin")
      : undefined,
  ].filter((value): value is string => value !== undefined);

  for (const sdkRoot of sdkRoots) {
    let versions: string[];

    try {
      versions = (await readdir(sdkRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((left, right) =>
          right.localeCompare(left, undefined, { numeric: true }),
        );
    } catch {
      continue;
    }

    for (const version of versions) {
      for (const arch of ["x64", "x86"]) {
        const candidate = join(sdkRoot, version, arch, `${toolName}.exe`);

        try {
          await readFile(candidate);
          return candidate;
        } catch {}
      }
    }
  }

  return `${toolName}.exe`;
};

const createPriFile = async (packageRoot: string): Promise<void> => {
  const makePriPath = await findWindowsSdkTool("makepri");
  const priConfigPath = join(packageRoot, "priconfig.xml");

  await execa(
    makePriPath,
    ["createconfig", "/cf", priConfigPath, "/dq", DEFAULT_LANGUAGE],
    {
      cwd: packageRoot,
      stdio: "inherit",
    },
  );

  await execa(makePriPath, ["new", "/pr", packageRoot, "/cf", priConfigPath], {
    cwd: packageRoot,
    stdio: "inherit",
  });
  await rm(priConfigPath, { force: true });
};

export const performMsixBuild = async (
  options: MsixBuildOptions,
): Promise<{ outputPath: string; packageRoot: string }> => {
  const identity = readMsixIdentityFromEnv();
  const version = await readCliPackageVersion(options.repoRoot);
  const packageRoot =
    options.packageRoot !== undefined
      ? resolveRepoPath(options.repoRoot, options.packageRoot)
      : join(options.repoRoot, "packages", "cli", "dist", "msix", options.arch);
  const outputPath =
    options.outputPath !== undefined
      ? resolveRepoPath(options.repoRoot, options.outputPath)
      : join(
          options.repoRoot,
          "packages",
          "cli",
          "dist",
          "pkg",
          `dotweave-win-${options.arch}.msix`,
        );
  const sourceExecutablePath = resolveRepoPath(
    options.repoRoot,
    options.executablePath,
  );

  await rm(packageRoot, { force: true, recursive: true });
  await mkdir(packageRoot, { recursive: true });
  await mkdir(dirname(outputPath), { recursive: true });
  await cp(sourceExecutablePath, join(packageRoot, APP_EXECUTABLE_NAME));
  await writeFile(
    join(packageRoot, "AppxManifest.xml"),
    buildMsixManifest({
      arch: options.arch,
      identity,
      version,
    }),
  );
  await writeMsixAssets(join(packageRoot, "Assets"));
  await createPriFile(packageRoot);

  const makeAppxPath = await findWindowsSdkTool("makeappx");
  await execa(
    makeAppxPath,
    ["pack", "/v", "/o", "/h", "SHA256", "/d", packageRoot, "/p", outputPath],
    {
      cwd: options.repoRoot,
      stdio: "inherit",
    },
  );

  console.log(`MSIX package generated at ${outputPath}`);

  return { outputPath, packageRoot };
};

export const performMsixBundle = async (
  options: MsixBundleOptions,
): Promise<{ outputPath: string }> => {
  const version = await readCliPackageVersion(options.repoRoot);
  const packageDir =
    options.packageDir !== undefined
      ? resolveRepoPath(options.repoRoot, options.packageDir)
      : join(options.repoRoot, "packages", "cli", "dist", "pkg");
  const outputPath =
    options.outputPath !== undefined
      ? resolveRepoPath(options.repoRoot, options.outputPath)
      : join(
          options.repoRoot,
          "packages",
          "cli",
          "dist",
          "pkg",
          "dotweave-windows.msixbundle",
        );
  const bundleInputDir = join(
    options.repoRoot,
    "packages",
    "cli",
    "dist",
    "msix",
    "bundle",
  );
  const packageNames = (await readdir(packageDir))
    .filter((entry) => entry.endsWith(".msix"))
    .sort();

  if (packageNames.length === 0) {
    throw new Error(`No .msix packages found in ${packageDir}`);
  }

  await rm(bundleInputDir, { force: true, recursive: true });
  await mkdir(bundleInputDir, { recursive: true });

  await Promise.all(
    packageNames.map(async (packageName) => {
      await cp(
        join(packageDir, packageName),
        join(bundleInputDir, packageName),
      );
    }),
  );

  const makeAppxPath = await findWindowsSdkTool("makeappx");
  await execa(
    makeAppxPath,
    [
      "bundle",
      "/v",
      "/o",
      "/bv",
      version,
      "/d",
      bundleInputDir,
      "/p",
      outputPath,
    ],
    {
      cwd: options.repoRoot,
      stdio: "inherit",
    },
  );

  console.log(`MSIX bundle generated at ${outputPath}`);

  return { outputPath };
};
