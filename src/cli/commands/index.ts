import SyncAdd from "#app/cli/commands/add.ts";
import SyncCd from "#app/cli/commands/cd.ts";
import SyncDoctor from "#app/cli/commands/doctor.ts";
import SyncForget from "#app/cli/commands/forget.ts";
import SyncInit from "#app/cli/commands/init.ts";
import SyncList from "#app/cli/commands/list.ts";
import SyncProfileActivate from "#app/cli/commands/profile/activate.ts";
import SyncProfileClear from "#app/cli/commands/profile/clear.ts";
import SyncProfileDeactivate from "#app/cli/commands/profile/deactivate.ts";
import SyncProfileList from "#app/cli/commands/profile/list.ts";
import SyncProfileUse from "#app/cli/commands/profile/use.ts";
import SyncPull from "#app/cli/commands/pull.ts";
import SyncPush from "#app/cli/commands/push.ts";
import SyncSet from "#app/cli/commands/set.ts";
import SyncStatus from "#app/cli/commands/status.ts";

export const COMMANDS = {
  add: SyncAdd,
  cd: SyncCd,
  doctor: SyncDoctor,
  forget: SyncForget,
  init: SyncInit,
  list: SyncList,
  "profile:activate": SyncProfileActivate,
  "profile:clear": SyncProfileClear,
  "profile:deactivate": SyncProfileDeactivate,
  "profile:list": SyncProfileList,
  "profile:use": SyncProfileUse,
  pull: SyncPull,
  push: SyncPush,
  status: SyncStatus,
  set: SyncSet,
};
