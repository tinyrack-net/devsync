import { Command } from "@oclif/core";

import { getCliServices } from "#app/cli/runtime.ts";
import type { CliServices } from "#app/cli/services.ts";

export abstract class BaseCommand extends Command {
  protected get services(): CliServices {
    return getCliServices();
  }

  protected writeStdout(text: string): void {
    process.stdout.write(text);
  }

  protected writeStderr(text: string): void {
    process.stderr.write(text);
  }
}
