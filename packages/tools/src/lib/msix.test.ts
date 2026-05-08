import { describe, expect, test } from "vitest";
import {
  buildMsixManifest,
  convertVersionToMsixVersion,
  readMsixIdentityFromEnv,
} from "./msix.ts";

describe("msix helpers", () => {
  test("converts package semver to a four-part MSIX version", () => {
    expect(convertVersionToMsixVersion("0.42.14")).toBe("0.42.14.0");
  });

  test("strips prerelease suffix from version", () => {
    expect(convertVersionToMsixVersion("1.0.0-beta.1")).toBe("1.0.0.0");
  });

  test("rejects non-MSIX-compatible package versions", () => {
    expect(() => convertVersionToMsixVersion("1.2")).toThrow(
      "Invalid package version",
    );
    expect(() => convertVersionToMsixVersion("1.2.70000")).toThrow(
      "MSIX version segment out of range",
    );
  });

  test("rejects version with non-numeric segments", () => {
    expect(() => convertVersionToMsixVersion("1.x.3")).toThrow(
      "Invalid package version",
    );
  });

  test("generates a packaged desktop manifest with a dotweave execution alias", () => {
    const manifest = buildMsixManifest({
      arch: "x64",
      identity: {
        identityName: "tinyrack.dotweave",
        publisher: "CN=tinyrack",
        publisherDisplayName: "tinyrack",
      },
      version: "0.42.14.0",
    });

    expect(manifest).toContain(
      'xmlns:uap5="http://schemas.microsoft.com/appx/manifest/uap/windows10/5"',
    );
    expect(manifest).toContain('Name="Windows.Desktop"');
    expect(manifest).toContain('<rescap:Capability Name="runFullTrust" />');
    expect(manifest).toContain('uap10:RuntimeBehavior="packagedClassicApp"');
    expect(manifest).toContain(
      '<uap5:Extension Category="windows.appExecutionAlias">',
    );
    expect(manifest).toContain(
      '<uap5:AppExecutionAlias desktop4:Subsystem="console">',
    );
    expect(manifest).toContain('<uap5:ExecutionAlias Alias="dotweave.exe" />');
  });

  test("escapes XML special characters in identity fields", () => {
    const manifest = buildMsixManifest({
      arch: "x64",
      identity: {
        identityName: "foo&bar<baz",
        publisher: 'CN="Test"',
        publisherDisplayName: "test",
      },
      version: "1.0.0.0",
    });

    expect(manifest).toContain('Name="foo&amp;bar&lt;baz"');
    expect(manifest).toContain('Publisher="CN=&quot;Test&quot;"');
  });
});

describe("readMsixIdentityFromEnv", () => {
  const baseEnv = {
    MSIX_IDENTITY_NAME: "tinyrack.dotweave",
    MSIX_PUBLISHER: "CN=tinyrack",
    MSIX_PUBLISHER_DISPLAY_NAME: "tinyrack",
  };

  test("returns full identity when all required env vars present", () => {
    const result = readMsixIdentityFromEnv(baseEnv);

    expect(result).toEqual({
      identityName: "tinyrack.dotweave",
      publisher: "CN=tinyrack",
      publisherDisplayName: "tinyrack",
    });
  });

  test("includes displayName when MSIX_DISPLAY_NAME is non-empty", () => {
    const result = readMsixIdentityFromEnv({
      ...baseEnv,
      MSIX_DISPLAY_NAME: "Dotweave",
    });

    expect(result.displayName).toBe("Dotweave");
  });

  test("omits displayName when MSIX_DISPLAY_NAME is empty string", () => {
    const result = readMsixIdentityFromEnv({
      ...baseEnv,
      MSIX_DISPLAY_NAME: "",
    });

    expect(result).not.toHaveProperty("displayName");
  });

  test("omits displayName when MSIX_DISPLAY_NAME is whitespace-only", () => {
    const result = readMsixIdentityFromEnv({
      ...baseEnv,
      MSIX_DISPLAY_NAME: "   ",
    });

    expect(result).not.toHaveProperty("displayName");
  });

  test("throws when MSIX_IDENTITY_NAME is missing", () => {
    const { MSIX_IDENTITY_NAME: _, ...envWithoutName } = baseEnv;

    expect(() => readMsixIdentityFromEnv(envWithoutName)).toThrow(
      /MSIX_IDENTITY_NAME.*required/iu,
    );
  });

  test("throws when MSIX_PUBLISHER is missing", () => {
    const { MSIX_PUBLISHER: _, ...envWithoutPublisher } = baseEnv;

    expect(() => readMsixIdentityFromEnv(envWithoutPublisher)).toThrow(
      /MSIX_PUBLISHER.*required/iu,
    );
  });

  test("throws when MSIX_PUBLISHER_DISPLAY_NAME is missing", () => {
    const { MSIX_PUBLISHER_DISPLAY_NAME: _, ...envWithoutDisplay } = baseEnv;

    expect(() => readMsixIdentityFromEnv(envWithoutDisplay)).toThrow(
      /MSIX_PUBLISHER_DISPLAY_NAME.*required/iu,
    );
  });

  test("throws when required env var is empty string", () => {
    expect(() =>
      readMsixIdentityFromEnv({ ...baseEnv, MSIX_IDENTITY_NAME: "" }),
    ).toThrow(/MSIX_IDENTITY_NAME.*required/iu);
  });
});
