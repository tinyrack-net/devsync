import { emitKeypressEvents } from "node:readline";

const readPipedSecret = async () => {
  let buffer = "";

  process.stdin.setEncoding("utf8");

  for await (const chunk of process.stdin) {
    buffer += chunk;
  }

  return buffer.replace(/\r?\n$/, "");
};

export const promptForSecret = async (message: string) => {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    return await readPipedSecret();
  }

  const stdin = process.stdin;
  const stderr = process.stderr;
  const previousRawMode = stdin.isRaw ?? false;
  let value = "";

  emitKeypressEvents(stdin);
  stdin.setEncoding("utf8");
  stdin.setRawMode(true);
  stdin.resume();
  stderr.write(message);

  return await new Promise<string>((resolve, reject) => {
    const cancelError = new Error("Age key prompt cancelled.");

    const cleanup = () => {
      stdin.removeListener("keypress", onKeypress);
      stdin.setRawMode(previousRawMode);
      stdin.pause();
      stderr.write("\n");
    };

    const onKeypress = (character: string, key: { name?: string }) => {
      if (character === "\u0003" || character === "\u0004") {
        cleanup();
        reject(cancelError);
        return;
      }

      if (
        key.name === "escape" ||
        key.name === "tab" ||
        key.name === "delete" ||
        key.name === "up" ||
        key.name === "down" ||
        key.name === "left" ||
        key.name === "right"
      ) {
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        cleanup();
        resolve(value);
        return;
      }

      if (key.name === "backspace") {
        if (value.length > 0) {
          value = value.slice(0, -1);
          stderr.write("\b \b");
        }

        return;
      }

      if (character >= " " && character !== "\u007f") {
        value += character;
        stderr.write("*");
      }
    };

    stdin.on("keypress", onKeypress);
  });
};
