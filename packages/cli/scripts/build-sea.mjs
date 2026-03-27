import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { build as viteBuild } from "vite";

import {
  distDirectory,
  ensureSeaBuilderNode,
  isNodeBuiltinSpecifier,
  repositoryRoot,
  runCommand,
  seaBundlePath,
  seaConfigPath,
  seaDirectory,
  seaExecutablePath,
  tscCliPath,
} from "./sea-common.mjs";

const bundleOnly = process.argv.includes("--bundle-only");
const distEntryPath = join(distDirectory, "index.js");
const importPatterns = [
  /^\s*import\s+.+?\s+from\s+["']([^"']+)["'];?$/gm,
  /^\s*import\s+["']([^"']+)["'];?$/gm,
  /^\s*export\s+.+?\s+from\s+["']([^"']+)["'];?$/gm,
];

const buildDistribution = async () => {
  console.log("Building dist/ output...");
  await runCommand(
    process.execPath,
    [tscCliPath, "-p", "tsconfig.build.json"],
    {
      cwd: repositoryRoot,
    },
  );
};

const validateBundleImports = (bundleSource) => {
  const unexpectedImports = new Set();

  for (const pattern of importPatterns) {
    let match = pattern.exec(bundleSource);

    while (match !== null) {
      const specifier = match[1];

      if (!isNodeBuiltinSpecifier(specifier)) {
        unexpectedImports.add(specifier);
      }

      match = pattern.exec(bundleSource);
    }
  }

  if (unexpectedImports.size > 0) {
    throw new Error(
      `SEA bundle still has non-builtin imports: ${[...unexpectedImports].sort().join(", ")}`,
    );
  }
};

const bundleForSea = async () => {
  console.log("Bundling dist/index.js for SEA...");
  await rm(seaDirectory, { force: true, recursive: true });
  await mkdir(seaDirectory, { recursive: true });

  await viteBuild({
    appType: "custom",
    build: {
      copyPublicDir: false,
      emptyOutDir: false,
      lib: {
        entry: distEntryPath,
        fileName: () => "devsync.bundle",
        formats: ["es"],
      },
      minify: false,
      outDir: seaDirectory,
      reportCompressedSize: false,
      rollupOptions: {
        external: (specifier) => {
          return (
            typeof specifier === "string" && isNodeBuiltinSpecifier(specifier)
          );
        },
        output: {
          entryFileNames: "devsync.bundle.js",
          format: "es",
        },
      },
      sourcemap: false,
      target: "node25",
    },
    logLevel: "info",
  });

  const bundleSource = await readFile(seaBundlePath, "utf8");
  validateBundleImports(bundleSource);
  console.log(`SEA bundle written to ${seaBundlePath}`);
};

const writeSeaConfig = async () => {
  const seaConfig = {
    disableExperimentalSEAWarning: true,
    main: seaBundlePath,
    mainFormat: "module",
    output: seaExecutablePath,
    useCodeCache: false,
    useSnapshot: false,
  };

  await writeFile(seaConfigPath, `${JSON.stringify(seaConfig, null, 2)}\n`);
  return seaConfig;
};

const buildSeaExecutable = async () => {
  ensureSeaBuilderNode();
  console.log(`Generating SEA executable with Node.js ${process.version}...`);
  await rm(seaExecutablePath, { force: true });
  await writeSeaConfig();
  await runCommand(process.execPath, ["--build-sea", seaConfigPath], {
    cwd: repositoryRoot,
  });
  console.log(`SEA executable written to ${seaExecutablePath}`);
};

await buildDistribution();
await bundleForSea();

if (!bundleOnly) {
  await buildSeaExecutable();
}
