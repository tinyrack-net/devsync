import type { ConfigMigrationFn } from "#app/config/migration.ts";

export const migrateGlobalConfigV2ToV3: ConfigMigrationFn = (config) => {
  const { age: _age, ...rest } = config;
  return { ...rest, version: 3 };
};
