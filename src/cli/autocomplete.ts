import {
  type Application,
  buildCommand,
  buildRouteMap,
  proposeCompletions,
} from "@stricli/core";

import { output } from "#app/lib/output.js";
import {
  type DevsyncCliContext,
  print,
} from "#app/services/terminal/cli-runtime.js";

const AUTOCOMPLETE_COMMAND = "devsync __complete";
const CLI_COMMAND_NAME = "devsync";
const COMPLETION_FUNCTION_NAME = "__devsync_complete";
type EmptyFlags = Record<never, never>;

const BASH_AUTOCOMPLETE_SCRIPT = `\
${COMPLETION_FUNCTION_NAME}() {
  local -a inputs
  local rawCompletions completion
  inputs=("\${COMP_WORDS[@]}")
  if [[ \${#inputs[@]} -eq 1 && \${COMP_CWORD:-0} -eq 0 && "\${inputs[0]}" == "devsync" ]]; then
    inputs+=("")
  elif [[ \${COMP_CWORD:-0} -ge \${#inputs[@]} ]]; then
    inputs+=("")
  fi
  if ! rawCompletions="$(env -u COMP_LINE ${AUTOCOMPLETE_COMMAND} "\${inputs[@]}")"; then
    return 1
  fi

  COMPREPLY=()
  if [[ -z "$rawCompletions" ]]; then
    return 0
  fi

  local IFS_TAB word desc
  IFS_TAB=$'\\t'
  local maxLen=0
  local -a words descs
  while IFS= read -r completion; do
    word="\${completion%%"$IFS_TAB"*}"
    if [[ "$completion" == *"$IFS_TAB"* ]]; then
      desc="\${completion#*"$IFS_TAB"}"
    else
      desc=""
    fi
    words+=("$word")
    descs+=("$desc")
    if (( \${#word} > maxLen )); then
      maxLen=\${#word}
    fi
  done <<< "$rawCompletions"

  if (( \${#words[@]} > 1 )); then
    local -a display
    local i
    for (( i=0; i<\${#words[@]}; i++ )); do
      if [[ -n "\${descs[i]}" ]]; then
        printf -v pad "%-\${maxLen}s" "\${words[i]}"
        display+=("$pad -- \${descs[i]}")
      else
        display+=("\${words[i]}")
      fi
    done
    printf '%s\\n' "\${display[@]}" >&2
  fi

  for word in "\${words[@]}"; do
    if [[ "$word" == */ ]]; then
      COMPREPLY+=("$word")
    else
      COMPREPLY+=("\${word} ")
    fi
  done

  return 0
}
complete -o default -o nospace -F ${COMPLETION_FUNCTION_NAME} devsync
`;

const ENSURE_FUNCTION_NAME = "__devsync_ensure_completion";

const ZSH_AUTOCOMPLETE_SCRIPT = `\
if ! (( $+functions[compdef] )); then
  autoload -Uz compinit
  compinit
fi

${COMPLETION_FUNCTION_NAME}() {
  emulate -L zsh
  local -a directories inputs plainCompletions
  local rawCompletions
  inputs=("\${words[@]}")
  if (( CURRENT == 1 && \${#inputs[@]} == 1 )) && [[ "\${inputs[1]}" == "devsync" ]]; then
    inputs+=("")
  elif (( CURRENT > \${#inputs[@]} )); then
    inputs+=("")
  fi
  if ! rawCompletions="$(env -u COMP_LINE ${AUTOCOMPLETE_COMMAND} "\${inputs[@]}")"; then
    return 1
  fi

  if [[ -z "$rawCompletions" ]]; then
    return 0
  fi

  directories=()
  plainCompletions=()
  local -a plainDisplays dirDisplays
  plainDisplays=()
  dirDisplays=()
  local IFS_TAB completion="" word desc
  IFS_TAB=$'\\t'
  for completion in "\${(@f)rawCompletions}"; do
    word="\${completion%%"$IFS_TAB"*}"
    if [[ "$completion" == *"$IFS_TAB"* ]]; then
      desc="\${completion#*"$IFS_TAB"}"
    else
      desc=""
    fi
    if [[ "$word" == */ ]]; then
      directories+=("$word")
      if [[ -n "$desc" ]]; then
        dirDisplays+=("$word -- $desc")
      else
        dirDisplays+=("$word")
      fi
    else
      plainCompletions+=("$word")
      if [[ -n "$desc" ]]; then
        plainDisplays+=("$word -- $desc")
      else
        plainDisplays+=("$word")
      fi
    fi
  done
  if (( \${#plainCompletions[@]} > 0 )); then
    compadd -Q -l -d plainDisplays -- "\${plainCompletions[@]}"
  fi
  if (( \${#directories[@]} > 0 )); then
    compadd -Q -S "" -l -d dirDisplays -- "\${directories[@]}"
  fi
}
compdef ${COMPLETION_FUNCTION_NAME} devsync

${ENSURE_FUNCTION_NAME}() {
  if (( $+functions[compdef] )) && [[ "\${_comps[devsync]}" != ${COMPLETION_FUNCTION_NAME} ]]; then
    compdef ${COMPLETION_FUNCTION_NAME} devsync
  fi
}
autoload -Uz add-zsh-hook
add-zsh-hook precmd ${ENSURE_FUNCTION_NAME}
`;

const buildAutocompleteScriptCommand = (
  shell: "bash" | "zsh",
  script: string,
) => {
  return buildCommand<EmptyFlags, [], DevsyncCliContext>({
    docs: {
      brief: `Print ${shell} autocomplete script`,
      fullDescription: `Emit a ${shell} autocomplete script for use with \`eval "$(devsync autocomplete ${shell})"\`.`,
    },
    func: () => {
      print(script);
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

      print(
        output(
          ...completions.map((c) =>
            c.brief ? `${c.completion}\t${c.brief}` : c.completion,
          ),
        ),
      );
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
