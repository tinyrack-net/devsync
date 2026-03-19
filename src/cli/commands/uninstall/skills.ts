import { fileURLToPath } from "node:url";

import { Args, Command, Flags } from "@oclif/core";

import {
  createSkillUninstaller,
  runUninstallSkillsCommand,
  supportedSkillInstallAgents,
} from "#app/services/skills/install.ts";

const bundledSkillsDirectory = fileURLToPath(
  new URL("../../../../skills", import.meta.url),
);

const skillUninstaller = createSkillUninstaller({
  skillsDirectory: bundledSkillsDirectory,
});

export default class UninstallSkills extends Command {
  public static override summary =
    "Uninstall bundled skill templates for an agent harness";

  public static override args = {
    agent: Args.string({
      description: "Agent harness to uninstall skills for",
      options: [...supportedSkillInstallAgents],
      required: true,
    }),
  };

  public static override flags = {
    "dry-run": Flags.boolean({
      default: false,
      description: "Show what would be uninstalled without changing files",
    }),
    "target-dir": Flags.string({
      description: "Override the destination directory for uninstalled skills",
    }),
  };

  public override async run(): Promise<void> {
    const { args, flags } = await this.parse(UninstallSkills);
    const output = await runUninstallSkillsCommand(
      {
        agent: args.agent,
        options: {
          dryRun: flags["dry-run"],
          targetDir: flags["target-dir"],
        },
      },
      {
        skillUninstaller,
      },
    );

    process.stdout.write(output);
  }
}
