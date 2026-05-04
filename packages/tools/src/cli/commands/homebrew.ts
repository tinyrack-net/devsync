import { buildCommand, buildRouteMap } from "@stricli/core";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

async function calculateSha256(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

type GenerateFormulaFlags = {
  version: string;
  artifactsDir: string;
};

export const generateFormulaCommand = buildCommand<GenerateFormulaFlags, []>({
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
    const { version, artifactsDir } = flags;
    const cleanVersion = version.startsWith("v") ? version.slice(1) : version;

    const artifacts = [
      { name: "dotweave-darwin-arm64", os: "mac", arch: "arm" },
      { name: "dotweave-linux-x64", os: "linux", arch: "intel" },
      { name: "dotweave-linux-arm64", os: "linux", arch: "arm" },
    ];

    const hashes: Record<string, string> = {};

    for (const artifact of artifacts) {
      const filePath = path.join(artifactsDir, artifact.name);
      try {
        hashes[artifact.name] = await calculateSha256(filePath);
      } catch (error) {
        console.error(`Warning: Could not calculate hash for ${artifact.name}:`, error);
      }
    }

    const formula = `class Dotweave < Formula
  desc "Git-backed configuration synchronization tool for dotfiles"
  homepage "https://dotweave.tinyrack.net"
  version "${cleanVersion}"

  on_macos do
    on_arm do
      url "https://github.com/tinyrack-net/dotweave/releases/download/v${cleanVersion}/dotweave-darwin-arm64"
      sha256 "${hashes["dotweave-darwin-arm64"] || ""}"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/tinyrack-net/dotweave/releases/download/v${cleanVersion}/dotweave-linux-x64"
      sha256 "${hashes["dotweave-linux-x64"] || ""}"
    end
    on_arm do
      url "https://github.com/tinyrack-net/dotweave/releases/download/v${cleanVersion}/dotweave-linux-arm64"
      sha256 "${hashes["dotweave-linux-arm64"] || ""}"
    end
  end

  def install
    if OS.mac? && Hardware::CPU.arm?
      bin.install "dotweave-darwin-arm64" => "dotweave"
    elsif OS.linux? && Hardware::CPU.intel?
      bin.install "dotweave-linux-x64" => "dotweave"
    elsif OS.linux? && Hardware::CPU.arm?
      bin.install "dotweave-linux-arm64" => "dotweave"
    end
  end

  test do
    system "#{bin}/dotweave", "--version"
  end
end
`;

    const outPath = path.join(artifactsDir, "dotweave.rb");
    await fs.writeFile(outPath, formula);
    console.log(`Generated Homebrew formula: ${outPath}`);
  },
  docs: {
    brief: "Generate Homebrew formula",
  },
});

export const homebrewRoute = buildRouteMap({
  routes: {
    generate: generateFormulaCommand,
  },
  docs: {
    brief: "Homebrew commands",
  },
});
