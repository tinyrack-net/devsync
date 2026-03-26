import { BaseCommand } from "#app/cli/base-command.js";

export default class SyncCd extends BaseCommand {
  public static override summary = "Launch a shell in the sync directory";

  public static override description =
    "Launch a child shell rooted at the local sync repository directory. Like chezmoi cd, this opens a new shell session instead of changing the current directory of your existing shell.";

  public static override examples = ["<%= config.bin %> <%= command.id %>"];

  public override async run(): Promise<void> {
    const [
      { mkdir },
      { launchShellInDirectory },
      { resolveDevsyncSyncDirectory },
    ] = await Promise.all([
      import("node:fs/promises"),
      import("#app/cli/shell.js"),
      import("#app/config/xdg.js"),
    ]);
    const syncDirectory = resolveDevsyncSyncDirectory();

    await mkdir(syncDirectory, { recursive: true });
    await launchShellInDirectory(syncDirectory, process.env);
  }
}
