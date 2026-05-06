import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildCommand, buildRouteMap } from "@stricli/core";
import { execa } from "execa";
import { getRepoRoot } from "../../lib/git.ts";

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
  delayMs = 30_000,
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      console.log(
        `Attempt ${attempt}/${maxRetries} failed, retrying in ${delayMs / 1000}s...`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error("Unreachable");
}

const signMacosCommand = buildCommand<
  { executablePath: string; skipNotarize: boolean },
  []
>({
  parameters: {
    flags: {
      executablePath: {
        kind: "parsed",
        brief: "Path to the executable to sign",
        parse: String,
      },
      skipNotarize: {
        kind: "boolean",
        brief: "Skip notarization (codesign only)",
        default: false,
      },
    },
  },
  docs: {
    brief: "Sign and Notarize macOS binary",
  },
  async func(flags) {
    const repoRoot = await getRepoRoot(process.cwd());
    const executablePath = join(repoRoot, flags.executablePath);
    const entitlementsPath = join(repoRoot, "packages/cli/entitlements.plist");

    // biome-ignore lint/complexity/useLiteralKeys: must use bracket notation for index signature access
    const appleCertificate = process.env["APPLE_CERTIFICATE"];
    // biome-ignore lint/complexity/useLiteralKeys: must use bracket notation for index signature access
    const appleCertificatePassword = process.env["APPLE_CERTIFICATE_PASSWORD"];
    // biome-ignore lint/complexity/useLiteralKeys: must use bracket notation for index signature access
    const appleDeveloperId = process.env["APPLE_DEVELOPER_ID"];
    // biome-ignore lint/complexity/useLiteralKeys: must use bracket notation for index signature access
    const appleNotaryKeyId = process.env["APPLE_NOTARY_KEY_ID"];
    // biome-ignore lint/complexity/useLiteralKeys: must use bracket notation for index signature access
    const appleNotaryIssuerId = process.env["APPLE_NOTARY_ISSUER_ID"];
    // biome-ignore lint/complexity/useLiteralKeys: must use bracket notation for index signature access
    const appleNotaryKeyP8Base64 = process.env["APPLE_NOTARY_KEY_P8_BASE64"];

    console.log("Removing existing signature if any...");
    try {
      await execa("codesign", ["--remove-signature", executablePath]);
    } catch {
      // Ignore if it fails (e.g. no signature exists)
    }

    console.log("Removing extended attributes if any...");
    try {
      await execa("xattr", ["-cr", executablePath]);
    } catch {
      // Ignore if it fails
    }

    if (appleCertificate) {
      if (!appleCertificatePassword || !appleDeveloperId) {
        throw new Error(
          "APPLE_CERTIFICATE_PASSWORD and APPLE_DEVELOPER_ID are required when APPLE_CERTIFICATE is set",
        );
      }

      console.log("Importing Apple Certificate...");
      const certBuffer = Buffer.from(appleCertificate, "base64");
      await writeFile("certificate.p12", certBuffer);

      try {
        try {
          await execa("security", ["delete-keychain", "build.keychain"]);
        } catch {
          // Ignore if keychain doesn't exist
        }
        await execa("security", [
          "create-keychain",
          "-p",
          "actions",
          "build.keychain",
        ]);
        const { stdout: currentKeychains } = await execa("security", [
          "list-keychains",
        ]);
        const keychainList = currentKeychains
          .split("\n")
          .map((k) => k.trim())
          .filter(Boolean);
        if (!keychainList.includes("build.keychain")) {
          await execa("security", [
            "list-keychains",
            "-s",
            ...keychainList,
            "build.keychain",
          ]);
        }
        await execa("security", ["default-keychain", "-s", "build.keychain"]);
        await execa("security", [
          "unlock-keychain",
          "-p",
          "actions",
          "build.keychain",
        ]);
        await execa("security", [
          "import",
          "certificate.p12",
          "-k",
          "build.keychain",
          "-P",
          appleCertificatePassword,
          "-T",
          "/usr/bin/codesign",
        ]);
        await execa("security", [
          "set-key-partition-list",
          "-S",
          "apple-tool:,apple:,codesign:",
          "-s",
          "-k",
          "actions",
          "build.keychain",
        ]);

        console.log("Signing macOS binary...");
        await execa("codesign", [
          "--force",
          "--options",
          "runtime",
          "--entitlements",
          entitlementsPath,
          "--sign",
          appleDeveloperId,
          executablePath,
        ]);

        if (appleNotaryKeyP8Base64 && !flags.skipNotarize) {
          if (!appleNotaryKeyId || !appleNotaryIssuerId) {
            throw new Error(
              "APPLE_NOTARY_KEY_ID and APPLE_NOTARY_ISSUER_ID are required when APPLE_NOTARY_KEY_P8_BASE64 is set",
            );
          }

          console.log("Notarizing macOS binary...");
          const authKeyBuffer = Buffer.from(appleNotaryKeyP8Base64, "base64");
          await writeFile("AuthKey.p8", authKeyBuffer);

          const zipPath = `${executablePath}.zip`;
          await execa("zip", ["-j", zipPath, executablePath]);

          await withRetry(() =>
            execa("xcrun", [
              "notarytool",
              "submit",
              zipPath,
              "--key",
              "AuthKey.p8",
              "--key-id",
              appleNotaryKeyId,
              "--issuer",
              appleNotaryIssuerId,
              "--wait",
            ]),
          );
          await rm("AuthKey.p8");
        } else if (flags.skipNotarize) {
          console.log("Notarization skipped (--skip-notarize flag).");
        } else {
          console.log("No Notary API Key found. Skipping notarization.");
        }
      } finally {
        await rm("certificate.p12", { force: true });
      }
    } else {
      console.log("No Apple Certificate found. Performing ad-hoc signing...");
      await execa("codesign", ["--sign", "-", executablePath]);
    }
  },
});

const signWindowsCommand = buildCommand<{ executablePath: string }, []>({
  parameters: {
    flags: {
      executablePath: {
        kind: "parsed",
        brief: "Path to the executable to sign",
        parse: String,
      },
    },
  },
  docs: {
    brief: "Sign Windows binary using signtool.exe",
  },
  async func(flags) {
    const repoRoot = await getRepoRoot(process.cwd());
    const executablePath = join(repoRoot, flags.executablePath);

    // biome-ignore lint/complexity/useLiteralKeys: must use bracket notation for index signature access
    const thumbprint = process.env["WINDOWS_CERT_THUMBPRINT"];

    if (!thumbprint) {
      console.log(
        "WINDOWS_CERT_THUMBPRINT not found. Skipping Windows signing.",
      );
      return;
    }

    console.log(`Signing Windows binary: ${executablePath}`);
    await execa("signtool.exe", [
      "sign",
      "/sha1",
      thumbprint,
      "/fd",
      "sha256",
      "/tr",
      "http://timestamp.digicert.com",
      "/td",
      "sha256",
      executablePath,
    ]);
  },
});

export const signRoute = buildRouteMap({
  routes: {
    macos: signMacosCommand,
    windows: signWindowsCommand,
  },
  docs: {
    brief: "Signing commands",
  },
});

export default signRoute;
