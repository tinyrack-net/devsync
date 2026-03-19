import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Command } from "commander";
import { execa } from "execa";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type CompletionItem,
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

// ---------------------------------------------------------------------------
// Test program factories
// ---------------------------------------------------------------------------

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

function createVariadicProgram(): Command {
  const program = new Command();
  program.name("var-cli");

  const addCommand = program
    .command("add")
    .description("Add items")
    .argument("<items...>", "Items to add");
  setArgumentCompletionChoices(addCommand, "items", [
    { name: "foo", description: "Foo item" },
    { name: "bar", description: "Bar item" },
    { name: "baz", description: "Baz item" },
  ]);

  return program;
}

function createHiddenProgram(): Command {
  const program = new Command();
  program.name("hid-cli");

  program.command("visible").description("Visible command");
  program.command("__internal", { hidden: true }).description("Hidden command");

  const cmd = program
    .command("opts")
    .description("Options test")
    .option("--public", "Public option")
    .option("--secret", "Secret option");

  // Hide the --secret option
  const secretOpt = cmd.options.find((o) => o.long === "--secret");
  if (secretOpt) secretOpt.hidden = true;

  return program;
}

function createMultiArgProgram(): Command {
  const program = new Command();
  program.name("multi-cli");

  program
    .command("deploy")
    .description("Deploy an app")
    .argument("<env>", "Deployment environment")
    .argument("<region>", "Cloud region")
    .option("--dry-run", "Dry run mode");

  return program;
}

function createDescribedChoicesProgram(): Command {
  const program = new Command();
  program.name("desc-cli");

  const cmd = program
    .command("run")
    .description("Run something")
    .argument("<target>", "Target to run")
    .option("-m, --mode <mode>", "Run mode");

  setArgumentCompletionChoices(cmd, "target", [
    { name: "dev", description: "Development" },
    { name: "staging", description: "Staging environment" },
    { name: "prod", description: "Production" },
  ]);
  setOptionCompletionChoices(cmd, "--mode", [
    { name: "fast", description: "Fast mode" },
    { name: "safe", description: "Safe mode" },
  ]);

  return program;
}

const names = (items: CompletionItem[]) => items.map((i) => i.name);

// ---------------------------------------------------------------------------
// Unit tests – isSupportedShell, SUPPORTED_SHELLS
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

// ---------------------------------------------------------------------------
// Unit tests – collectCommands
// ---------------------------------------------------------------------------

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

  it("sorts subcommands alphabetically", () => {
    const program = createTestProgram();
    const commands = collectCommands(program);

    const root = commands.get("__root__");
    const subNames = root?.subcommands.map((s) => s.name) ?? [];

    const sorted = [...subNames].sort((a, b) => a.localeCompare(b));
    expect(subNames).toEqual(sorted);
  });

  it("sorts options alphabetically with meta options last", () => {
    const program = createTestProgram();
    const commands = collectCommands(program);

    const root = commands.get("__root__");
    const optNames = root?.options.map((o) => o.name) ?? [];

    // --version should appear after all non-meta options
    const versionIndex = optNames.indexOf("--version");
    const nonMetaOptions = optNames.filter((n) => n !== "--version");

    if (versionIndex !== -1) {
      expect(versionIndex).toBe(optNames.length - 1);
    }

    // Non-meta options should be alphabetically sorted
    const sortedNonMeta = [...nonMetaOptions].sort((a, b) =>
      a.localeCompare(b),
    );
    expect(nonMetaOptions).toEqual(sortedNonMeta);
  });

  it("excludes hidden commands from collected subcommands", () => {
    const program = createHiddenProgram();
    const commands = collectCommands(program);

    const root = commands.get("__root__");
    const subNames = root?.subcommands.map((s) => s.name) ?? [];

    expect(subNames).toContain("visible");
    expect(subNames).toContain("opts");
    expect(subNames).not.toContain("__internal");
  });

  it("excludes hidden options from collected options", () => {
    const program = createHiddenProgram();
    const commands = collectCommands(program);

    const opts = commands.get("opts");
    const optNames = opts?.options.map((o) => o.name) ?? [];

    expect(optNames).toContain("--public");
    expect(optNames).not.toContain("--secret");
  });

  it("collects variadic argument metadata", () => {
    const program = createVariadicProgram();
    const commands = collectCommands(program);

    const add = commands.get("add");
    expect(add?.arguments).toHaveLength(1);
    expect(add?.arguments[0]?.variadic).toBe(true);
    expect(add?.arguments[0]?.choices.map((c) => c.name)).toEqual([
      "foo",
      "bar",
      "baz",
    ]);
  });

  it("collects multiple positional arguments", () => {
    const program = createMultiArgProgram();
    const commands = collectCommands(program);

    const deploy = commands.get("deploy");
    expect(deploy?.arguments).toHaveLength(2);
    expect(deploy?.arguments[0]?.name).toBe("env");
    expect(deploy?.arguments[1]?.name).toBe("region");
  });
});

