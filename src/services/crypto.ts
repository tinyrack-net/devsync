import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  armor,
  Decrypter,
  Encrypter,
  generateIdentity,
  identityToRecipient,
} from "age-encryption";

import { ensureTrailingNewline } from "#app/lib/string.js";
import { DevsyncError, wrapUnknownError } from "#app/services/error.js";

export const readAgeIdentityLines = async (identityFile: string) => {
  const contents = await readFile(identityFile, "utf8");
  const identities = contents
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => {
      return line !== "" && !line.startsWith("#");
    });

  if (identities.length === 0) {
    throw new DevsyncError(
      "No age identities were found in the configured identity file.",
      {
        code: "AGE_IDENTITY_EMPTY",
        details: [`Identity file: ${identityFile}`],
        hint: "Add at least one age private key to the identity file, or run 'devsync init' to generate one.",
      },
    );
  }

  return identities;
};

export const readAgeRecipientsFromIdentityFile = async (
  identityFile: string,
) => {
  const identities = await readAgeIdentityLines(identityFile);
  let recipients: string[];

  try {
    recipients = await Promise.all(
      identities.map(async (identity) => {
        return await identityToRecipient(identity);
      }),
    );
  } catch (error: unknown) {
    throw wrapUnknownError(
      "Failed to read age recipients from the configured identity file.",
      error,
      {
        code: "AGE_RECIPIENT_READ_FAILED",
        details: [`Identity file: ${identityFile}`],
        hint: "Check that the identity file contains valid age private keys.",
      },
    );
  }

  return [...new Set(recipients)];
};

export const createAgeIdentityFile = async (identityFile: string) => {
  const identity = await generateIdentity();
  const recipient = await identityToRecipient(identity);

  await mkdir(dirname(identityFile), { recursive: true });
  await writeFile(identityFile, ensureTrailingNewline(identity), "utf8");

  return {
    identity,
    recipient,
  };
};

export const encryptSecretFile = async (
  contents: Uint8Array,
  recipients: readonly string[],
) => {
  const encrypter = new Encrypter();

  for (const recipient of recipients) {
    encrypter.addRecipient(recipient);
  }

  const ciphertext = await encrypter.encrypt(contents);

  return armor.encode(ciphertext);
};

export const decryptSecretFile = async (
  armoredCiphertext: string,
  identityFile: string,
) => {
  const decrypter = new Decrypter();
  const identities = await readAgeIdentityLines(identityFile);

  for (const identity of identities) {
    decrypter.addIdentity(identity);
  }

  try {
    return await decrypter.decrypt(armor.decode(armoredCiphertext));
  } catch (error: unknown) {
    throw wrapUnknownError("Failed to decrypt a secret artifact.", error, {
      code: "AGE_DECRYPT_FAILED",
      details: [`Identity file: ${identityFile}`],
      hint: "Check that the artifact is valid age data and that the configured identity file matches one of its recipients.",
    });
  }
};
