import type { ApplicationContext } from "@stricli/core";
import {
  type Application,
  buildCommand,
  buildRouteMap,
  proposeCompletions,
} from "@stricli/core";
import {
  BASH_AUTOCOMPLETE_SCRIPT,
  FISH_AUTOCOMPLETE_SCRIPT,
  POWERSHELL_AUTOCOMPLETE_SCRIPT,
  resolveCompletionInputs,
  ZSH_AUTOCOMPLETE_SCRIPT,
} from "#app/services/autocomplete.ts";
import type { NoFlags } from "./shared-flags.ts";

let _application: Application<ApplicationContext> | undefined;

export const setApplication = (app: Application<ApplicationContext>) => {
  _application = app;
};

const buildAutocompleteScriptCommand = (
  shell: "bash" | "zsh" | "fish" | "powershell",
  script: string,
) => {
  return buildCommand<NoFlags, [], ApplicationContext>({
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
const fishAutocompleteCommand = buildAutocompleteScriptCommand(
  "fish",
  FISH_AUTOCOMPLETE_SCRIPT,
);
const powershellAutocompleteCommand = buildAutocompleteScriptCommand(
  "powershell",
  POWERSHELL_AUTOCOMPLETE_SCRIPT,
);

const completeCommand = buildCommand<NoFlags, string[], ApplicationContext>({
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
        fish: fishAutocompleteCommand,
        powershell: powershellAutocompleteCommand,
        zsh: zshAutocompleteCommand,
      },
    }),
    completeCommand,
  };
};
