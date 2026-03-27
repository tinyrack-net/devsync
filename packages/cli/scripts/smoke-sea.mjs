import { fileURLToPath } from "node:url";
import packageJson from "../package.json" with { type: "json" };

import {
  captureCommand,
  ensureSeaBuilderNode,
  repositoryRoot,
  runNodeScript,
  seaExecutablePath,
} from "./sea-common.mjs";

const buildSeaScriptPath = fileURLToPath(
  new URL("./build-sea.mjs", import.meta.url),
);
const smokeEnvironment = {
  FORCE_COLOR: "0",
  NODE_NO_WARNINGS: "1",
  NODE_OPTIONS: "",
  NO_COLOR: "1",
};

const assertCommandSucceeded = (label, result) => {
  if (result.exitCode === 0) {
    return;
  }

  const signalSuffix =
    result.signal === null ? "" : `, signal: ${result.signal}`;

  throw new Error(
    `${label} failed with exit code ${result.exitCode}${signalSuffix}.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
};

const assertIncludes = (label, actual, expected) => {
  if (actual.includes(expected)) {
    return;
  }

  throw new Error(
    `${label} did not include ${JSON.stringify(expected)}.\nactual output:\n${actual}`,
  );
};

const assertEmpty = (label, actual) => {
  if (actual === "") {
    return;
  }

  throw new Error(
    `${label} was expected to be empty.\nactual output:\n${actual}`,
  );
};

const runSeaExecutable = (args) => {
  return captureCommand(seaExecutablePath, args, {
    cwd: repositoryRoot,
    env: smokeEnvironment,
  });
};

ensureSeaBuilderNode();

console.log("Building SEA executable for smoke test...");
await runNodeScript(buildSeaScriptPath, [], {
  cwd: repositoryRoot,
});

const versionResult = runSeaExecutable(["--version"]);
assertCommandSucceeded("SEA --version", versionResult);
assertIncludes(
  "SEA --version stdout",
  versionResult.stdout,
  `devsync/${packageJson.version}`,
);
assertEmpty("SEA --version stderr", versionResult.stderr);

const rootHelpResult = runSeaExecutable([]);
assertCommandSucceeded("SEA root help", rootHelpResult);
assertIncludes("SEA root help", rootHelpResult.stdout, "autocomplete");
assertIncludes("SEA root help", rootHelpResult.stdout, "track");
assertIncludes("SEA root help", rootHelpResult.stdout, "profile");
assertEmpty("SEA root help stderr", rootHelpResult.stderr);

const trackHelpResult = runSeaExecutable(["track", "--help"]);
assertCommandSucceeded("SEA track --help", trackHelpResult);
assertIncludes("SEA track --help", trackHelpResult.stdout, "--mode");
assertIncludes("SEA track --help", trackHelpResult.stdout, "--profile");
assertEmpty("SEA track --help stderr", trackHelpResult.stderr);

const profileHelpResult = runSeaExecutable(["profile", "use", "--help"]);
assertCommandSucceeded("SEA profile use --help", profileHelpResult);
assertIncludes(
  "SEA profile use --help",
  profileHelpResult.stdout,
  "Profile name to activate",
);
assertEmpty("SEA profile use --help stderr", profileHelpResult.stderr);

const removedCommandResult = runSeaExecutable(["add", "~/.gitconfig"]);

if (removedCommandResult.exitCode === 0) {
  throw new Error(
    `SEA removed command unexpectedly succeeded.\nstdout:\n${removedCommandResult.stdout}\nstderr:\n${removedCommandResult.stderr}`,
  );
}

assertIncludes(
  "SEA removed command stderr",
  removedCommandResult.stderr,
  "not found",
);

console.log(`SEA smoke test passed with ${seaExecutablePath}`);
