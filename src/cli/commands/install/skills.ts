import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.ts";
import {
  runInstallSkillsCommand,
  supportedSkillInstallAgents,
} from "#app/skills/install.ts";

export default class InstallSkills extends BaseCommand {
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
        skillInstaller: this.services.skillInstaller,
      },
    );

    this.writeStdout(output);
  }
}
