import SyncDir from "#app/cli/commands/dir.ts";
import SyncDoctor from "#app/cli/commands/doctor.ts";
import SyncInit from "#app/cli/commands/init.ts";
import SyncMachineList from "#app/cli/commands/machine/list.ts";
import SyncMachineUse from "#app/cli/commands/machine/use.ts";
import SyncPull from "#app/cli/commands/pull.ts";
import SyncPush from "#app/cli/commands/push.ts";
import SyncStatus from "#app/cli/commands/status.ts";
import SyncTrack from "#app/cli/commands/track.ts";
import SyncUntrack from "#app/cli/commands/untrack.ts";

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
