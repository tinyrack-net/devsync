import SyncAdd from "#app/cli/commands/add.ts";
import SyncAssign from "#app/cli/commands/assign.ts";
import SyncCd from "#app/cli/commands/cd.ts";
import SyncDoctor from "#app/cli/commands/doctor.ts";
import SyncInit from "#app/cli/commands/init.ts";
import SyncList from "#app/cli/commands/list.ts";
import SyncMachineClear from "#app/cli/commands/machine/clear.ts";
import SyncMachineList from "#app/cli/commands/machine/list.ts";
import SyncMachineUse from "#app/cli/commands/machine/use.ts";
import SyncPull from "#app/cli/commands/pull.ts";
import SyncPush from "#app/cli/commands/push.ts";
import SyncRemove from "#app/cli/commands/remove.ts";
import SyncSet from "#app/cli/commands/set.ts";
import SyncStatus from "#app/cli/commands/status.ts";
import SyncUnassign from "#app/cli/commands/unassign.ts";

export const COMMANDS = {
  add: SyncAdd,
  assign: SyncAssign,
  cd: SyncCd,
  doctor: SyncDoctor,
  init: SyncInit,
  list: SyncList,
  "machine:clear": SyncMachineClear,
  "machine:list": SyncMachineList,
  "machine:use": SyncMachineUse,
  pull: SyncPull,
  push: SyncPush,
  remove: SyncRemove,
  set: SyncSet,
  status: SyncStatus,
  unassign: SyncUnassign,
};
