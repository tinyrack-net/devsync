import { buildCommand } from "@stricli/core";
import { consola } from "consola";
import {
  performRelease,
  type ReleaseType,
  releaseTypeSchema,
} from "../../lib/release.ts";
import { parseWithZod } from "../../lib/zod.ts";

type ReleaseArgs = [releaseType: ReleaseType];
type ReleaseCommandFlags = {
  dryRun: boolean;
};

export async function runReleaseCommand(
  flags: ReleaseCommandFlags,
  releaseType: ReleaseType,
): Promise<void> {
  const logger = consola.create({
    defaults: {
      tag: "release",
    },
  });

  const result = await performRelease({
    cwd: process.cwd(),
    dryRun: flags.dryRun,
    logger,
    releaseType,
  });

  if (result.dryRun) {
    logger.success(
      `Dry run: would release ${result.version} from ${result.previousTag} to ${result.tag}`,
    );
    return;
  }

  logger.success(
    `Released ${result.version} from ${result.previousTag} to ${result.tag}`,
  );
}

export const releaseCommand = buildCommand<ReleaseCommandFlags, ReleaseArgs>({
  parameters: {
    flags: {
      dryRun: {
        kind: "boolean",
        brief:
          "Validate and show the next release without changing files or git state",
        default: false,
      },
    },
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Semver bump type",
          parse: async (input) =>
            await parseWithZod(input, {
              label: "release-type",
              schema: releaseTypeSchema,
            }),
        },
      ],
    },
    aliases: {
      n: "dryRun",
    },
  },
  docs: {
    brief: "Release the CLI package",
    fullDescription:
      "Bump release versions from current package versions and create a commit and signed tag.",
  },
  func: runReleaseCommand,
});

export default releaseCommand;
