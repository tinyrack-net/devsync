import { fileURLToPath } from "node:url";

import { Args, Command, Flags } from "@oclif/core";

import {
  createSkillInstaller,
  runInstallSkillsCommand,
  supportedSkillInstallAgents,
} from "#app/skills/install.ts";

const bundledSkillsDirectory = fileURLToPath(
  new URL("../../../../skills", import.meta.url),
);

const skillInstaller = createSkillInstaller({
  skillsDirectory: bundledSkillsDirectory,
});

export default class InstallSkills extends Command {
  public static override summary =
    "Install bundled skill templates for an agent harness";

  public static override args = {
    agent: Args.string({
      description: "Agent harness to install skills for",
      options: [...supportedSkillInstallAgents],
      required: true,
    }),
  };

  public static override flags = {
    "dry-run": Flags.boolean({
      default: false,
      description: "Show what would be installed without changing files",
    }),
    force: Flags.boolean({
      default: false,
      description: "Replace existing skill targets",
    }),
    "target-dir": Flags.string({
      description: "Override the destination directory for installed skills",
    }),
  };

  public override async run(): Promise<void> {
    const { args, flags } = await this.parse(InstallSkills);
    const output = await runInstallSkillsCommand(
      {
        agent: args.agent,
        options: {
          dryRun: flags["dry-run"],
          force: flags.force,
          targetDir: flags["target-dir"],
        },
      },
      {
        skillInstaller,
      },
    );

    process.stdout.write(output);
  }
}
