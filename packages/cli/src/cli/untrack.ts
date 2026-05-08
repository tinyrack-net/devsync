import type { ApplicationContext } from "@stricli/core";
import { buildCommand } from "@stricli/core";
import { createCliLogger } from "#app/services/terminal/logger.ts";
import { untrackTarget } from "#app/services/untrack.ts";

type UntrackFlags = Record<string, never>;

const untrackCommand = buildCommand<UntrackFlags, [string], ApplicationContext>(
  {
    docs: {
      brief: "Stop tracking a synced path",
      fullDescription:
        "Remove a tracked root entry or a nested override from dotweave configuration. This only updates the sync config; actual file changes happen on the next push or pull. Use a local path to remove the main tracked target, or use a repository-relative child path inside a tracked directory to remove only that override.",
    },
    async func(_flags, target) {
      const logger = createCliLogger();

      const result = await untrackTarget({ target }, process.cwd());

      logger.success(`Stopped tracking ${result.repoPath}`);
      logger.kv("plain", String(result.plainArtifactCount));
      logger.kv("secret", String(result.secretArtifactCount));
    },
    parameters: {
      flags: {},
      positional: {
        kind: "tuple",
        parameters: [
          {
            brief:
              "Tracked local path (including cwd-relative) or repository path to stop tracking",
            parse: String,
            placeholder: "target",
          },
        ],
      },
    },
  },
);

export default untrackCommand;
