import { readFile, writeFile } from "node:fs/promises";

type PackageJson = {
  version?: unknown;
} & Record<string, unknown>;

export async function readPackageVersion(filePath: string): Promise<string> {
  const packageJson = await readPackageJson(filePath);

  if (typeof packageJson.version !== "string") {
    throw new Error(`Missing version in ${filePath}`);
  }

  return packageJson.version;
}

export async function writePackageVersion(
  filePath: string,
  version: string,
): Promise<void> {
  const packageJson = await readPackageJson(filePath);

  packageJson.version = version;

  await writeFile(
    filePath,
    `${JSON.stringify(packageJson, null, 2)}\n`,
    "utf8",
  );
}

async function readPackageJson(filePath: string): Promise<PackageJson> {
  const content = await readFile(filePath, "utf8");
  const parsed = JSON.parse(content);

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid package.json at ${filePath}`);
  }

  return parsed;
}