// ---------------------------------------------------------------------------
// Unit tests – resolveCompletionItems: sorting and grouping
// ---------------------------------------------------------------------------

describe("resolveCompletionItems – sorting and grouping", () => {
  it("returns subcommands before options for empty token at root", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems("bash", program, ["test-cli", ""], 1);

    const firstOption = items.findIndex((i) => i.name.startsWith("-"));
    const lastSubcommand = items.findLastIndex((i) => !i.name.startsWith("-"));

    expect(firstOption).toBeGreaterThan(lastSubcommand);
  });

  it("sorts subcommands alphabetically in results", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems("bash", program, ["test-cli", ""], 1);

    const subcommands = items.filter((i) => !i.name.startsWith("-"));
    const sorted = [...subcommands].sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    expect(names(subcommands)).toEqual(names(sorted));
  });

  it("puts --version after non-meta options", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems("bash", program, ["test-cli", ""], 1);

    const optionItems = items.filter((i) => i.name.startsWith("-"));
    const lastItem = optionItems.at(-1);

    expect(lastItem?.name).toBe("--version");
  });

  it("sorts leaf command options alphabetically with --help last", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["test-cli", "web", "search", "q", ""],
      4,
    );

    // After consuming the query argument, only options remain
    const optionNames = names(items);

    const helpIndex = optionNames.indexOf("--help");
    const nonHelp = optionNames.filter((n) => n !== "--help");
    const sortedNonHelp = [...nonHelp].sort((a, b) => a.localeCompare(b));

    expect(nonHelp).toEqual(sortedNonHelp);
    if (helpIndex !== -1) {
      expect(helpIndex).toBe(optionNames.length - 1);
    }
  });
});

// ---------------------------------------------------------------------------
// Unit tests – resolveCompletionItems: subcommand navigation
// ---------------------------------------------------------------------------

describe("resolveCompletionItems – subcommand navigation", () => {
  it("suggests root subcommands and options for empty token", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems("bash", program, ["test-cli", ""], 1);

    expect(names(items)).toContain("web");
    expect(names(items)).toContain("install");
    expect(names(items)).toContain("completion");
    expect(names(items)).toContain("--version");
  });

  it("suggests nested subcommands for intermediate command", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["test-cli", "web", ""],
      2,
    );

    expect(names(items)).toContain("search");
    expect(names(items)).toContain("fetch");
    expect(names(items)).not.toContain("install");
  });

  it("filters subcommands by prefix", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["test-cli", "we"],
      1,
    );

    expect(names(items)).toEqual(["web"]);
  });

  it("filters nested subcommands by prefix", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["test-cli", "web", "se"],
      2,
    );

    expect(names(items)).toEqual(["search"]);
  });

  it("returns empty when prefix matches nothing", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["test-cli", "xyz"],
      1,
    );

    expect(items).toEqual([]);
  });

  it("skips flag tokens when resolving the command path", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["test-cli", "web", "--help", "fetch", ""],
      4,
    );

    expect(names(items)).toContain("--format");
  });

  it("falls back to root on unknown subcommand path", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["test-cli", "unknown", ""],
      2,
    );

    expect(names(items)).toContain("web");
    expect(names(items)).toContain("install");
  });
});

