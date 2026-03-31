import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";

const releaseType = process.argv[2] as "major" | "minor" | "patch";

if (!releaseType || !["major", "minor", "patch"].includes(releaseType)) {
  console.error("Usage: node scripts/release.ts <major|minor|patch>");
  process.exit(1);
}

async function main() {
  try {
    console.log(`🚀 Starting release: ${releaseType}`);

    // Bump version with pnpm
    console.log(`📦 Running: pnpm version ${releaseType}`);
    await execa("pnpm", ["version", releaseType], {
      stdio: "inherit",
      cwd: process.cwd(),
    });

    // Read package.json to get the version
    const packageJsonPath = join(process.cwd(), "package.json");
    const packageJsonContent = await readFile(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(packageJsonContent) as { version: string };
    const version = packageJson.version;

    // Stage changes
    console.log(`📝 Staging changes...`);
    await execa("git", ["add", "package.json"], {
      stdio: "inherit",
      cwd: process.cwd(),
    });

    // Create commit
    console.log(`💾 Creating commit...`);
    await execa("git", ["commit", "-m", `release: v${version}`], {
      stdio: "inherit",
      cwd: process.cwd(),
    });

    // Create signed git tag
    console.log(`🏷️  Creating git tag: v${version}`);
    await execa("git", [
      "tag",
      "-s",
      `v${version}`,
      "-m",
      `release: v${version}`,
    ], {
      stdio: "inherit",
      cwd: process.cwd(),
    });

    console.log(`✅ Release completed successfully!`);
    console.log(`   Version: v${version}`);
    console.log(`   Git tag: v${version}`);
  } catch (error) {
    console.error("❌ Release failed:", error);
    process.exit(1);
  }
}

main();
