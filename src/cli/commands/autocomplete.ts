import {
  type Application,
  buildCommand,
  buildRouteMap,
  proposeCompletions,
} from "@stricli/core";

import { type DevsyncCliContext, print } from "#app/cli/common.js";
import { output, writeStderr } from "#app/lib/output.js";

const AUTOCOMPLETE_COMMAND = "devsync __complete";
const BASH_MARKER_END = "# @stricli/auto-complete END";
const BASH_MARKER_START = "# @stricli/auto-complete START [devsync]";
const BASHRC_NAME = ".bashrc";
const COMPLETION_FUNCTION_NAME = "__devsync_complete";
const RESTART_MESSAGE =
  "Restart bash shell or run `source ~/.bashrc` to load changes.";
type EmptyFlags = Record<never, never>;

const bashAutocompleteCommand = buildCommand<EmptyFlags, [], DevsyncCliContext>(
  {
    docs: {
      brief: "Display bash autocomplete setup instructions",
      fullDescription:
        "Show how to enable bash autocomplete for devsync without changing your shell config automatically.",
    },
    func: () => {
      print(
        output(
          "Setup Instructions for DEVSYNC CLI Autocomplete",
          "",
          "To install bash autocomplete, run:",
          "  devsync autocomplete install",
          "",
          "To remove it later, run:",
          "  devsync autocomplete uninstall",
          "",
          "The installed bash hook will invoke:",
          `  ${AUTOCOMPLETE_COMMAND}`,
        ),
      );
    },
    parameters: {},
  },
);

const resolveCompletionInputs = (inputs: readonly string[]) => {
  const environment: NodeJS.ProcessEnv & { COMP_LINE?: string } = process.env;
  const completionLine = environment.COMP_LINE;

  if (completionLine === undefined) {
    return [...inputs];
  }

  const trimmedStart = completionLine.trimStart();

  if (trimmedStart === "") {
    return [];
  }

  const completionInputs = trimmedStart.split(/\s+/u);

  if (/\s$/u.test(completionLine)) {
    completionInputs.push("");
  }

  return completionInputs;
};

const isBashShell = (context: DevsyncCliContext) => {
  const environment: NodeJS.ProcessEnv & { SHELL?: string } =
    context.process.env;
  const shell = environment.SHELL;

  return shell?.includes("bash") ?? false;
};

const getBashRcPath = (context: DevsyncCliContext) => {
  return context.path.join(context.os.homedir(), BASHRC_NAME);
};

const readBashRcLines = async (context: DevsyncCliContext) => {
  const bashRcPath = getBashRcPath(context);

  try {
    const file = await context.fs.promises.readFile(bashRcPath, "utf8");

    return {
      bashRcPath,
      lines: file.split(/\n/u),
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      writeStderr("Expected to edit ~/.bashrc but file was not found.\n");
      return undefined;
    }

    throw error;
  }
};

const replaceManagedBlock = (
  lines: readonly string[],
  replacement: readonly string[],
) => {
  const startIndex = lines.indexOf(BASH_MARKER_START);

  if (startIndex < 0) {
    return [...lines, ...replacement];
  }

  const endIndex = lines.indexOf(BASH_MARKER_END, startIndex);
  const deleteCount =
    endIndex >= startIndex
      ? endIndex - startIndex + 1
      : lines.length - startIndex;

  return [
    ...lines.slice(0, startIndex),
    ...replacement,
    ...lines.slice(startIndex + deleteCount),
  ];
};

const removeManagedBlock = (lines: readonly string[]) => {
  const startIndex = lines.indexOf(BASH_MARKER_START);

  if (startIndex < 0) {
    return [...lines];
  }

  const endIndex = lines.indexOf(BASH_MARKER_END, startIndex);
  const deleteCount =
    endIndex >= startIndex
      ? endIndex - startIndex + 1
      : lines.length - startIndex;

  return [
    ...lines.slice(0, startIndex),
    ...lines.slice(startIndex + deleteCount),
  ];
};

const buildBashAutocompleteBlock = () => {
  return [
    BASH_MARKER_START,
    `${COMPLETION_FUNCTION_NAME}() { export COMP_LINE; COMPREPLY=( $(${AUTOCOMPLETE_COMMAND} $COMP_LINE) ); return 0; }`,
    `complete -o default -o nospace -F ${COMPLETION_FUNCTION_NAME} devsync`,
    BASH_MARKER_END,
  ];
};

const installBashAutocomplete = async (context: DevsyncCliContext) => {
  if (!isBashShell(context)) {
    writeStderr("Skipping bash as shell was not detected.\n");
    return;
  }

  const bashRc = await readBashRcLines(context);

  if (bashRc === undefined) {
    return;
  }

  await context.fs.promises.writeFile(
    bashRc.bashRcPath,
    replaceManagedBlock(bashRc.lines, buildBashAutocompleteBlock()).join("\n"),
  );
  print(output(RESTART_MESSAGE));
};

const uninstallBashAutocomplete = async (context: DevsyncCliContext) => {
  if (!isBashShell(context)) {
    writeStderr("Skipping bash as shell was not detected.\n");
    return;
  }

  const bashRc = await readBashRcLines(context);

  if (bashRc === undefined) {
    return;
  }

  await context.fs.promises.writeFile(
    bashRc.bashRcPath,
    removeManagedBlock(bashRc.lines).join("\n"),
  );
  print(output(RESTART_MESSAGE));
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
        brief: "Manage shell autocomplete support",
        fullDescription:
          "Display setup instructions or install/uninstall bash autocomplete support for devsync.",
      },
      routes: {
        bash: bashAutocompleteCommand,
        install: buildCommand<EmptyFlags, [], DevsyncCliContext>({
          docs: {
            brief: "Install bash autocomplete support",
            fullDescription:
              "Add a managed bash completion block to ~/.bashrc so devsync can provide shell completion suggestions.",
          },
          func: async function () {
            await installBashAutocomplete(this);
          },
          parameters: {},
        }),
        uninstall: buildCommand<EmptyFlags, [], DevsyncCliContext>({
          docs: {
            brief: "Remove bash autocomplete support",
            fullDescription:
              "Remove the managed devsync bash completion block from ~/.bashrc if it has been installed before.",
          },
          func: async function () {
            await uninstallBashAutocomplete(this);
          },
          parameters: {},
        }),
      },
    }),
    completeCommand: buildCompleteCommand(getApplication),
  };
};
