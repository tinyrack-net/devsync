import { BaseCommand } from "#app/cli/base-command.js";
import { resolveDevsyncSyncDirectory } from "#app/config/xdg.js";
import { output } from "#app/lib/output.js";

export default class SyncDir extends BaseCommand {
  public static override summary = "Print the sync directory path";

  public static override description =
    'Print the absolute path of the local sync repository directory. Compose with your shell to navigate there, for example: cd "$(devsync dir)".';

  public static override examples = [
    "<%= config.bin %> <%= command.id %>",
    'cd "$(<%= config.bin %> <%= command.id %>)"',
  ];

  public override async run(): Promise<void> {
    const syncDirectory = resolveDevsyncSyncDirectory();
    this.print(output(syncDirectory));
  }
}
