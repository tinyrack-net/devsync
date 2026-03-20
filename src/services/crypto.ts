import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  armor,
  Decrypter,
  Encrypter,
  generateIdentity,
  identityToRecipient,
} from "age-encryption";

import { ensureTrailingNewline } from "#app/lib/string.ts";

export const readAgeIdentityLines = async (identityFile: string) => {
  const contents = await readFile(identityFile, "utf8");
  const identities = contents
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => {
      return line !== "" && !line.startsWith("#");
    });

  if (identities.length === 0) {
    throw new Error(`No age identities found in ${identityFile}`);
  }

  return identities;
};

export const readAgeRecipientsFromIdentityFile = async (
  identityFile: string,
) => {
  const identities = await readAgeIdentityLines(identityFile);
  const recipients = await Promise.all(
    identities.map(async (identity) => {
      return await identityToRecipient(identity);
    }),
  );

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

  return await decrypter.decrypt(armor.decode(armoredCiphertext));
};
