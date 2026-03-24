import SyncDir from "#app/cli/commands/dir.js";
import SyncDoctor from "#app/cli/commands/doctor.js";
import SyncInit from "#app/cli/commands/init.js";
import SyncProfileList from "#app/cli/commands/profile/list.js";
import SyncProfileUse from "#app/cli/commands/profile/use.js";
import SyncPull from "#app/cli/commands/pull.js";
import SyncPush from "#app/cli/commands/push.js";
import SyncStatus from "#app/cli/commands/status.js";
import SyncTrack from "#app/cli/commands/track.js";
import SyncUntrack from "#app/cli/commands/untrack.js";

export const COMMANDS = {
  dir: SyncDir,
  doctor: SyncDoctor,
  init: SyncInit,
  "profile:list": SyncProfileList,
  "profile:use": SyncProfileUse,
  pull: SyncPull,
  push: SyncPush,
  status: SyncStatus,
  track: SyncTrack,
  untrack: SyncUntrack,
};
