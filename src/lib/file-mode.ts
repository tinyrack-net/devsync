export const buildExecutableMode = (executable: boolean) => {
  return executable ? 0o755 : 0o644;
};

export const buildSearchableDirectoryMode = (mode: number) => {
  const normalizedMode = mode & 0o777;

  return normalizedMode | ((normalizedMode & 0o444) >> 2);
};

export const isExecutableMode = (mode: number | bigint) => {
  return (Number(mode) & 0o111) !== 0;
};

const permissionOctalPattern = /^0[0-7]{3}$/;

export const isPermissionOctal = (value: string) => {
  return permissionOctalPattern.test(value);
};

export const parsePermissionOctal = (value: string) => {
  if (!isPermissionOctal(value)) {
    throw new Error(
      `Invalid permission octal: ${value}. Expected a 4-character octal string like "0600" or "0755".`,
    );
  }

  return Number.parseInt(value, 8);
};

export const formatPermissionOctal = (mode: number) => {
  return `0${(mode & 0o777).toString(8).padStart(3, "0")}`;
};