// ---------------------------------------------------------------------------
// Unit tests – resolveCompletionItems: option completion
// ---------------------------------------------------------------------------

describe("resolveCompletionItems – option flags", () => {
  it("filters options by prefix", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["test-cli", "web", "search", "q", "--l"],
      4,
    );

    expect(names(items)).toEqual(["--limit"]);
  });

  it("suggests all options when typing double dash", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["test-cli", "web", "search", "q", "--"],
      4,
    );

    expect(names(items)).toContain("--limit");
    expect(names(items)).toContain("--json");
  });

  it("suggests options after all positional arguments are consumed", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["test-cli", "web", "search", "myquery", ""],
      4,
    );

    expect(names(items)).toContain("--limit");
    expect(names(items)).toContain("--json");
  });
});

// ---------------------------------------------------------------------------
// Unit tests – resolveCompletionItems: option values
// ---------------------------------------------------------------------------

describe("resolveCompletionItems – option values", () => {
  it("suggests known values after a value-taking flag (separate token)", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["test-cli", "web", "fetch", "--format", ""],
      4,
    );

    expect(names(items)).toEqual(["text", "json"]);
  });

  it("filters known option values by prefix", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["test-cli", "web", "fetch", "--format", "j"],
      4,
    );

    expect(names(items)).toEqual(["json"]);
  });

  it("suggests attached option values with --flag=prefix", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["test-cli", "web", "fetch", "--format="],
      3,
    );

    expect(names(items)).toEqual(["--format=text", "--format=json"]);
  });

  it("filters attached option values by partial value", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["test-cli", "web", "fetch", "--format=t"],
      3,
    );

    expect(names(items)).toEqual(["--format=text"]);
  });

  it("provides zsh placeholder for free-form option value", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems(
      "zsh",
      program,
      ["test-cli", "web", "search", "q", "--limit", ""],
      5,
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.name).toBe("number");
  });

  it("returns empty for bash free-form option value", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["test-cli", "web", "search", "q", "--limit", ""],
      5,
    );

    expect(items).toEqual([]);
  });

  it("provides zsh attached value placeholder for free-form option", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems(
      "zsh",
      program,
      ["test-cli", "web", "search", "q", "--limit="],
      4,
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.name).toBe("--limit=<number>");
  });

  it("returns replacement suggestions when current token exactly matches a value-taking flag", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["test-cli", "web", "fetch", "--format"],
      3,
    );

    expect(names(items)).toEqual(["--format=text", "--format=json"]);
  });

  it("resumes normal completion after consuming an option value", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["test-cli", "web", "fetch", "--format", "text", ""],
      5,
    );

    // After --format text is consumed, back to url argument or options
    expect(names(items)).toContain("--format");
  });

  it("suggests described option value choices with descriptions", () => {
    const program = createDescribedChoicesProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["desc-cli", "run", "--mode", ""],
      3,
    );

    expect(items).toContainEqual({ name: "fast", description: "Fast mode" });
    expect(items).toContainEqual({ name: "safe", description: "Safe mode" });
  });
});

// ---------------------------------------------------------------------------
// Unit tests – resolveCompletionItems: argument choices
// ---------------------------------------------------------------------------

describe("resolveCompletionItems – argument choices", () => {
  it("suggests known argument choices", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["test-cli", "completion", ""],
      2,
    );

    expect(names(items)).toEqual(["bash", "zsh"]);
  });

  it("filters argument choices by prefix", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["test-cli", "completion", "b"],
      2,
    );

    expect(names(items)).toEqual(["bash"]);
  });

  it("includes options alongside argument choices for empty token", () => {
    const program = createDescribedChoicesProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["desc-cli", "run", ""],
      2,
    );

    // Should have argument choices and options
    expect(names(items)).toContain("dev");
    expect(names(items)).toContain("staging");
    expect(names(items)).toContain("prod");
    expect(names(items)).toContain("--mode");
  });

  it("returns only matching argument choices when prefix is non-empty", () => {
    const program = createDescribedChoicesProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["desc-cli", "run", "d"],
      2,
    );

    expect(names(items)).toEqual(["dev"]);
  });

  it("preserves argument choice descriptions", () => {
    const program = createDescribedChoicesProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["desc-cli", "run", ""],
      2,
    );

    expect(items).toContainEqual({
      name: "dev",
      description: "Development",
    });
    expect(items).toContainEqual({
      name: "staging",
      description: "Staging environment",
    });
  });
});

