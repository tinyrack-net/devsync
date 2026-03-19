import type { Command, Option } from "commander";

export type Shell = "bash" | "zsh";

export const SUPPORTED_SHELLS: readonly Shell[] = ["bash", "zsh"] as const;

export function isSupportedShell(value: string): value is Shell {
  return (SUPPORTED_SHELLS as readonly string[]).includes(value);
}

export interface CompletionItem {
  name: string;
  description: string;
}

export interface CompletionArgumentInfo {
  name: string;
  description: string;
  required: boolean;
  variadic: boolean;
  choices: CompletionItem[];
}

export interface CompletionOptionInfo {
  name: string;
  description: string;
  flags: string[];
  takesValue: boolean;
  valueName: string | undefined;
  valueChoices: CompletionItem[];
}

/**
 * Collect the full command tree from a Commander program into a flat map.
 * Each key is a space-joined command path (e.g. "web search") and the value
 * contains its subcommand names/descriptions, option flags/descriptions, and
 * positional-argument metadata.
 */
export interface CommandInfo {
  subcommands: CompletionItem[];
  options: CompletionItem[];
  arguments: CompletionArgumentInfo[];
  optionDetails: CompletionOptionInfo[];
}

type CompletionChoiceSource = readonly string[] | readonly CompletionItem[];

type CompletionContext = Readonly<{
  path: string[];
  consumedArguments: number;
  pendingOption: CompletionOptionInfo | undefined;
  stopOptions: boolean;
}>;

type AttachedOptionValueMatch = Readonly<{
  option: CompletionOptionInfo;
  flag: string;
  token: string;
  value: string;
}>;

const completionChoices = new WeakMap<object, readonly CompletionItem[]>();

const completionRootKey = "__root__";

const META_OPTION_NAMES: ReadonlySet<string> = new Set([
  "--help",
  "-h",
  "--version",
  "-v",
]);

const sortCompletionSubcommands = <T extends { name: string }>(
  items: readonly T[],
): T[] => {
  return items.toSorted((a, b) => a.name.localeCompare(b.name));
};

const sortCompletionOptions = <T extends { name: string }>(
  items: readonly T[],
): T[] => {
  return items.toSorted((a, b) => {
    const aIsMeta = META_OPTION_NAMES.has(a.name);
    const bIsMeta = META_OPTION_NAMES.has(b.name);

    if (aIsMeta !== bIsMeta) {
      return aIsMeta ? 1 : -1;
    }

    return a.name.localeCompare(b.name);
  });
};

const normalizeCompletionItems = (
  choices: CompletionChoiceSource,
): CompletionItem[] => {
  return choices.map((choice) => {
    if (typeof choice === "string") {
      return {
        name: choice,
        description: "",
      } satisfies CompletionItem;
    }

    return {
      name: choice.name,
      description: choice.description,
    } satisfies CompletionItem;
  });
};

const getCompletionChoices = (target: object): CompletionItem[] => {
  return [...(completionChoices.get(target) ?? [])];
};

const isVisibleCommand = (command: Command) => {
  return Reflect.get(command, "_hidden") !== true;
};

const isVisibleOption = (option: Option) => {
  return option.hidden !== true;
};

const readOptionValueName = (flags: string) => {
  const match = /<([^>]+)>|\[([^\]]+)\]/u.exec(flags);
  return match?.[1] ?? match?.[2];
};

const commandKey = (path: readonly string[]) => {
  return path.join(" ") || completionRootKey;
};

const getCommandInfo = (
  commands: ReadonlyMap<string, CommandInfo>,
  path: readonly string[],
) => {
  return commands.get(commandKey(path)) ?? commands.get(completionRootKey);
};

const getArgumentAt = (
  argumentsInfo: readonly CompletionArgumentInfo[],
  index: number,
) => {
  const directArgument = argumentsInfo[index];

  if (directArgument !== undefined) {
    return directArgument;
  }

  const lastArgument = argumentsInfo.at(-1);

  if (lastArgument?.variadic === true) {
    return lastArgument;
  }

  return undefined;
};

const filterItemsByPrefix = (
  items: readonly CompletionItem[],
  prefix: string,
) => {
  if (prefix === "") {
    return [...items];
  }

  return items.filter((item) => {
    return item.name.startsWith(prefix);
  });
};

