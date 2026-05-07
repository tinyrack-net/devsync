import { describe, expect, test } from "vitest";
import { buildMsixManifest, convertVersionToMsixVersion } from "./msix.ts";

describe("msix helpers", () => {
  test("converts package semver to a four-part MSIX version", () => {
    expect(convertVersionToMsixVersion("0.42.14")).toBe("0.42.14.0");
  });

  test("rejects non-MSIX-compatible package versions", () => {
    expect(() => convertVersionToMsixVersion("1.2")).toThrow(
      "Invalid package version",
    );
    expect(() => convertVersionToMsixVersion("1.2.70000")).toThrow(
      "MSIX version segment out of range",
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
});
