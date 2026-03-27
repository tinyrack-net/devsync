import cdCommand from "#app/cli/cd.ts";
import doctorCommand from "#app/cli/doctor.ts";
import initCommand from "#app/cli/init.ts";
import profileRoute from "#app/cli/profile/index.ts";
import pullCommand from "#app/cli/pull.ts";
import pushCommand from "#app/cli/push.ts";
import statusCommand from "#app/cli/status.ts";
import trackCommand from "#app/cli/track.ts";
import untrackCommand from "#app/cli/untrack.ts";

export const rootCommandRoutes = {
  cd: cdCommand,
  doctor: doctorCommand,
  init: initCommand,
  profile: profileRoute,
  pull: pullCommand,
  push: pushCommand,
  status: statusCommand,
  track: trackCommand,
  untrack: untrackCommand,
};

export const rootCommandNames = [
  "autocomplete",
  ...Object.keys(rootCommandRoutes),
];