const dedupeItems = (items: readonly CompletionItem[]) => {
  const uniqueItems = new Map<string, CompletionItem>();

  for (const item of items) {
    if (!uniqueItems.has(item.name)) {
      uniqueItems.set(item.name, item);
    }
  }

  return [...uniqueItems.values()];
};

const findOptionByToken = (
  options: readonly CompletionOptionInfo[],
  token: string,
) => {
  return options.find((option) => {
    return option.flags.includes(token);
  });
};

const matchAttachedOptionValue = (
  options: readonly CompletionOptionInfo[],
  token: string,
) => {
  for (const option of options) {
    if (!option.takesValue) {
      continue;
    }

    const longFlag = option.flags.find((flag) => {
      return flag.startsWith("--");
    });

    if (longFlag !== undefined && token.startsWith(`${longFlag}=`)) {
      return {
        option,
        flag: longFlag,
        token,
        value: token.slice(longFlag.length + 1),
      } satisfies AttachedOptionValueMatch;
    }
  }

  return undefined;
};

const zshPlaceholderItem = (
  name: string,
  description: string,
): CompletionItem => {
  return {
    name,
    description: description === "" ? name : description,
  };
};

const getFreeFormArgumentSuggestions = (
  shell: Shell,
  argument: CompletionArgumentInfo,
  currentToken: string,
) => {
  if (shell !== "zsh") {
    return [];
  }

  return filterItemsByPrefix(
    [zshPlaceholderItem(argument.name, argument.description)],
    currentToken,
  );
};

const getFreeFormOptionValueSuggestions = (
  shell: Shell,
  option: CompletionOptionInfo,
  currentToken: string,
) => {
  if (shell !== "zsh") {
    return [];
  }

  const valueName = option.valueName ?? "value";

  return filterItemsByPrefix(
    [zshPlaceholderItem(valueName, option.description)],
    currentToken,
  );
};

const resolvePendingOptionValueSuggestions = (
  shell: Shell,
  option: CompletionOptionInfo,
  currentToken: string,
) => {
  if (option.valueChoices.length > 0) {
    return filterItemsByPrefix(option.valueChoices, currentToken);
  }

  return getFreeFormOptionValueSuggestions(shell, option, currentToken);
};

const resolveAttachedOptionValueSuggestions = (
  shell: Shell,
  match: AttachedOptionValueMatch,
) => {
  if (match.option.valueChoices.length > 0) {
    return filterItemsByPrefix(
      match.option.valueChoices.map((item) => {
        return {
          name: `${match.flag}=${item.name}`,
          description: item.description,
        } satisfies CompletionItem;
      }),
      match.token,
    );
  }

  if (shell !== "zsh") {
    return [];
  }

  const valueName = match.option.valueName ?? "value";

  return filterItemsByPrefix(
    [
      {
        name: `${match.flag}=<${valueName}>`,
        description:
          match.option.description === ""
            ? valueName
            : match.option.description,
      } satisfies CompletionItem,
    ],
    match.token,
  );
};

const resolveCurrentOptionSuggestions = (
  shell: Shell,
  info: CommandInfo,
  currentToken: string,
) => {
  const attachedValueMatch = matchAttachedOptionValue(
    info.optionDetails,
    currentToken,
  );

  if (attachedValueMatch !== undefined) {
    return resolveAttachedOptionValueSuggestions(shell, attachedValueMatch);
  }

  const exactOption = findOptionByToken(info.optionDetails, currentToken);

  if (exactOption?.takesValue === true) {
    const replacementPrefix =
      exactOption.flags.find((flag) => {
        return flag.startsWith("--");
      }) ?? currentToken;

    if (exactOption.valueChoices.length > 0) {
      return exactOption.valueChoices.map((item) => {
        return {
          name: `${replacementPrefix}=${item.name}`,
          description: item.description,
        } satisfies CompletionItem;
      });
    }

    if (shell !== "zsh") {
      return [];
    }

    const valueName = exactOption.valueName ?? "value";

    return [
      {
        name: `${replacementPrefix}=<${valueName}>`,
        description:
          exactOption.description === "" ? valueName : exactOption.description,
      } satisfies CompletionItem,
    ];
  }

  return filterItemsByPrefix(info.options, currentToken);
};

