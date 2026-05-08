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
import type { DotweaveCliContext } from "#app/services/terminal/cli-runtime.ts";

type EmptyFlags = Record<never, never>;

let _application: Application<DotweaveCliContext> | undefined;

export const setApplication = (app: Application<DotweaveCliContext>) => {
  _application = app;
};

const buildAutocompleteScriptCommand = (
  shell: "bash" | "zsh" | "powershell",
  script: string,
) => {
  return buildCommand<EmptyFlags, [], DotweaveCliContext>({
    docs: {
      brief: `Print ${shell} autocomplete script`,
      fullDescription: `Emit a ${shell} autocomplete script for use with \`eval "$(dotweave autocomplete ${shell})"\`.`,
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

const completeCommand = buildCommand<EmptyFlags, string[], DotweaveCliContext>({
  docs: {
    brief: "Internal completion command",
  },
  func: async function (_flags, ...inputs) {
    if (_application === undefined) {
      return;
    }

    const completions = await proposeCompletions(
      _application,
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

export const buildAutocompleteRoute = () => {
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
    completeCommand,
  };
};
