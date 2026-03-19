import SyncAdd from "#app/cli/commands/sync/add.ts";
import SyncCd from "#app/cli/commands/sync/cd.ts";
import SyncForget from "#app/cli/commands/sync/forget.ts";
import SyncInit from "#app/cli/commands/sync/init.ts";
import SyncPull from "#app/cli/commands/sync/pull.ts";
import SyncPush from "#app/cli/commands/sync/push.ts";
import SyncSet from "#app/cli/commands/sync/set.ts";

export const COMMANDS = {
  add: SyncAdd,
  cd: SyncCd,
  forget: SyncForget,
  init: SyncInit,
  pull: SyncPull,
  push: SyncPush,
  set: SyncSet,
};