const resolveCurrentArgumentSuggestions = (
  shell: Shell,
  info: CommandInfo,
  currentToken: string,
  argument: CompletionArgumentInfo,
) => {
  if (argument.choices.length > 0) {
    const choices = filterItemsByPrefix(argument.choices, currentToken);

    if (currentToken === "") {
      return dedupeItems([...choices, ...info.options]);
    }

    return choices;
  }

  const placeholderItems = getFreeFormArgumentSuggestions(
    shell,
    argument,
    currentToken,
  );

  if (currentToken === "") {
    return dedupeItems([...placeholderItems, ...info.options]);
  }

  return placeholderItems;
};

const resolveCurrentTokenSuggestions = (
  shell: Shell,
  commands: ReadonlyMap<string, CommandInfo>,
  context: CompletionContext,
  currentToken: string,
) => {
  const info = getCommandInfo(commands, context.path);

  if (info === undefined) {
    return [];
  }

  if (context.pendingOption !== undefined) {
    return resolvePendingOptionValueSuggestions(
      shell,
      context.pendingOption,
      currentToken,
    );
  }

  if (currentToken.startsWith("-")) {
    return resolveCurrentOptionSuggestions(shell, info, currentToken);
  }

  if (context.consumedArguments === 0 && info.subcommands.length > 0) {
    const subcommands = filterItemsByPrefix(info.subcommands, currentToken);

    if (currentToken === "") {
      return dedupeItems([...subcommands, ...info.options]);
    }

    return subcommands;
  }

  const nextArgument = getArgumentAt(info.arguments, context.consumedArguments);

  if (nextArgument !== undefined) {
    return resolveCurrentArgumentSuggestions(
      shell,
      info,
      currentToken,
      nextArgument,
    );
  }

  if (currentToken === "") {
    return [...info.options];
  }

  return [];
};

const parseCompletionContext = (
  commands: ReadonlyMap<string, CommandInfo>,
  wordsBeforeCurrent: readonly string[],
): CompletionContext => {
  let context: CompletionContext = {
    path: [],
    consumedArguments: 0,
    pendingOption: undefined,
    stopOptions: false,
  };

  for (const token of wordsBeforeCurrent) {
    const info = getCommandInfo(commands, context.path);

    if (info === undefined) {
      break;
    }

    if (context.pendingOption !== undefined) {
      context = {
        ...context,
        pendingOption: undefined,
      };
      continue;
    }

    if (!context.stopOptions && token === "--") {
      context = {
        ...context,
        stopOptions: true,
      };
      continue;
    }

    if (!context.stopOptions) {
      const attachedValueMatch = matchAttachedOptionValue(
        info.optionDetails,
        token,
      );

      if (attachedValueMatch !== undefined) {
        continue;
      }

      const matchedOption = findOptionByToken(info.optionDetails, token);

      if (matchedOption !== undefined) {
        context = {
          ...context,
          pendingOption: matchedOption.takesValue ? matchedOption : undefined,
        };
        continue;
      }

      if (token.startsWith("-")) {
        continue;
      }
    }

    if (!context.stopOptions && context.consumedArguments === 0) {
      const matchedSubcommand = info.subcommands.find((item) => {
        return item.name === token;
      });

      if (matchedSubcommand !== undefined) {
        context = {
          path: [...context.path, token],
          consumedArguments: 0,
          pendingOption: undefined,
          stopOptions: false,
        };
        continue;
      }

      if (info.subcommands.length > 0 && info.arguments.length === 0) {
        break;
      }
    }

    const nextArgument = getArgumentAt(
      info.arguments,
      context.consumedArguments,
    );

    if (nextArgument !== undefined) {
      context = {
        ...context,
        consumedArguments: nextArgument.variadic
          ? context.consumedArguments
          : context.consumedArguments + 1,
      };
      continue;
    }

    if (info.subcommands.length > 0 && context.consumedArguments === 0) {
      break;
    }
  }

  return context;
};

