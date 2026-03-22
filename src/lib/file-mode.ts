export const buildExecutableMode = (executable: boolean) => {
  return executable ? 0o755 : 0o644;
};

export const isExecutableMode = (mode: number | bigint) => {
  return (Number(mode) & 0o111) !== 0;
};
