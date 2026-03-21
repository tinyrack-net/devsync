import { Flags } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncListResult } from "#app/lib/output.ts";
import { listSyncConfig } from "#app/services/list.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncList extends BaseCommand {
  public static override summary = "Show tracked sync entries and rules";

  public static override description =
    "Print the current devsync configuration, including tracked roots, their base modes, child rules, and any machine-specific overlays.";

  public static override examples = [
    "<%= config.bin %> <%= command.id %>",
    "<%= config.bin %> <%= command.id %> --machine work",
  ];

  public static override flags = {
    machine: Flags.string({
      summary: "Use a specific machine layer for this command",
      description:
        "Override the persisted active machine for this list command only.",
    }),
  };

  public override async run(): Promise<void> {
    const { flags } = await this.parse(SyncList);
    const output = formatSyncListResult(
      await listSyncConfig(createSyncContext(), {
        machine: flags.machine,
      }),
    );

    this.print(output);
  }
}
