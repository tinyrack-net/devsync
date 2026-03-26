import {
  type Application,
  buildCommand,
  buildRouteMap,
  proposeCompletions,
} from "@stricli/core";

import { type DevsyncCliContext, print } from "#app/cli/common.js";
import { output } from "#app/lib/output.js";

const AUTOCOMPLETE_COMMAND = "devsync __complete";
const CLI_COMMAND_NAME = "devsync";
const COMPLETION_FUNCTION_NAME = "__devsync_complete";
type EmptyFlags = Record<never, never>;

const buildBashAutocompleteScript = () => {
  return [
    `${COMPLETION_FUNCTION_NAME}() {`,
    "  local -a inputs",
    "  local rawCompletions completion",
    '  inputs=("${COMP_WORDS[@]}")',
    "  if [[ ${COMP_CWORD:-0} -ge ${#inputs[@]} ]]; then",
    '    inputs+=("")',
    "  fi",
    `  if ! rawCompletions="$(env -u COMP_LINE ${AUTOCOMPLETE_COMMAND} "\${inputs[@]}")"; then`,
    "    return 1",
    "  fi",
    "",
    "  COMPREPLY=()",
    '  if [[ -z "$rawCompletions" ]]; then',
    "    return 0",
    "  fi",
    "",
    "  while IFS= read -r completion; do",
    '    COMPREPLY+=("$completion")',
    '  done <<< "$rawCompletions"',
    "",
    "  return 0",
    "}",
    `complete -o default -o nospace -F ${COMPLETION_FUNCTION_NAME} devsync`,
  ];
};

const buildZshAutocompleteScript = () => {
  return [
    "if ! (( $+functions[compdef] )); then",
    "  autoload -Uz compinit",
    "  compinit",
    "fi",
    "",
    `${COMPLETION_FUNCTION_NAME}() {`,
    "  emulate -L zsh",
    "  local -a inputs completions",
    "  local rawCompletions",
    '  inputs=("${words[@]}")',
    "  if (( CURRENT > ${#inputs[@]} )); then",
    '    inputs+=("")',
    "  fi",
    `  if ! rawCompletions="$(env -u COMP_LINE ${AUTOCOMPLETE_COMMAND} "\${inputs[@]}")"; then`,
    "    return 1",
    "  fi",
    "",
    '  if [[ -z "$rawCompletions" ]]; then',
    "    return 0",
    "  fi",
    "",
    '  completions=("${(@f)rawCompletions}")',
    '  compadd -Q -S "" -- "${completions[@]}"',
    "}",
    `compdef ${COMPLETION_FUNCTION_NAME} devsync`,
  ];
};

const buildAutocompleteScriptCommand = (
  shell: "bash" | "zsh",
  buildScript: () => readonly string[],
) => {
  return buildCommand<EmptyFlags, [], DevsyncCliContext>({
    docs: {
      brief: `Print ${shell} autocomplete script`,
      fullDescription: `Emit a ${shell} autocomplete script for use with \`eval "$(devsync autocomplete ${shell})"\`.`,
    },
    func: () => {
      print(output(...buildScript()));
    },
    parameters: {},
  });
};

const bashAutocompleteCommand = buildAutocompleteScriptCommand(
  "bash",
  buildBashAutocompleteScript,
);
const zshAutocompleteCommand = buildAutocompleteScriptCommand(
  "zsh",
  buildZshAutocompleteScript,
);

const isCliCommandToken = (input: string) => {
  const normalizedInput = input.replace(/\\/gu, "/").split("/").pop() ?? input;

  return (
    normalizedInput === CLI_COMMAND_NAME ||
    normalizedInput === `${CLI_COMMAND_NAME}.exe`
  );
};

const normalizeCompletionInputs = (inputs: readonly string[]) => {
  const firstInput = inputs[0];

  if (firstInput === undefined || !isCliCommandToken(firstInput)) {
    return [...inputs];
  }

  return inputs.slice(1);
};

const resolveCompletionInputs = (inputs: readonly string[]) => {
  const environment: NodeJS.ProcessEnv & { COMP_LINE?: string } = process.env;
  const completionLine = environment.COMP_LINE;

  if (completionLine === undefined) {
    return normalizeCompletionInputs(inputs);
  }

  const trimmedStart = completionLine.trimStart();

  if (trimmedStart === "") {
    return [];
  }

  const completionInputs = trimmedStart.split(/\s+/u);

  if (/\s$/u.test(completionLine)) {
    completionInputs.push("");
  }

  return normalizeCompletionInputs(completionInputs);
};

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
        brief: "Print shell autocomplete scripts",
        fullDescription:
          "Emit shell-specific autocomplete scripts for use with eval-based shell setup.",
      },
      routes: {
        bash: bashAutocompleteCommand,
        zsh: zshAutocompleteCommand,
      },
    }),
    completeCommand: buildCompleteCommand(getApplication),
  };
};
