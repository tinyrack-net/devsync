import type { Command } from "commander";

export type Shell = "bash" | "zsh";

export const SUPPORTED_SHELLS: readonly Shell[] = ["bash", "zsh"] as const;

export function isSupportedShell(value: string): value is Shell {
  return (SUPPORTED_SHELLS as readonly string[]).includes(value);
}

/**
 * Collect the full command tree from a Commander program into a flat map.
 * Each key is a space-joined command path (e.g. "web search") and the value
 * contains its subcommand names/descriptions and option flags/descriptions.
 */
export interface CompletionItem {
  name: string;
  description: string;
}

export interface CommandInfo {
  subcommands: CompletionItem[];
  options: CompletionItem[];
}

export function collectCommands(
  program: Command,
  prefix: string[] = [],
): Map<string, CommandInfo> {
  const result = new Map<string, CommandInfo>();
  const key = prefix.join(" ") || "__root__";

  const subcommands: CompletionItem[] = program.commands.map((c) => ({
    name: c.name(),
    description: c.description(),
  }));

  const options: CompletionItem[] = program.options
    .map((o) => ({
      name: o.long ?? o.short ?? "",
      description: o.description,
    }))
    .filter((o) => o.name.length > 0);

  result.set(key, { subcommands, options });

  for (const sub of program.commands) {
    const nested = collectCommands(sub, [...prefix, sub.name()]);
    for (const [k, v] of nested) {
      result.set(k, v);
    }
  }

  return result;
}

function allItems(info: CommandInfo): CompletionItem[] {
  return [...info.subcommands, ...info.options];
}

export function generateBashCompletion(
  programName: string,
  commands: Map<string, CommandInfo>,
): string {
  const cases: string[] = [];

  for (const [path, info] of commands) {
    const items = allItems(info);
    if (items.length === 0) continue;

    const words = items.map((i) => i.name).join(" ");
    const key = path === "__root__" ? "" : path;
    cases.push(
      `            "${key}")\n                words="${words}"\n                break\n                ;;`,
    );
  }

  return `# bash completion for ${programName}
# eval "$(${programName} completion bash)"

_${programName}_completion() {
    local cur prev words cword
    _init_completion || return

    # Collect non-flag words into an array (skip program name at index 0)
    local -a parts=()
    local i
    for (( i=1; i < cword; i++ )); do
        [[ "\${words[i]}" == -* ]] && continue
        parts+=("\${words[i]}")
    done

    # Try the full path, then progressively shorten until a case matches
    local words=""
    local n=\${#parts[@]}
    while true; do
        local cmd_path="\${parts[*]:0:n}"
        case "$cmd_path" in
${cases.join("\n")}
            *)
                if (( n <= 0 )); then break; fi
                (( n-- ))
                continue
                ;;
        esac
    done

    COMPREPLY=( $(compgen -W "$words" -- "$cur") )
    return 0
}

complete -F _${programName}_completion ${programName}
`;
}

/**
 * Escape a string for use in zsh _describe specs.
 *
 * _describe uses the format 'name:description' so literal colons in either
 * field must be escaped as \\: and backslashes as \\\\.  Single quotes inside
 * the single-quoted spec also need shell escaping.
 */
function zshDescribeEscape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "'\\''");
}

/** Build a zsh _describe spec array literal from CompletionItem[]. */
function zshDescribeSpecs(items: CompletionItem[]): string {
  return items
    .map((i) => {
      const name = zshDescribeEscape(i.name);
      const desc = i.description ? zshDescribeEscape(i.description) : name;
      return `'${name}:${desc}'`;
    })
    .join(" ");
}

export function generateZshCompletion(
  programName: string,
  commands: Map<string, CommandInfo>,
): string {
  const cases: string[] = [];

  for (const [path, info] of commands) {
    if (info.subcommands.length === 0 && info.options.length === 0) continue;

    const lines: string[] = [];
    const key = path === "__root__" ? "" : path;
    lines.push(`            "${key}")`);

    if (info.subcommands.length > 0) {
      lines.push(
        `                _subcmds=(${zshDescribeSpecs(info.subcommands)})`,
      );
    }
    if (info.options.length > 0) {
      lines.push(`                _opts=(${zshDescribeSpecs(info.options)})`);
    }

    lines.push("                break");
    lines.push("                ;;");
    cases.push(lines.join("\n"));
  }

  return `#compdef ${programName}
# zsh completion for ${programName}
# eval "$(${programName} completion zsh)"

_${programName}() {
    local i w

    # Collect non-flag words into an array (skip element 1 which is the program)
    local -a parts=()
    for (( i=2; i < CURRENT; i++ )); do
        w="\${words[i]}"
        [[ "$w" == -* ]] && continue
        parts+=("$w")
    done

    # Try the full path, then progressively shorten until a case matches
    local -a _subcmds _opts
    local n=\${#parts}
    while true; do
        local cmd_path="\${(j: :)parts[1,n]}"
        case "$cmd_path" in
${cases.join("\n")}
            *)
                if (( n <= 0 )); then break; fi
                (( n-- ))
                continue
                ;;
        esac
    done

    local _ret=1
    (( \${#_subcmds} )) && _describe -t commands 'command' _subcmds && _ret=0
    (( \${#_opts} ))    && _describe -t options 'option' _opts     && _ret=0
    return $_ret
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
  parent
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
}

export class CompletionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompletionError";
  }
}
