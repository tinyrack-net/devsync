import SyncAdd from "#app/cli/commands/add.ts";
import SyncCd from "#app/cli/commands/cd.ts";
import SyncForget from "#app/cli/commands/forget.ts";
import SyncInit from "#app/cli/commands/init.ts";
import SyncPull from "#app/cli/commands/pull.ts";
import SyncPush from "#app/cli/commands/push.ts";
import SyncSet from "#app/cli/commands/set.ts";

export const COMMANDS = {
  add: SyncAdd,
  cd: SyncCd,
  forget: SyncForget,
  init: SyncInit,
  pull: SyncPull,
  push: SyncPush,
  set: SyncSet,
};