// ---------------------------------------------------------------------------
// Unit tests – resolveCompletionItems: variadic arguments
// ---------------------------------------------------------------------------

describe("resolveCompletionItems – variadic arguments", () => {
  it("suggests variadic argument choices on first position", () => {
    const program = createVariadicProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["var-cli", "add", ""],
      2,
    );

    expect(names(items)).toContain("foo");
    expect(names(items)).toContain("bar");
    expect(names(items)).toContain("baz");
  });

  it("suggests variadic argument choices on subsequent positions", () => {
    const program = createVariadicProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["var-cli", "add", "foo", ""],
      3,
    );

    expect(names(items)).toContain("foo");
    expect(names(items)).toContain("bar");
    expect(names(items)).toContain("baz");
  });

  it("filters variadic argument choices by prefix", () => {
    const program = createVariadicProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["var-cli", "add", "foo", "ba"],
      3,
    );

    expect(names(items)).toEqual(["bar", "baz"]);
  });
});

// ---------------------------------------------------------------------------
// Unit tests – resolveCompletionItems: multiple positional arguments
// ---------------------------------------------------------------------------

describe("resolveCompletionItems – multiple positional arguments", () => {
  it("shows zsh placeholder for first argument", () => {
    const program = createMultiArgProgram();
    const items = resolveCompletionItems(
      "zsh",
      program,
      ["multi-cli", "deploy", ""],
      2,
    );

    expect(items).toContainEqual({
      name: "env",
      description: "Deployment environment",
    });
  });

  it("shows zsh placeholder for second argument after first is consumed", () => {
    const program = createMultiArgProgram();
    const items = resolveCompletionItems(
      "zsh",
      program,
      ["multi-cli", "deploy", "production", ""],
      3,
    );

    expect(items).toContainEqual({
      name: "region",
      description: "Cloud region",
    });
  });

  it("shows only options after all arguments are consumed", () => {
    const program = createMultiArgProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["multi-cli", "deploy", "production", "us-east-1", ""],
      4,
    );

    const itemNames = names(items);
    expect(itemNames).toContain("--dry-run");
    expect(itemNames).not.toContain("env");
    expect(itemNames).not.toContain("region");
  });

  it("correctly tracks consumed arguments interleaved with options", () => {
    const program = createMultiArgProgram();
    const items = resolveCompletionItems(
      "zsh",
      program,
      ["multi-cli", "deploy", "production", "--dry-run", ""],
      4,
    );

    // First arg consumed, --dry-run is a flag, now at second arg
    expect(items).toContainEqual({
      name: "region",
      description: "Cloud region",
    });
  });
});

// ---------------------------------------------------------------------------
// Unit tests – resolveCompletionItems: zsh-specific placeholders
// ---------------------------------------------------------------------------

describe("resolveCompletionItems – zsh placeholders", () => {
  it("shows argument placeholder for zsh", () => {
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

  it("does not show argument placeholder for bash", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["test-cli", "web", "search", ""],
      3,
    );

    expect(names(items)).not.toContain("query");
  });

  it("shows options alongside zsh placeholder for empty token", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems(
      "zsh",
      program,
      ["test-cli", "web", "search", ""],
      3,
    );

    expect(names(items)).toContain("query");
    expect(names(items)).toContain("--limit");
    expect(names(items)).toContain("--json");
  });
});

// ---------------------------------------------------------------------------
// Unit tests – resolveCompletionItems: double-dash stop token
// ---------------------------------------------------------------------------

