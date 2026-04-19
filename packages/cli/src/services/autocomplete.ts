import { CONSTANTS } from "#app/config/constants.ts";

const COMPLETION_FUNCTION_NAME = "__dotweave_complete";
const ENSURE_FUNCTION_NAME = "__dotweave_ensure_completion";

export const BASH_AUTOCOMPLETE_SCRIPT = `\
${COMPLETION_FUNCTION_NAME}() {
  local -a inputs
  local rawCompletions completion
  inputs=("\${COMP_WORDS[@]}")
  if [[ \${#inputs[@]} -eq 1 && \${COMP_CWORD:-0} -eq 0 && "\${inputs[0]}" == "${CONSTANTS.AUTOCOMPLETE.CLI_COMMAND_NAME}" ]]; then
    inputs+=("")
  elif [[ \${COMP_CWORD:-0} -ge \${#inputs[@]} ]]; then
    inputs+=("")
  fi
  if ! rawCompletions="$(env -u COMP_LINE ${CONSTANTS.AUTOCOMPLETE.COMMAND} "\${inputs[@]}")"; then
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
complete -o default -o nospace -F ${COMPLETION_FUNCTION_NAME} ${CONSTANTS.AUTOCOMPLETE.CLI_COMMAND_NAME}
`;

export const POWERSHELL_AUTOCOMPLETE_SCRIPT = `\
Register-ArgumentCompleter -Native -CommandName ${CONSTANTS.AUTOCOMPLETE.CLI_COMMAND_NAME} -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $inputs = $commandAst.ToString().Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries)
  if ($cursorPosition -gt $commandAst.ToString().Length) {
    $inputs += ''
  }
  $rawCompletions = & ${CONSTANTS.AUTOCOMPLETE.COMMAND.replace(" ", " ")} $inputs 2>$null
  if (-not $rawCompletions) { return }
  foreach ($line in $rawCompletions) {
    $parts = $line.Split([char]9, 2)
    $word = $parts[0]
    $desc = if ($parts.Length -gt 1) { $parts[1] } else { '' }
    $type = if ($word.EndsWith('/')) {
      [System.Management.Automation.CompletionResultType]::ParameterValue
    } else {
      [System.Management.Automation.CompletionResultType]::ParameterValue
    }
    [System.Management.Automation.CompletionResult]::new($word, $word, $type, $(if ($desc) { $desc } else { $word }))
  }
}
`;

export const ZSH_AUTOCOMPLETE_SCRIPT = `\
if ! (( $+functions[compdef] )); then
  autoload -Uz compinit
  compinit
fi

${COMPLETION_FUNCTION_NAME}() {
  emulate -L zsh
  local -a directories inputs plainCompletions
  local rawCompletions
  inputs=("\${words[@]}")
  if (( CURRENT == 1 && \${#inputs[@]} == 1 )) && [[ "\${inputs[1]}" == "${CONSTANTS.AUTOCOMPLETE.CLI_COMMAND_NAME}" ]]; then
    inputs+=("")
  elif (( CURRENT > \${#inputs[@]} )); then
    inputs+=("")
  fi
  if ! rawCompletions="$(env -u COMP_LINE ${CONSTANTS.AUTOCOMPLETE.COMMAND} "\${inputs[@]}")"; then
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
compdef ${COMPLETION_FUNCTION_NAME} ${CONSTANTS.AUTOCOMPLETE.CLI_COMMAND_NAME}

${ENSURE_FUNCTION_NAME}() {
  if (( $+functions[compdef] )) && [[ "\${_comps[${CONSTANTS.AUTOCOMPLETE.CLI_COMMAND_NAME}]}" != ${COMPLETION_FUNCTION_NAME} ]]; then
    compdef ${COMPLETION_FUNCTION_NAME} ${CONSTANTS.AUTOCOMPLETE.CLI_COMMAND_NAME}
  fi
}
autoload -Uz add-zsh-hook
add-zsh-hook precmd ${ENSURE_FUNCTION_NAME}
`;

const isCliCommandToken = (input: string) => {
  const normalizedInput = input.replace(/\\/gu, "/").split("/").pop() ?? input;

  return (
    normalizedInput === CONSTANTS.AUTOCOMPLETE.CLI_COMMAND_NAME ||
    normalizedInput === `${CONSTANTS.AUTOCOMPLETE.CLI_COMMAND_NAME}.exe`
  );
};

const normalizeCompletionInputs = (inputs: readonly string[]) => {
  const firstInput = inputs[0];

  if (firstInput === undefined || !isCliCommandToken(firstInput)) {
    return [...inputs];
  }

  return inputs.slice(1);
};

export const resolveCompletionInputs = (inputs: readonly string[]) => {
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
