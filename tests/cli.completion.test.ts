import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Command } from "commander";
import { execa } from "execa";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  collectCommands,
  generateBashCompletion,
  generateCompletion,
  generateZshCompletion,
  isSupportedShell,
  resolveCompletionItems,
  type Shell,
  SUPPORTED_SHELLS,
  setArgumentCompletionChoices,
  setOptionCompletionChoices,
} from "#app/cli/completion.ts";
import { runCli } from "#app/cli/index.ts";

const cliPath = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const cliShim = `devtools() { ${JSON.stringify(process.execPath)} ${JSON.stringify(cliPath)} "$@"; }`;

function createTestProgram(): Command {
  const program = new Command();
  program.name("test-cli").version("1.0.0");

  const web = program.command("web").description("Web utilities");
  web
    .command("search")
    .description("Search the web")
    .argument("<query>", "Search query")
    .option("-l, --limit <number>", "Limit results")
    .option("--json", "JSON output");
  const fetchCommand = web
    .command("fetch")
    .description("Fetch a page")
    .argument("<url>", "Page URL")
    .option("-f, --format <format>", "Output format");
  setOptionCompletionChoices(fetchCommand, "--format", ["text", "json"]);

  program
    .command("install")
    .description("Install resources")
    .argument("<name>");

  const completionCommand = program
    .command("completion")
    .description("Generate shell completion script")
    .argument("<shell>", "Shell type");
  setArgumentCompletionChoices(completionCommand, "shell", SUPPORTED_SHELLS);

  return program;
}

// ---------------------------------------------------------------------------
// Unit tests – pure functions, no shell processes
// ---------------------------------------------------------------------------

describe("isSupportedShell", () => {
  it("returns true for bash", () => {
    expect(isSupportedShell("bash")).toBe(true);
  });

  it("returns true for zsh", () => {
    expect(isSupportedShell("zsh")).toBe(true);
  });

  it("returns false for unsupported shells", () => {
    expect(isSupportedShell("fish")).toBe(false);
    expect(isSupportedShell("")).toBe(false);
    expect(isSupportedShell("powershell")).toBe(false);
  });
});

describe("SUPPORTED_SHELLS", () => {
  it("contains bash and zsh", () => {
    expect(SUPPORTED_SHELLS).toContain("bash");
    expect(SUPPORTED_SHELLS).toContain("zsh");
  });
});

describe("collectCommands", () => {
  it("collects the root program commands and options", () => {
    const program = createTestProgram();
    const commands = collectCommands(program);

    const root = commands.get("__root__");
    expect(root).toBeDefined();
    const subNames = root?.subcommands.map((s) => s.name);
    expect(subNames).toContain("web");
    expect(subNames).toContain("install");
  });

  it("collects descriptions for subcommands", () => {
    const program = createTestProgram();
    const commands = collectCommands(program);

    const root = commands.get("__root__");
    const web = root?.subcommands.find((s) => s.name === "web");
    expect(web?.description).toBe("Web utilities");
  });

  it("collects nested subcommands", () => {
    const program = createTestProgram();
    const commands = collectCommands(program);

    const web = commands.get("web");
    expect(web).toBeDefined();
    const subNames = web?.subcommands.map((s) => s.name);
    expect(subNames).toContain("search");
    expect(subNames).toContain("fetch");
  });

  it("collects options with descriptions for leaf commands", () => {
    const program = createTestProgram();
    const commands = collectCommands(program);

    const search = commands.get("web search");
    expect(search).toBeDefined();
    const optNames = search?.options.map((o) => o.name);
    expect(optNames).toContain("--limit");
    expect(optNames).toContain("--json");
    expect(search?.subcommands).toEqual([]);

    const limitOpt = search?.options.find((o) => o.name === "--limit");
    expect(limitOpt?.description).toBe("Limit results");
  });

  it("collects options for fetch command", () => {
    const program = createTestProgram();
    const commands = collectCommands(program);

    const fetchCmd = commands.get("web fetch");
    expect(fetchCmd).toBeDefined();
    const optNames = fetchCmd?.options.map((o) => o.name);
    expect(optNames).toContain("--format");
  });

  it("collects positional arguments for leaf commands", () => {
    const program = createTestProgram();
    const commands = collectCommands(program);

    const search = commands.get("web search");
    expect(search?.arguments).toEqual([
      {
        name: "query",
        description: "Search query",
        required: true,
        variadic: false,
        choices: [],
      },
    ]);
  });

  it("collects completion choices for option values", () => {
    const program = createTestProgram();
    const commands = collectCommands(program);

    const fetch = commands.get("web fetch");
    const formatOption = fetch?.optionDetails.find(
      (o) => o.name === "--format",
    );

    expect(formatOption?.valueChoices.map((item) => item.name)).toEqual([
      "text",
      "json",
    ]);
  });
});

