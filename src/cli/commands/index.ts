import SyncCd from "#app/cli/commands/cd.ts";
import SyncDoctor from "#app/cli/commands/doctor.ts";
import SyncEntryMode from "#app/cli/commands/entry/mode.ts";
import SyncInit from "#app/cli/commands/init.ts";
import SyncList from "#app/cli/commands/list.ts";
import SyncMachineClear from "#app/cli/commands/machine/clear.ts";
import SyncMachineList from "#app/cli/commands/machine/list.ts";
import SyncMachineUse from "#app/cli/commands/machine/use.ts";
import SyncPull from "#app/cli/commands/pull.ts";
import SyncPush from "#app/cli/commands/push.ts";
import SyncRuleSet from "#app/cli/commands/rule/set.ts";
import SyncRuleUnset from "#app/cli/commands/rule/unset.ts";
import SyncStatus from "#app/cli/commands/status.ts";
import SyncTrack from "#app/cli/commands/track.ts";
import SyncUntrack from "#app/cli/commands/untrack.ts";

export const COMMANDS = {
  cd: SyncCd,
  doctor: SyncDoctor,
  "entry:mode": SyncEntryMode,
  init: SyncInit,
  list: SyncList,
  "machine:clear": SyncMachineClear,
  "machine:list": SyncMachineList,
  "machine:use": SyncMachineUse,
  pull: SyncPull,
  push: SyncPush,
  "rule:set": SyncRuleSet,
  "rule:unset": SyncRuleUnset,
  status: SyncStatus,
  track: SyncTrack,
  untrack: SyncUntrack,
};
