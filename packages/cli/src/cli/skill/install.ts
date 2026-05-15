import type { ApplicationContext } from "@stricli/core";
import { buildCommand } from "@stricli/core";
import { installDotweaveSkill } from "#app/services/skill-install.ts";
import { createCliLogger } from "#app/services/terminal/logger.ts";

type SkillInstallFlags = {
  dryRun?: boolean;
  force?: boolean;
};

const formatInstallMessage = (action: string) => {
  switch (action) {
    case "would-install":
      return "Would install dotweave skill";
    case "would-overwrite":
      return "Would overwrite dotweave skill";
    case "overwritten":
      return "Overwrote dotweave skill";
    default:
      return "Installed dotweave skill";
  }
};

const skillInstallCommand = buildCommand<
  SkillInstallFlags,
  [string],
  ApplicationContext
>({
  docs: {
    brief: "Install the bundled dotweave agent skill",
    fullDescription:
      "Install Dotweave's bundled portable agent skill into the specified skills directory.",
  },
  async func(flags, directory) {
    const logger = createCliLogger();
    const result = await installDotweaveSkill({
      directory,
      dryRun: flags.dryRun === true,
      force: flags.force === true,
    });
    const message = formatInstallMessage(result.action);

    if (result.dryRun) {
      logger.info(message);
    } else {
      logger.success(message);
    }

    logger.kv("target", result.targetPath);
  },
  parameters: {
    flags: {
      dryRun: {
        brief: "Report the install target without writing files",
        kind: "boolean",
        optional: true,
      },
      force: {
        brief: "Overwrite an existing dotweave skill",
        kind: "boolean",
        optional: true,
      },
    },
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Skills root directory",
          parse: String,
          placeholder: "directory",
        },
      ],
    },
  },
});

export default skillInstallCommand;