describe("generateBashCompletion", () => {
  it("generates valid bash completion script", () => {
    const program = createTestProgram();
    const commands = collectCommands(program);
    const output = generateBashCompletion("test-cli", commands);

    expect(output).toContain("# bash completion for test-cli");
    expect(output).toContain("_test-cli_completion()");
    expect(output).toContain("complete -F _test-cli_completion test-cli");
  });
});

describe("generateZshCompletion", () => {
  it("generates valid zsh completion script with descriptions", () => {
    const program = createTestProgram();
    const commands = collectCommands(program);
    const output = generateZshCompletion("test-cli", commands);

    expect(output).toContain("#compdef test-cli");
    expect(output).toContain("_test-cli()");
    expect(output).toContain("compdef _test-cli test-cli");
    expect(output).toContain("_describe -t values");
  });
});

describe("resolveCompletionItems", () => {
  it("suggests argument placeholders for zsh positional arguments", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems(
      "zsh",
      program,
      ["test-cli", "web", "search", ""],
      3,
    );

    expect(items).toContainEqual({
      name: "query",
      description: "Search query",
    });
  });

  it("suggests known option values after a value-taking option", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["test-cli", "web", "fetch", "--format", ""],
      4,
    );

    expect(items.map((item) => item.name)).toEqual(["text", "json"]);
  });

  it("suggests known argument choices", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["test-cli", "completion", ""],
      2,
    );

    expect(items.map((item) => item.name)).toEqual(["bash", "zsh"]);
  });
});

