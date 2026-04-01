import {
  type Application,
  buildCommand,
  buildRouteMap,
  proposeCompletions,
} from "@stricli/core";

import {
  BASH_AUTOCOMPLETE_SCRIPT,
  POWERSHELL_AUTOCOMPLETE_SCRIPT,
  resolveCompletionInputs,
  ZSH_AUTOCOMPLETE_SCRIPT,
} from "#app/services/autocomplete.ts";
import type { DevsyncCliContext } from "#app/services/terminal/cli-runtime.ts";

type EmptyFlags = Record<never, never>;

const buildAutocompleteScriptCommand = (
  shell: "bash" | "zsh" | "powershell",
  script: string,
) => {
  return buildCommand<EmptyFlags, [], DevsyncCliContext>({
    docs: {
      brief: `Print ${shell} autocomplete script`,
      fullDescription: `Emit a ${shell} autocomplete script for use with \`eval "$(devsync autocomplete ${shell})"\`.`,
    },
    func: () => {
      process.stdout.write(script);
    },
    parameters: {},
  });
};

const bashAutocompleteCommand = buildAutocompleteScriptCommand(
  "bash",
  BASH_AUTOCOMPLETE_SCRIPT,
);
const zshAutocompleteCommand = buildAutocompleteScriptCommand(
  "zsh",
  ZSH_AUTOCOMPLETE_SCRIPT,
);
const powershellAutocompleteCommand = buildAutocompleteScriptCommand(
  "powershell",
  POWERSHELL_AUTOCOMPLETE_SCRIPT,
);

const buildCompleteCommand = (
  getApplication: () => Application<DevsyncCliContext>,
) => {
  return buildCommand<EmptyFlags, string[], DevsyncCliContext>({
    docs: {
      brief: "Internal completion command",
    },
    func: async function (_flags, ...inputs) {
      const completions = await proposeCompletions(
        getApplication(),
        resolveCompletionInputs(inputs),
        this,
      );

      if (completions.length === 0) {
        return;
      }

      const lines = completions
        .map((c) => (c.brief ? `${c.completion}\t${c.brief}` : c.completion))
        .join("\n");

      process.stdout.write(`${lines}\n`);
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
        brief: "Print shell autocomplete scripts",
        fullDescription:
          "Emit shell-specific autocomplete scripts for use with eval-based shell setup.",
      },
      routes: {
        bash: bashAutocompleteCommand,
        powershell: powershellAutocompleteCommand,
        zsh: zshAutocompleteCommand,
      },
    }),
    completeCommand: buildCompleteCommand(getApplication),
  };
};
