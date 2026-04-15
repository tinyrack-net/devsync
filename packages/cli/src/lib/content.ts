const decodeUtf8 = (contents: Uint8Array) => {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      contents,
    );
  } catch {
    return undefined;
  }
};

const normalizeLineEndings = (contents: string) => {
  return contents.replaceAll("\r\n", "\n");
};

export const fileContentsEqual = (
  left: Uint8Array,
  right: Uint8Array,
  options: Readonly<{
    normalizeTextLineEndings?: boolean;
  }> = {},
) => {
  if (Buffer.compare(Buffer.from(left), Buffer.from(right)) === 0) {
    return true;
  }

  if (options.normalizeTextLineEndings !== true) {
    return false;
  }

  const leftText = decodeUtf8(left);
  const rightText = decodeUtf8(right);

  if (leftText === undefined || rightText === undefined) {
    return false;
  }

  return normalizeLineEndings(leftText) === normalizeLineEndings(rightText);
};

export const shouldNormalizeTextLineEndings = () => {
  return process.platform === "win32";
};
