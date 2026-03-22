import SyncDir from "#app/cli/commands/dir.ts";
import SyncDoctor from "#app/cli/commands/doctor.ts";
import SyncInit from "#app/cli/commands/init.ts";
import SyncList from "#app/cli/commands/list.ts";
import SyncMachineAssign from "#app/cli/commands/machine/assign.ts";
import SyncMachineList from "#app/cli/commands/machine/list.ts";
import SyncMachineUnassign from "#app/cli/commands/machine/unassign.ts";
import SyncMachineUnset from "#app/cli/commands/machine/unset.ts";
import SyncMachineUse from "#app/cli/commands/machine/use.ts";
import SyncMode from "#app/cli/commands/mode.ts";
import SyncPull from "#app/cli/commands/pull.ts";
import SyncPush from "#app/cli/commands/push.ts";
import SyncStatus from "#app/cli/commands/status.ts";
import SyncTrack from "#app/cli/commands/track.ts";
import SyncUntrack from "#app/cli/commands/untrack.ts";

export const COMMANDS = {
  dir: SyncDir,
  doctor: SyncDoctor,
  init: SyncInit,
  list: SyncList,
  "machine:assign": SyncMachineAssign,
  "machine:list": SyncMachineList,
  "machine:unassign": SyncMachineUnassign,
  "machine:unset": SyncMachineUnset,
  "machine:use": SyncMachineUse,
  mode: SyncMode,
  pull: SyncPull,
  push: SyncPush,
  status: SyncStatus,
  track: SyncTrack,
  untrack: SyncUntrack,
};