describe("resolveCompletionItems – double-dash stop", () => {
  it("treats tokens after -- as positional arguments, not flags", () => {
    const program = createMultiArgProgram();
    // deploy <env> <region>: after --, "--prod" is a positional arg, not a flag
    const items = resolveCompletionItems(
      "zsh",
      program,
      ["multi-cli", "deploy", "--", "--prod", ""],
      4,
    );

    // "--prod" was consumed as the <env> positional, now at <region>
    expect(items).toContainEqual({
      name: "region",
      description: "Cloud region",
    });
  });

  it("shows zsh argument placeholder after --", () => {
    const program = createMultiArgProgram();
    const items = resolveCompletionItems(
      "zsh",
      program,
      ["multi-cli", "deploy", "--", ""],
      3,
    );

    expect(items).toContainEqual({
      name: "env",
      description: "Deployment environment",
    });
  });
});

// ---------------------------------------------------------------------------
// Unit tests – resolveCompletionItems: attached option values (--flag=value)
// ---------------------------------------------------------------------------

describe("resolveCompletionItems – attached option values", () => {
  it("skips attached values in context parsing", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["test-cli", "web", "fetch", "--format=json", ""],
      4,
    );

    // --format=json is consumed as one token; remaining options still available
    expect(names(items)).toContain("--format");
  });

  it("returns empty for no-match attached value filter", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["test-cli", "web", "fetch", "--format=x"],
      3,
    );

    expect(items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Unit tests – resolveCompletionItems: edge cases
// ---------------------------------------------------------------------------

describe("resolveCompletionItems – edge cases", () => {
  it("handles currentWordIndex beyond words array", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems("bash", program, ["test-cli"], 5);

    expect(names(items)).toContain("web");
    expect(names(items)).toContain("install");
  });

  it("returns empty for non-matching prefix in option-only context", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["test-cli", "web", "search", "q", "xyz"],
      4,
    );

    expect(items).toEqual([]);
  });

  it("deduplicates items with the same name", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems("bash", program, ["test-cli", ""], 1);

    const itemNames = names(items);
    const uniqueNames = [...new Set(itemNames)];
    expect(itemNames).toEqual(uniqueNames);
  });

  it("handles short flag as pending option token", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["test-cli", "web", "fetch", "-f", ""],
      4,
    );

    expect(names(items)).toEqual(["text", "json"]);
  });

  it("handles unknown flag gracefully in context parsing", () => {
    const program = createTestProgram();
    const items = resolveCompletionItems(
      "bash",
      program,
      ["test-cli", "web", "search", "--unknown", ""],
      4,
    );

    expect(names(items)).toContain("--limit");
  });
});

// ---------------------------------------------------------------------------
// Unit tests – setArgumentCompletionChoices / setOptionCompletionChoices
// ---------------------------------------------------------------------------

describe("setArgumentCompletionChoices", () => {
  it("throws for unknown argument name", () => {
    const program = new Command();
    program.name("test").argument("<arg>", "desc");

    expect(() => {
      setArgumentCompletionChoices(program, "nonexistent", ["a"]);
    }).toThrow("Unknown completion argument: nonexistent");
  });

  it("accepts string array choices", () => {
    const program = new Command();
    program.name("test").argument("<color>", "Pick a color");
    setArgumentCompletionChoices(program, "color", ["red", "green", "blue"]);

    const commands = collectCommands(program);
    const root = commands.get("__root__");

    expect(root?.arguments[0]?.choices.map((c) => c.name)).toEqual([
      "red",
      "green",
      "blue",
    ]);
  });

  it("accepts CompletionItem array choices", () => {
    const program = new Command();
    program.name("test").argument("<env>", "Environment");
    setArgumentCompletionChoices(program, "env", [
      { name: "dev", description: "Development" },
      { name: "prod", description: "Production" },
    ]);

    const commands = collectCommands(program);
    const root = commands.get("__root__");

    expect(root?.arguments[0]?.choices).toEqual([
      { name: "dev", description: "Development" },
      { name: "prod", description: "Production" },
    ]);
  });
});

