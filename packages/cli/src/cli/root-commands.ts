import cdCommand from "#app/cli/cd.js";
import doctorCommand from "#app/cli/doctor.js";
import initCommand from "#app/cli/init.js";
import profileRoute from "#app/cli/profile/index.js";
import pullCommand from "#app/cli/pull.js";
import pushCommand from "#app/cli/push.js";
import statusCommand from "#app/cli/status.js";
import trackCommand from "#app/cli/track.js";
import untrackCommand from "#app/cli/untrack.js";

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