const normalizeCompletionRequest = (
  words: readonly string[],
  currentWordIndex: number,
) => {
  if (currentWordIndex < words.length) {
    return {
      words: [...words],
      currentWordIndex,
    };
  }

  return {
    words: [...words, ""],
    currentWordIndex: words.length,
  };
};

const sanitizeCompletionField = (value: string) => {
  return value.replace(/[\r\n\t]+/gu, " ").trim();
};

const formatCompletionOutput = (items: readonly CompletionItem[]) => {
  return items
    .map((item) => {
      return `${sanitizeCompletionField(item.name)}\t${sanitizeCompletionField(item.description)}`;
    })
    .join("\n")
    .concat(items.length > 0 ? "\n" : "");
};

export function setArgumentCompletionChoices(
  command: Command,
  argumentName: string,
  choices: CompletionChoiceSource,
): void {
  const argument = command.registeredArguments.find((candidate) => {
    return candidate.name() === argumentName;
  });

  if (argument === undefined) {
    throw new Error(`Unknown completion argument: ${argumentName}`);
  }

  completionChoices.set(argument, normalizeCompletionItems(choices));
}

export function setOptionCompletionChoices(
  command: Command,
  optionFlag: string,
  choices: CompletionChoiceSource,
): void {
  const option = command.options.find((candidate) => {
    return (
      candidate.long === optionFlag ||
      candidate.short === optionFlag ||
      candidate.attributeName() === optionFlag
    );
  });

  if (option === undefined) {
    throw new Error(`Unknown completion option: ${optionFlag}`);
  }

  completionChoices.set(option, normalizeCompletionItems(choices));
}

export function collectCommands(
  program: Command,
  prefix: string[] = [],
): Map<string, CommandInfo> {
  const result = new Map<string, CommandInfo>();
  const key = commandKey(prefix);

  const visibleSubcommands = program.commands.filter(isVisibleCommand);
  const subcommands = visibleSubcommands.map((command) => {
    return {
      name: command.name(),
      description: command.description(),
    } satisfies CompletionItem;
  });

  const optionDetails = program.options
    .filter(isVisibleOption)
    .map((option) => {
      return {
        name: option.long ?? option.short ?? "",
        description: option.description,
        flags: [option.short, option.long].filter((flag): flag is string => {
          return flag !== undefined;
        }),
        takesValue: option.required || option.optional,
        valueName: readOptionValueName(option.flags),
        valueChoices: getCompletionChoices(option),
      } satisfies CompletionOptionInfo;
    })
    .filter((option) => {
      return option.name.length > 0;
    });

  const argumentsInfo = program.registeredArguments.map((argument) => {
    return {
      name: argument.name(),
      description: argument.description ?? "",
      required: argument.required,
      variadic: argument.variadic,
      choices: getCompletionChoices(argument),
    } satisfies CompletionArgumentInfo;
  });

  const sortedSubcommands = sortCompletionSubcommands(subcommands);
  const sortedOptionDetails = sortCompletionOptions(optionDetails);

  result.set(key, {
    subcommands: sortedSubcommands,
    options: sortedOptionDetails.map((option) => {
      return {
        name: option.name,
        description: option.description,
      } satisfies CompletionItem;
    }),
    arguments: argumentsInfo,
    optionDetails: sortedOptionDetails,
  });

  for (const subcommand of visibleSubcommands) {
    const nestedCommands = collectCommands(subcommand, [
      ...prefix,
      subcommand.name(),
    ]);

    for (const [nestedKey, info] of nestedCommands) {
      result.set(nestedKey, info);
    }
  }

  return result;
}

export function resolveCompletionItems(
  shell: Shell,
  program: Command,
  words: readonly string[],
  currentWordIndex: number,
): CompletionItem[] {
  const normalizedRequest = normalizeCompletionRequest(words, currentWordIndex);
  const commands = collectCommands(program);
  const context = parseCompletionContext(
    commands,
    normalizedRequest.words.slice(1, normalizedRequest.currentWordIndex),
  );

  return dedupeItems(
    resolveCurrentTokenSuggestions(
      shell,
      commands,
      context,
      normalizedRequest.words[normalizedRequest.currentWordIndex] ?? "",
    ),
  );
}

