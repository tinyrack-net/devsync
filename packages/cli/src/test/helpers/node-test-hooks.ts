import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = fileURLToPath(new URL("../../../", import.meta.url));
const sourceRoot = resolve(packageRoot, "src");

const isSourceFile = (filePath: string) => {
  return filePath === sourceRoot || filePath.startsWith(`${sourceRoot}/`);
};

const toSourceUrl = (relativePath: string) => {
  return pathToFileURL(resolve(sourceRoot, relativePath)).href;
};

registerHooks({
  resolve: (specifier, context, nextResolve) => {
    if (specifier.startsWith("#app/") && specifier.endsWith(".js")) {
      return {
        shortCircuit: true,
        url: toSourceUrl(`${specifier.slice("#app/".length, -3)}.ts`),
      };
    }

    if (
      context.parentURL !== undefined &&
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      specifier.endsWith(".js")
    ) {
      const parentPath = fileURLToPath(context.parentURL);

      if (isSourceFile(parentPath)) {
        const candidatePath = resolve(
          dirname(parentPath),
          `${specifier.slice(0, -3)}.ts`,
        );

        if (existsSync(candidatePath)) {
          return {
            shortCircuit: true,
            url: pathToFileURL(candidatePath).href,
          };
        }
      }
    }

    return nextResolve(specifier, context);
  },
});