describe("setOptionCompletionChoices", () => {
  it("throws for unknown option flag", () => {
    const program = new Command();
    program.name("test").option("--foo", "desc");

    expect(() => {
      setOptionCompletionChoices(program, "--nonexistent", ["a"]);
    }).toThrow("Unknown completion option: --nonexistent");
  });

  it("accepts choices via long flag", () => {
    const program = new Command();
    program.name("test").option("--color <color>", "Pick a color");
    setOptionCompletionChoices(program, "--color", ["red", "green"]);

    const commands = collectCommands(program);
    const root = commands.get("__root__");
    const opt = root?.optionDetails.find((o) => o.name === "--color");

    expect(opt?.valueChoices.map((c) => c.name)).toEqual(["red", "green"]);
  });

  it("accepts choices via short flag", () => {
    const program = new Command();
    program.name("test").option("-c, --color <color>", "Pick a color");
    setOptionCompletionChoices(program, "-c", ["red", "green"]);

    const commands = collectCommands(program);
    const root = commands.get("__root__");
    const opt = root?.optionDetails.find((o) => o.name === "--color");

    expect(opt?.valueChoices.map((c) => c.name)).toEqual(["red", "green"]);
  });
});

// ---------------------------------------------------------------------------
// Unit tests – generateBashCompletion / generateZshCompletion
// ---------------------------------------------------------------------------

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
  it("generates valid zsh completion script with grouping", () => {
    const program = createTestProgram();
    const commands = collectCommands(program);
    const output = generateZshCompletion("test-cli", commands);

    expect(output).toContain("#compdef test-cli");
    expect(output).toContain("_test-cli()");
    expect(output).toContain("compdef _test-cli test-cli");
    expect(output).toContain("_describe -V 'argument'");
    expect(output).toContain("_describe -V 'option'");
  });

  it("separates items into arg_completions and opt_completions arrays", () => {
    const program = createTestProgram();
    const commands = collectCommands(program);
    const output = generateZshCompletion("test-cli", commands);

    expect(output).toContain("arg_completions=()");
    expect(output).toContain("opt_completions=()");
    expect(output).toContain('if [[ "$name" == -* ]]');
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

  it("returns error for invalid word index in __complete", async () => {
    const io = createIo();
    const exitCode = await runCli(
      ["__complete", "bash", "abc", "--", "devtools", ""],
      packageInfo,
      io,
    );

    expect(exitCode).toBe(1);
    expect(io.getStderr()).toContain("Invalid current word index");
  });

  it("returns error for negative word index in __complete", async () => {
    const io = createIo();
    const exitCode = await runCli(
      ["__complete", "bash", "-1", "--", "devtools", ""],
      packageInfo,
      io,
    );

    expect(exitCode).toBe(1);
    expect(io.getStderr()).toContain("Invalid current word index");
  });

  it("returns error for unsupported shell in __complete", async () => {
    const io = createIo();
    const exitCode = await runCli(
      ["__complete", "fish", "1", "--", "devtools", ""],
      packageInfo,
      io,
    );

    expect(exitCode).toBe(1);
    expect(io.getStderr()).toContain("Unsupported shell: fish");
  });

  it("resolves registered subcommands via __complete", async () => {
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

  it("returns tab-separated name and description in __complete output", async () => {
    const io = createIo();
    await runCli(
      ["__complete", "bash", "1", "--", "devtools", ""],
      packageInfo,
      io,
    );

    const lines = io.getStdout().trim().split("\n");
    for (const line of lines) {
      expect(line).toMatch(/^[^\t]+\t/);
    }
  });

  it("has exactly one tab per line in __complete output", async () => {
    const io = createIo();
    await runCli(
      ["__complete", "bash", "1", "--", "devtools", ""],
      packageInfo,
      io,
    );

    const lines = io.getStdout().trim().split("\n");
    for (const line of lines) {
      const tabs = line.split("\t");
      expect(tabs).toHaveLength(2);
    }
  });

  it("returns subcommands sorted alphabetically before options", async () => {
    const io = createIo();
    await runCli(
      ["__complete", "bash", "1", "--", "devtools", ""],
      packageInfo,
      io,
    );

    const lines = io.getStdout().trim().split("\n");
    const itemNames = lines.map((l) => l.split("\t")[0] ?? "");
    const subcommands = itemNames.filter((n) => !n.startsWith("-"));
    const options = itemNames.filter((n) => n.startsWith("-"));

    if (subcommands.length > 0 && options.length > 0) {
      const lastSubIndex = itemNames.lastIndexOf(
        subcommands[subcommands.length - 1] ?? "",
      );
      const firstOptIndex = itemNames.indexOf(options[0] ?? "");
      expect(lastSubIndex).toBeLessThan(firstOptIndex);
    }

    const sortedSubs = [...subcommands].sort((a, b) => a.localeCompare(b));
    expect(subcommands).toEqual(sortedSubs);
  });
});

// ---------------------------------------------------------------------------
// Shell integration – run generated scripts in real bash / zsh processes
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "devtools-comp-"));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

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

  async function bashComplete(...lineWords: string[]): Promise<string[]> {
    const script = [
      "source /usr/share/bash-completion/bash_completion",
      cliShim,
      `source ${completionFile}`,
      `COMP_WORDS=(${lineWords.map((w) => `"${w}"`).join(" ")})`,
      `COMP_CWORD=$(( \${#COMP_WORDS[@]} - 1 ))`,
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

  it("completes web search options after query argument", async () => {
    const items = await bashComplete("devtools", "web", "search", "hello", "");
    expect(items).toContain("--engine");
    expect(items).toContain("--limit");
    expect(items).toContain("--json");
  });

  it("filters options by prefix in bash", async () => {
    const items = await bashComplete(
      "devtools",
      "web",
      "search",
      "hello",
      "--l",
    );
    expect(items).toEqual(["--limit"]);
  });

  it("completes search engine choices for --engine", async () => {
    const items = await bashComplete(
      "devtools",
      "web",
      "search",
      "hello",
      "--engine",
      "",
    );
    expect(items).toContain("brave");
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
   * Simulate zsh completion by overriding `_describe` with a shim.
   * The shim handles both standalone flags (-V, -J, -1, -2, -x) and
   * flags with arguments (-o, -O, -t).
   */
  async function zshComplete(...lineWords: string[]): Promise<string[]> {
    const wordsArray = lineWords.map((w) => `"${w}"`).join(" ");

    const script = [
      completionScript.replace(/^compdef .*/m, ""),
      cliShim,
      // Override _describe to extract completion names from the specs array.
      // Handles: _describe [-12JVx] [-oOt arg] 'descr' array_name
      "_describe() {",
      '  while [[ "$1" == -* ]]; do',
      '    case "$1" in -[oOt]) shift; shift;; *) shift;; esac',
      "  done",
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

  /**
   * Like zshComplete but returns raw _describe specs (name:description).
   */
  async function zshCompleteRaw(...lineWords: string[]): Promise<string[]> {
    const wordsArray = lineWords.map((w) => `"${w}"`).join(" ");

    const script = [
      completionScript.replace(/^compdef .*/m, ""),
      cliShim,
      "_describe() {",
      '  while [[ "$1" == -* ]]; do',
      '    case "$1" in -[oOt]) shift; shift;; *) shift;; esac',
      "  done",
      "  shift",
      "  local arr_name=$1",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: shell code, not JS template
      '  for item in "${(P@)arr_name}"; do',
      '    printf "%s\\n" "$item"',
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

  /**
   * Like zshComplete but captures group labels passed to _describe.
   */
  async function zshCompleteGroups(
    ...lineWords: string[]
  ): Promise<{ group: string; items: string[] }[]> {
    const wordsArray = lineWords.map((w) => `"${w}"`).join(" ");

    const script = [
      completionScript.replace(/^compdef .*/m, ""),
      cliShim,
      "_describe() {",
      '  while [[ "$1" == -* ]]; do',
      '    case "$1" in -[oOt]) shift; shift;; *) shift;; esac',
      "  done",
      '  local group_label="$1"; shift',
      "  local arr_name=$1",
      '  printf "GROUP:%s\\n" "$group_label"',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: shell code, not JS template
      '  for item in "${(P@)arr_name}"; do',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: shell code, not JS template
      '    printf "  %s\\n" "${item%%:*}"',
      "  done",
      "}",
      "",
      `words=(${wordsArray})`,
      `CURRENT=${lineWords.length}`,
      "_devtools",
    ].join("\n");

    const result = await execa("zsh", ["-c", script]);
    const lines = result.stdout.split("\n").filter((s) => s.length > 0);

    const groups: { group: string; items: string[] }[] = [];
    let current: { group: string; items: string[] } | undefined;

    for (const line of lines) {
      if (line.startsWith("GROUP:")) {
        current = { group: line.slice(6), items: [] };
        groups.push(current);
      } else if (current && line.startsWith("  ")) {
        current.items.push(line.slice(2));
      }
    }

    return groups;
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
    const lines = await zshCompleteRaw("devtools", "");

    expect(lines).toContain("install:Install packaged resources");
    expect(lines).toContain("web:Web utilities");
    expect(lines).toContain("completion:Generate shell completion script");
    expect(lines).toContain("--version:Show version");
  });

  it("groups arguments before options in _describe calls", async () => {
    const groups = await zshCompleteGroups("devtools", "");

    expect(groups).toHaveLength(2);
    expect(groups[0]?.group).toBe("argument");
    expect(groups[1]?.group).toBe("option");

    expect(groups[0]?.items).toContain("install");
    expect(groups[0]?.items).toContain("web");
    expect(groups[1]?.items).toContain("--version");
  });

  it("puts only options in the option group for leaf commands", async () => {
    const groups = await zshCompleteGroups(
      "devtools",
      "web",
      "fetch",
      "url",
      "",
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.group).toBe("option");
    expect(groups[0]?.items).toContain("--format");
    expect(groups[0]?.items).toContain("--timeout");
  });

  it("puts argument placeholder in argument group for web search", async () => {
    const groups = await zshCompleteGroups("devtools", "web", "search", "");

    expect(groups).toHaveLength(2);
    expect(groups[0]?.group).toBe("argument");
    expect(groups[0]?.items).toContain("query");
    expect(groups[1]?.group).toBe("option");
    expect(groups[1]?.items).toContain("--engine");
  });

  it("shows only argument group when all items are non-options", async () => {
    const groups = await zshCompleteGroups("devtools", "completion", "");

    expect(groups).toHaveLength(1);
    expect(groups[0]?.group).toBe("argument");
    expect(groups[0]?.items).toEqual(["bash", "zsh"]);
  });

  it("puts option value choices in argument group", async () => {
    const groups = await zshCompleteGroups(
      "devtools",
      "web",
      "fetch",
      "--format",
      "",
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.group).toBe("argument");
    expect(groups[0]?.items).toContain("markdown");
  });

  it("completes search engine choices for --engine", async () => {
    const items = await zshComplete(
      "devtools",
      "web",
      "search",
      "hello",
      "--engine",
      "",
    );
    expect(items).toContain("brave");
  });

  it("escapes colons in completion specs", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: zsh shell patterns
    expect(completionScript).toContain("${name//:/\\\\:}");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: zsh shell patterns
    expect(completionScript).toContain("${desc//:/\\\\:}");
  });

  it("escapes backslashes in completion specs", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: zsh shell patterns
    expect(completionScript).toContain("${name//\\\\/\\\\\\\\}");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: zsh shell patterns
    expect(completionScript).toContain("${desc//\\\\/\\\\\\\\}");
  });

  it("returns exit code 0 when completions are found", async () => {
    const script = [
      completionScript.replace(/^compdef .*/m, ""),
      cliShim,
      "_describe() {",
      '  while [[ "$1" == -* ]]; do',
      '    case "$1" in -[oOt]) shift; shift;; *) shift;; esac',
      "  done",
      "  return 0",
      "}",
      "",
      'words=("devtools" "")',
      "CURRENT=2",
      "_devtools",
      'echo "EXIT:$?"',
    ].join("\n");

    const result = await execa("zsh", ["-c", script]);
    expect(result.stdout).toContain("EXIT:0");
  });
});
