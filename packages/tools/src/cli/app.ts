import {
  buildApplication,
  type CommandContext,
  run,
  type StricliDynamicCommandContext,
} from "@stricli/core";
import packageJson from "../../package.json" with { type: "json" };
import { commands } from "./commands/index.ts";

export type ToolsCliContext = CommandContext;

export const app = buildApplication(commands, {
  name: "dotweave-tools",
  versionInfo: {
    currentVersion: packageJson.version,
  },
  scanner: {
    caseStyle: "allow-kebab-for-camel",
  },
  documentation: {
    useAliasInUsageLine: true,
  },
});

export async function runCli(
  args: readonly string[],
  context: StricliDynamicCommandContext<ToolsCliContext>,
): Promise<void> {
  await run(app, args, context);
}
