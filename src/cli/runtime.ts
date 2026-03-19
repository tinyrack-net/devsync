import {
  type CliServices,
  createDefaultCliServices,
} from "#app/cli/services.ts";

type CliRuntime = Readonly<{
  services: CliServices;
}>;

const cliRuntimeKey = Symbol.for("devtools.cliRuntime");

type GlobalWithCliRuntime = typeof globalThis & {
  [cliRuntimeKey]?: CliRuntime;
};

const readCliRuntime = () => {
  return (globalThis as GlobalWithCliRuntime)[cliRuntimeKey];
};

const writeCliRuntime = (runtime: CliRuntime | undefined) => {
  const globalWithCliRuntime = globalThis as GlobalWithCliRuntime;

  if (runtime === undefined) {
    delete globalWithCliRuntime[cliRuntimeKey];
    return;
  }

  globalWithCliRuntime[cliRuntimeKey] = runtime;
};

export const withCliRuntime = async <T>(
  runtime: CliRuntime,
  callback: () => Promise<T>,
) => {
  const previousRuntime = readCliRuntime();
  writeCliRuntime(runtime);

  try {
    return await callback();
  } finally {
    writeCliRuntime(previousRuntime);
  }
};

export const getCliServices = (): CliServices => {
  return readCliRuntime()?.services ?? createDefaultCliServices();
};
