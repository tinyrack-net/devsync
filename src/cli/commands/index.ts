import SyncDir from "#app/cli/commands/dir.js";
import SyncDoctor from "#app/cli/commands/doctor.js";
import SyncInit from "#app/cli/commands/init.js";
import SyncMachineList from "#app/cli/commands/machine/list.js";
import SyncMachineUse from "#app/cli/commands/machine/use.js";
import SyncPull from "#app/cli/commands/pull.js";
import SyncPush from "#app/cli/commands/push.js";
import SyncStatus from "#app/cli/commands/status.js";
import SyncTrack from "#app/cli/commands/track.js";
import SyncUntrack from "#app/cli/commands/untrack.js";

export const COMMANDS = {
  dir: SyncDir,
  doctor: SyncDoctor,
  init: SyncInit,
  "machine:list": SyncMachineList,
  "machine:use": SyncMachineUse,
  pull: SyncPull,
  push: SyncPush,
  status: SyncStatus,
  track: SyncTrack,
  untrack: SyncUntrack,
};
