import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

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
} from "./sea-common.ts";

const require = createRequire(import.meta.url);
const { build: viteBuild } = require("vite") as {
  build: (options: object) => Promise<void>;
};

const bundleOnly = process.argv.includes("--bundle-only");
const distEntryPath = join(distDirectory, "index.js");
const importPatterns = [
  /^\s*import\s+.+?\s+from\s+["']([^"']+)["'];?$/gm,
  /^\s*import\s+["']([^"']+)["'];?$/gm,
  /^\s*export\s+.+?\s+from\s+["']([^"']+)["'];?$/gm,
];

const buildDistribution = async (): Promise<void> => {
  console.log("Building dist/ output...");
  await runCommand(
    process.execPath,
    [tscCliPath, "-p", "tsconfig.build.json"],
    {
      cwd: repositoryRoot,
    },
  );
};

const validateBundleImports = (bundleSource: string): void => {
  const unexpectedImports = new Set<string>();

  for (const pattern of importPatterns) {
    let match = pattern.exec(bundleSource);

    while (match !== null) {
      const specifier = match[1];

      if (specifier === undefined) {
        match = pattern.exec(bundleSource);
        continue;
      }

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

const bundleForSea = async (): Promise<void> => {
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
        fileName: () => "dotweave.bundle",
        formats: ["es"],
      },
      minify: false,
      outDir: seaDirectory,
      reportCompressedSize: false,
      rollupOptions: {
        external: (specifier: string) => {
          return (
            typeof specifier === "string" && isNodeBuiltinSpecifier(specifier)
          );
        },
        output: {
          entryFileNames: "dotweave.bundle.js",
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

const writeSeaConfig = async (): Promise<{
  disableExperimentalSEAWarning: boolean;
  main: string;
  mainFormat: "module";
  output: string;
  useCodeCache: boolean;
  useSnapshot: boolean;
}> => {
  const seaConfig = {
    disableExperimentalSEAWarning: true,
    main: seaBundlePath,
    mainFormat: "module" as const,
    output: seaExecutablePath,
    useCodeCache: false,
    useSnapshot: false,
  };

  await writeFile(seaConfigPath, `${JSON.stringify(seaConfig, null, 2)}\n`);
  return seaConfig;
};

const buildSeaExecutable = async (): Promise<void> => {
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
