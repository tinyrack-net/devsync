import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createAgeIdentityFile,
  decryptSecretFile,
  encryptSecretFile,
  readAgeIdentityLines,
  readAgeRecipientsFromIdentityFile,
  resolveAgeIdentity,
  writeAgeIdentityFile,
} from "#app/services/crypto.ts";
import {
  createAgeKeyPair,
  createTemporaryDirectory,
} from "../test/helpers/sync-fixture.ts";

const temporaryDirectories: string[] = [];

const createWorkspace = async () => {
  const directory = await createTemporaryDirectory("devsync-sync-crypto-");

  temporaryDirectories.push(directory);

  return directory;
};

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();

    if (directory !== undefined) {
      await rm(directory, { force: true, recursive: true });
    }
  }
});

describe("sync crypto helpers", () => {
  it("reads identities while ignoring blank lines and comments", async () => {
    const workspace = await createWorkspace();
    const keyPair = await createAgeKeyPair();
    const identityFile = join(workspace, "keys.txt");

    await writeFile(
      identityFile,
      `\n# first\n${keyPair.identity}\n\n# second\n${keyPair.identity}\n`,
      "utf8",
    );

    expect(await readAgeIdentityLines(identityFile)).toEqual([
      keyPair.identity,
      keyPair.identity,
    ]);
  });

  it("fails when no usable identities are present", async () => {
    const workspace = await createWorkspace();
    const identityFile = join(workspace, "keys.txt");

    await writeFile(identityFile, "\n# comment only\n\n", "utf8");

    await expect(readAgeIdentityLines(identityFile)).rejects.toThrowError(
      /No age identities were found/u,
    );
  });

  it("deduplicates recipients derived from repeated identities", async () => {
    const workspace = await createWorkspace();
    const keyPair = await createAgeKeyPair();
    const identityFile = join(workspace, "keys.txt");

    await writeFile(
      identityFile,
      `${keyPair.identity}\n${keyPair.identity}\n`,
      "utf8",
    );

    expect(await readAgeRecipientsFromIdentityFile(identityFile)).toEqual([
      keyPair.recipient,
    ]);
  });

  it("creates a new identity file with a trailing newline", async () => {
    const workspace = await createWorkspace();
    const identityFile = join(workspace, "nested", "keys.txt");

    const result = await createAgeIdentityFile(identityFile);
    const contents = await readFile(identityFile, "utf8");

    expect(contents.endsWith("\n")).toBe(true);
    expect(await readAgeRecipientsFromIdentityFile(identityFile)).toEqual([
      result.recipient,
    ]);
  });

  it("validates and normalizes a supplied age identity", async () => {
    const keyPair = await createAgeKeyPair();

    await expect(
      resolveAgeIdentity(`  ${keyPair.identity}  `),
    ).resolves.toEqual({
      identity: keyPair.identity,
      recipient: keyPair.recipient,
    });
  });

  it("rejects an invalid supplied age identity", async () => {
    await expect(resolveAgeIdentity("not-a-key")).rejects.toThrowError(
      /Invalid age private key/u,
    );
  });

  it("writes a supplied identity file with a trailing newline", async () => {
    const workspace = await createWorkspace();
    const keyPair = await createAgeKeyPair();
    const identityFile = join(workspace, "manual.txt");

    const result = await writeAgeIdentityFile(
      identityFile,
      `  ${keyPair.identity}  `,
    );

    expect(result).toEqual({
      identity: keyPair.identity,
      recipient: keyPair.recipient,
    });
    expect(await readFile(identityFile, "utf8")).toBe(`${keyPair.identity}\n`);
  });

  it("round-trips secret payloads through age encryption", async () => {
    const workspace = await createWorkspace();
    const keyPair = await createAgeKeyPair();
    const identityFile = join(workspace, "keys.txt");
    const payload = new TextEncoder().encode("super secret payload");

    await writeFile(identityFile, `${keyPair.identity}\n`, "utf8");

    const ciphertext = await encryptSecretFile(payload, [keyPair.recipient]);
    const plaintext = await decryptSecretFile(ciphertext, identityFile);

    expect(new TextDecoder().decode(plaintext)).toBe("super secret payload");
  });

  it("fails to decrypt with the wrong identity or malformed ciphertext", async () => {
    const workspace = await createWorkspace();
    const sender = await createAgeKeyPair();
    const wrongIdentity = await createAgeKeyPair();
    const senderIdentityFile = join(workspace, "sender.txt");
    const wrongIdentityFile = join(workspace, "wrong.txt");

    await writeFile(senderIdentityFile, `${sender.identity}\n`, "utf8");
    await writeFile(wrongIdentityFile, `${wrongIdentity.identity}\n`, "utf8");

    const ciphertext = await encryptSecretFile(
      new TextEncoder().encode("secret"),
      [sender.recipient],
    );

    await expect(
      decryptSecretFile(ciphertext, wrongIdentityFile),
    ).rejects.toThrowError();
    await expect(
      decryptSecretFile("not a valid age payload", senderIdentityFile),
    ).rejects.toThrowError();
  });
});
