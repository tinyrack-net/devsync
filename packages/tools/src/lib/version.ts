export type Version = {
  major: number;
  minor: number;
  patch: number;
};

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;
const VERSION_TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(version: string): Version {
  const match = VERSION_PATTERN.exec(version);

  if (!match) {
    throw new Error(`Invalid version: ${version}`);
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);

  return { major, minor, patch };
}

export function parseVersionTag(tag: string): Version {
  const match = VERSION_TAG_PATTERN.exec(tag);

  if (!match) {
    throw new Error(`Invalid release tag: ${tag}`);
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);

  return { major, minor, patch };
}

export function formatVersion(version: Version): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

export function formatVersionTag(version: Version): string {
  return `v${formatVersion(version)}`;
}

export function bumpVersion(
  version: Version,
  releaseType: "patch" | "minor" | "major",
): Version {
  if (releaseType === "patch") {
    return {
      major: version.major,
      minor: version.minor,
      patch: version.patch + 1,
    };
  }

  if (releaseType === "minor") {
    return {
      major: version.major,
      minor: version.minor + 1,
      patch: 0,
    };
  }

  return {
    major: version.major + 1,
    minor: 0,
    patch: 0,
  };
}
