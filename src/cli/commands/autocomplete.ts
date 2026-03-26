import {
  buildInstallCommand,
  buildUninstallCommand,
} from "@stricli/auto-complete";
import {
  type Application,
  buildCommand,
  buildRouteMap,
  proposeCompletions,
} from "@stricli/core";

import { type DevsyncCliContext, print } from "#app/cli/common.js";
import { output } from "#app/lib/output.js";

const AUTOCOMPLETE_COMMAND = "devsync __complete";
type EmptyFlags = Record<never, never>;

const bashAutocompleteCommand = buildCommand<EmptyFlags, [], DevsyncCliContext>(
  {
    docs: {
      brief: "Display bash autocomplete setup instructions",
      fullDescription:
        "Show how to enable bash autocomplete for devsync without changing your shell config automatically.",
    },
    func: () => {
      print(
        output(
          "Setup Instructions for DEVSYNC CLI Autocomplete",
          "",
          "To install bash autocomplete, run:",
          "  devsync autocomplete install",
          "",
          "To remove it later, run:",
          "  devsync autocomplete uninstall",
          "",
          "The installed bash hook will invoke:",
          `  ${AUTOCOMPLETE_COMMAND}`,
        ),
      );
    },
    parameters: {},
  },
);

const resolveCompletionInputs = (inputs: readonly string[]) => {
  const environment: NodeJS.ProcessEnv & { COMP_LINE?: string } = process.env;
  const completionLine = environment.COMP_LINE;

  if (completionLine === undefined) {
    return [...inputs];
  }

  const trimmedStart = completionLine.trimStart();

  if (trimmedStart === "") {
    return [];
  }

  const completionInputs = trimmedStart.split(/\s+/u);

  if (/\s$/u.test(completionLine)) {
    completionInputs.push("");
  }

  return completionInputs;
};

const buildCompleteCommand = (
  getApplication: () => Application<DevsyncCliContext>,
) => {
  return buildCommand<EmptyFlags, string[], DevsyncCliContext>({
    docs: {
      brief: "Internal completion command",
    },
    func: async (_flags, ...inputs) => {
      const completions = await proposeCompletions(
        getApplication(),
        resolveCompletionInputs(inputs),
        {
          process,
        },
      );

      if (completions.length === 0) {
        return;
      }

      print(output(...completions.map((completion) => completion.completion)));
    },
    parameters: {
      positional: {
        kind: "array",
        minimum: 0,
        parameter: {
          brief: "Completion input token",
          parse: String,
          placeholder: "input",
        },
      },
    },
  });
};

export const buildAutocompleteRoute = (
  getApplication: () => Application<DevsyncCliContext>,
) => {
  return {
    autocompleteRoute: buildRouteMap({
      docs: {
        brief: "Manage shell autocomplete support",
        fullDescription:
          "Display setup instructions or install/uninstall bash autocomplete support for devsync.",
      },
      routes: {
        bash: bashAutocompleteCommand,
        install: buildInstallCommand("devsync", {
          bash: AUTOCOMPLETE_COMMAND,
        }),
        uninstall: buildUninstallCommand("devsync", {
          bash: true,
        }),
      },
    }),
    completeCommand: buildCompleteCommand(getApplication),
  };
};