export function generateBashCompletion(
  programName: string,
  _commands: Map<string, CommandInfo>,
): string {
  return `# bash completion for ${programName}
# eval "$(${programName} completion bash)"

_${programName}_completion() {
    local cur prev words cword
    _init_completion || return

    COMPREPLY=()
    local name
    while IFS=$'\\t' read -r name _; do
        [[ -n "$name" ]] && COMPREPLY+=("$name")
    done < <(${programName} __complete bash "$cword" -- "\${words[@]}" 2>/dev/null)

    return 0
}

complete -F _${programName}_completion ${programName}
`;
}

export function generateZshCompletion(
  programName: string,
  _commands: Map<string, CommandInfo>,
): string {
  return `#compdef ${programName}
# zsh completion for ${programName}
# eval "$(${programName} completion zsh)"

_${programName}() {
    local output
    output="$(${programName} __complete zsh "$((CURRENT - 1))" -- "\${words[@]}" 2>/dev/null)" || return 1

    local -a arg_completions opt_completions
    arg_completions=()
    opt_completions=()

    if [[ -n "$output" ]]; then
        local -a lines
        local line name desc
        lines=("\${(@f)output}")

        for line in "\${lines[@]}"; do
            name="\${line%%$'\\t'*}"
            if [[ "$line" == *$'\\t'* ]]; then
                desc="\${line#*$'\\t'}"
            else
                desc="$name"
            fi

            name="\${name//\\\\/\\\\\\\\}"
            name="\${name//:/\\\\:}"
            desc="\${desc//\\\\/\\\\\\\\}"
            desc="\${desc//:/\\\\:}"

            if [[ "$name" == -* ]]; then
                opt_completions+=("$name:$desc")
            else
                arg_completions+=("$name:$desc")
            fi
        done
    fi

    (( \${#arg_completions} )) || (( \${#opt_completions} )) || return 1
    (( \${#arg_completions} )) && _describe -V 'argument' arg_completions
    (( \${#opt_completions} )) && _describe -V 'option' opt_completions
    return 0
}

compdef _${programName} ${programName}
`;
}

export function generateCompletion(
  shell: Shell,
  programName: string,
  program: Command,
): string {
  const commands = collectCommands(program);

  switch (shell) {
    case "bash":
      return generateBashCompletion(programName, commands);
    case "zsh":
      return generateZshCompletion(programName, commands);
  }
}

export function registerCompletionCommand(
  parent: Command,
  io: { stdout: (text: string) => void },
  program: Command,
): void {
  const completionCommand = parent
    .command("completion")
    .description("Generate shell completion script")
    .argument("<shell>", `Shell type: ${SUPPORTED_SHELLS.join(", ")}`)
    .action((shell: string) => {
      if (!isSupportedShell(shell)) {
        throw new CompletionError(
          `Unsupported shell: ${shell}. Supported shells: ${SUPPORTED_SHELLS.join(", ")}`,
        );
      }

      const programName = program.name();
      const output = generateCompletion(shell, programName, program);
      io.stdout(output);
    });

  setArgumentCompletionChoices(completionCommand, "shell", [
    ...SUPPORTED_SHELLS,
  ]);

  parent
    .command("__complete", { hidden: true })
    .argument("<shell>", "Shell type")
    .argument("<current-word-index>", "Index of the current word")
    .argument("[words...]", "Shell words")
    .action((shell: string, currentWordIndex: string, words: string[]) => {
      if (!isSupportedShell(shell)) {
        throw new CompletionError(
          `Unsupported shell: ${shell}. Supported shells: ${SUPPORTED_SHELLS.join(", ")}`,
        );
      }

      const parsedCurrentWordIndex = Number.parseInt(currentWordIndex, 10);

      if (
        !Number.isInteger(parsedCurrentWordIndex) ||
        parsedCurrentWordIndex < 0
      ) {
        throw new CompletionError(
          `Invalid current word index: ${currentWordIndex}`,
        );
      }

      const items = resolveCompletionItems(
        shell,
        program,
        words,
        parsedCurrentWordIndex,
      );

      io.stdout(formatCompletionOutput(items));
    });
}

export class CompletionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompletionError";
  }
}