describe("generateCompletion", () => {
  it.each([
    "bash",
    "zsh",
  ] as Shell[])("generates completion script for %s", (shell) => {
    const program = createTestProgram();
    const output = generateCompletion(shell, "test-cli", program);
    expect(output).toContain("test-cli");
    expect(output.length).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// CLI integration – runCli with captured IO
// ---------------------------------------------------------------------------

describe("completion command integration", () => {
  const packageInfo = { name: "devtools", version: "0.1.0" } as const;

  const createIo = () => {
    let stdout = "";
    let stderr = "";
    return {
      stdout: (text: string) => {
        stdout += text;
      },
      stderr: (text: string) => {
        stderr += text;
      },
      getStdout: () => stdout,
      getStderr: () => stderr,
    };
  };

  it("outputs bash completion script via CLI", async () => {
    const io = createIo();
    const exitCode = await runCli(["completion", "bash"], packageInfo, io);

    expect(exitCode).toBe(0);
    expect(io.getStdout()).toContain("# bash completion for devtools");
    expect(io.getStdout()).toContain(
      "complete -F _devtools_completion devtools",
    );
  });

  it("outputs zsh completion script via CLI", async () => {
    const io = createIo();
    const exitCode = await runCli(["completion", "zsh"], packageInfo, io);

    expect(exitCode).toBe(0);
    expect(io.getStdout()).toContain("#compdef devtools");
    expect(io.getStdout()).toContain("_devtools()");
    expect(io.getStdout()).toContain("compdef _devtools devtools");
  });

  it("returns error for unsupported shell", async () => {
    const io = createIo();
    const exitCode = await runCli(["completion", "fish"], packageInfo, io);

    expect(exitCode).toBe(1);
    expect(io.getStderr()).toContain("Unsupported shell: fish");
  });

  it("resolves registered subcommands via the internal completion command", async () => {
    const io = createIo();
    const exitCode = await runCli(
      ["__complete", "bash", "1", "--", "devtools", ""],
      packageInfo,
      io,
    );
    const output = io.getStdout();

    expect(exitCode).toBe(0);
    expect(output).toContain("install");
    expect(output).toContain("uninstall");
    expect(output).toContain("web");
    expect(output).toContain("completion");
  });
});

// ---------------------------------------------------------------------------
// Shell integration – run generated scripts in real bash / zsh processes
// ---------------------------------------------------------------------------

/**
 * Helper: run the real CLI entrypoint, capture the completion script, write
 * it to a temp file, then execute a test script in the target shell that
 * sources the completion file and exercises the completion function.
 */

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "devtools-comp-"));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

/** Generate the completion script via the real CLI and write to a temp file. */
async function generateCompletionFile(
  shell: Shell,
): Promise<{ path: string; script: string }> {
  const result = await execa(process.execPath, [cliPath, "completion", shell]);
  const filePath = join(tmpDir, `completion.${shell}`);
  await writeFile(filePath, result.stdout, "utf8");
  return { path: filePath, script: result.stdout };
}

// ---- Bash shell tests ----

describe("bash shell integration", () => {
  let completionFile: string;

  beforeAll(async () => {
    const result = await generateCompletionFile("bash");
    completionFile = result.path;
  });

  it("passes bash syntax check", async () => {
    const result = await execa("bash", ["-n", completionFile]);
    expect(result.exitCode).toBe(0);
  });

  it("registers the completion function after sourcing", async () => {
    const result = await execa("bash", [
      "-c",
      [
        "source /usr/share/bash-completion/bash_completion",
        `source ${completionFile}`,
        'complete -p devtools 2>&1 || echo "NOT REGISTERED"',
      ].join("\n"),
    ]);
    expect(result.stdout).toContain("_devtools_completion");
    expect(result.stdout).toContain("devtools");
    expect(result.stdout).not.toContain("NOT REGISTERED");
  });

  /**
   * Simulate bash completion for a given command line.
   * Returns the space-separated COMPREPLY entries.
   */
  async function bashComplete(...lineWords: string[]): Promise<string[]> {
    // Build a bash script that sources the completion file, sets up
    // COMP_ variables, calls the completion function, and prints results.
    const script = [
      "source /usr/share/bash-completion/bash_completion",
      cliShim,
      `source ${completionFile}`,
      `COMP_WORDS=(${lineWords.map((w) => `"${w}"`).join(" ")})`,
      `COMP_CWORD=$(( \${#COMP_WORDS[@]} - 1 ))`,
      // Use explicit space join for COMP_LINE (IFS-independent)
      `COMP_LINE="${lineWords.join(" ")}"`,
      `COMP_POINT=\${#COMP_LINE}`,
      "_devtools_completion",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: shell code, not JS template
      'printf "%s\\n" "${COMPREPLY[@]}"',
    ].join("\n");

    const result = await execa("bash", ["-c", script]);
    return result.stdout.split("\n").filter((s) => s.length > 0);
  }

  it("completes top-level commands", async () => {
    const items = await bashComplete("devtools", "");
    expect(items).toContain("install");
    expect(items).toContain("uninstall");
    expect(items).toContain("web");
    expect(items).toContain("completion");
    expect(items).toContain("--version");
  });

  it("filters top-level commands by prefix", async () => {
    const items = await bashComplete("devtools", "we");
    expect(items).toEqual(["web"]);
  });

  it("completes web subcommands", async () => {
    const items = await bashComplete("devtools", "web", "");
    expect(items).toContain("search");
    expect(items).toContain("docs-search");
    expect(items).toContain("fetch");
    expect(items).toContain("inspect");
    expect(items).toContain("links");
    expect(items).toContain("sitemap");
  });

  it("completes web fetch options", async () => {
    const items = await bashComplete("devtools", "web", "fetch", "url", "");
    expect(items).toContain("--format");
    expect(items).toContain("--timeout");
  });

  it("completes known value choices for the completion command", async () => {
    const items = await bashComplete("devtools", "completion", "");
    expect(items).toEqual(["bash", "zsh"]);
  });

  it("completes known option values after a value-taking flag", async () => {
    const items = await bashComplete(
      "devtools",
      "web",
      "fetch",
      "--format",
      "",
    );
    expect(items).toContain("markdown");
    expect(items).toContain("text");
    expect(items).toContain("html");
    expect(items).toContain("json");
  });

  it("filters web subcommands by prefix", async () => {
    const items = await bashComplete("devtools", "web", "f");
    expect(items).toEqual(["fetch"]);
  });

  it("completes install subcommands", async () => {
    const items = await bashComplete("devtools", "install", "");
    expect(items).toEqual(["skills"]);
  });

  it("completes install skills options", async () => {
    const items = await bashComplete("devtools", "install", "skills", "pi", "");
    expect(items).toContain("--dry-run");
    expect(items).toContain("--force");
    expect(items).toContain("--target-dir");
  });

  it("skips flags when building subcommand path", async () => {
    const items = await bashComplete("devtools", "web", "--help", "fetch", "");
    expect(items).toContain("--format");
    expect(items).toContain("--timeout");
  });

  it("falls back to root completions for unknown subcommand path", async () => {
    const items = await bashComplete("devtools", "unknown", "");
    expect(items).toContain("install");
    expect(items).toContain("web");
  });
});

// ---- Zsh shell tests ----

describe("zsh shell integration", () => {
  let completionFile: string;
  let completionScript: string;

  beforeAll(async () => {
    const result = await generateCompletionFile("zsh");
    completionFile = result.path;
    completionScript = result.script;
  });

  it("passes zsh syntax check", async () => {
    const result = await execa("zsh", ["-n", completionFile]);
    expect(result.exitCode).toBe(0);
  });

  it("defines the completion function after sourcing", async () => {
    const result = await execa("zsh", [
      "-c",
      [
        "autoload -Uz compinit && compinit -u 2>/dev/null",
        `source ${completionFile}`,
        "typeset -f _devtools >/dev/null && echo FUNC_OK || echo FUNC_MISSING",
      ].join("\n"),
    ]);
    expect(result.stdout).toBe("FUNC_OK");
  });

  it("registers with compdef after sourcing", async () => {
    const result = await execa("zsh", [
      "-c",
      [
        "autoload -Uz compinit && compinit -u 2>/dev/null",
        `source ${completionFile}`,
        // biome-ignore lint/suspicious/noTemplateCurlyInString: shell code, not JS template
        'echo "${_comps[devtools]}"',
      ].join("\n"),
    ]);
    expect(result.stdout).toBe("_devtools");
  });

  /**
   * Simulate zsh completion by overriding `_describe` with a shim that
   * reads the `completions` array via dynamic scoping and prints the
   * name part of each 'name:description' spec.
   *
   * We strip the `compdef` line so it doesn't fail outside an interactive
   * shell, and override `_describe` so it doesn't need a real completion
   * context (the real `_describe` calls `compadd` internally).
   */
  async function zshComplete(...lineWords: string[]): Promise<string[]> {
    const wordsArray = lineWords.map((w) => `"${w}"`).join(" ");

    const script = [
      // Define the function without calling compdef
      completionScript.replace(/^compdef .*/m, ""),
      cliShim,
      // Override _describe to extract completion names from the specs array.
      // Handles: _describe [-t tag] 'descr' array_name
      "_describe() {",
      '  while [[ "$1" == -* ]]; do shift; shift; done',
      "  shift",
      "  local arr_name=$1",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: shell code, not JS template
      '  for item in "${(P@)arr_name}"; do',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: shell code, not JS template
      '    printf "%s\\n" "${item%%:*}"',
      "  done",
      "}",
      "",
      `words=(${wordsArray})`,
      `CURRENT=${lineWords.length}`,
      "_devtools",
    ].join("\n");

    const result = await execa("zsh", ["-c", script]);
    return result.stdout.split("\n").filter((s) => s.length > 0);
  }

  it("completes top-level commands", async () => {
    const items = await zshComplete("devtools", "");
    expect(items).toContain("install");
    expect(items).toContain("uninstall");
    expect(items).toContain("web");
    expect(items).toContain("completion");
    expect(items).toContain("--version");
  });

  it("completes web subcommands", async () => {
    const items = await zshComplete("devtools", "web", "");
    expect(items).toContain("search");
    expect(items).toContain("docs-search");
    expect(items).toContain("fetch");
    expect(items).toContain("inspect");
    expect(items).toContain("links");
    expect(items).toContain("sitemap");
  });

  it("completes web fetch options", async () => {
    const items = await zshComplete("devtools", "web", "fetch", "url", "");
    expect(items).toContain("--format");
    expect(items).toContain("--timeout");
  });

  it("completes the positional query placeholder for web search", async () => {
    const items = await zshComplete("devtools", "web", "search", "");
    expect(items).toContain("query");
    expect(items).toContain("--engine");
  });

  it("completes known value choices for the completion command", async () => {
    const items = await zshComplete("devtools", "completion", "");
    expect(items).toEqual(["bash", "zsh"]);
  });

  it("completes known option values after a value-taking flag", async () => {
    const items = await zshComplete("devtools", "web", "fetch", "--format", "");
    expect(items).toContain("markdown");
    expect(items).toContain("text");
    expect(items).toContain("html");
    expect(items).toContain("json");
  });

  it("completes install subcommands", async () => {
    const items = await zshComplete("devtools", "install", "");
    expect(items).toEqual(["skills"]);
  });

  it("completes install skills options", async () => {
    const items = await zshComplete("devtools", "install", "skills", "pi", "");
    expect(items).toContain("--dry-run");
    expect(items).toContain("--force");
    expect(items).toContain("--target-dir");
  });

  it("skips flags when building subcommand path", async () => {
    const items = await zshComplete("devtools", "web", "--help", "fetch", "");
    expect(items).toContain("--format");
    expect(items).toContain("--timeout");
  });

  it("falls back to root completions for unknown subcommand path", async () => {
    const items = await zshComplete("devtools", "unknown", "");
    expect(items).toContain("install");
    expect(items).toContain("web");
  });

  it("includes descriptions in _describe specs", async () => {
    const script = [
      completionScript.replace(/^compdef .*/m, ""),
      cliShim,
      // Override _describe to print tag + raw specs
      "_describe() {",
      '  while [[ "$1" == -* ]]; do shift; shift; done',
      "  shift",
      "  local arr_name=$1",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: shell code, not JS template
      '  for item in "${(P@)arr_name}"; do',
      '    printf "%s\\n" "$item"',
      "  done",
      "}",
      "",
      'words=(devtools "")',
      "CURRENT=2",
      "_devtools",
    ].join("\n");

    const result = await execa("zsh", ["-c", script]);
    const lines = result.stdout.split("\n").filter((s) => s.length > 0);

    expect(lines).toContain("install:Install packaged resources");
    expect(lines).toContain("web:Web utilities");
    expect(lines).toContain("completion:Generate shell completion script");
    // --version is an option, shown separately
    expect(lines).toContain("--version:Show version");
  });
});
