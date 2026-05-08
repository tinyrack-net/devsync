import type { Stream } from "./logger.ts";
import { color, SYMBOLS } from "./theme.ts";

export interface Spinner {
  succeed(text: string): void;
  fail(text: string): void;
  warn(text: string): void;
  stop(): void;
}

const envValue = (name: string) =>
  (process.env as Record<string, string | undefined>)[name];
const isCI = Boolean(
  envValue("CI") ?? envValue("NO_COLOR") ?? envValue("FORCE_COLOR") === "0",
);

const createSpinner = (stream: Stream, text: string): Spinner => {
  const frames = SYMBOLS.spinner;
  let frameIndex = 0;
  let intervalId: ReturnType<typeof setInterval> | undefined;
  let running = true;

  const clear = () => {
    if (stream.isTTY && stream.clearLine && stream.cursorTo) {
      stream.clearLine(0);
      stream.cursorTo(0);
    }
  };

  const writeLine = (msg: string) => {
    clear();
    stream.write(`${msg}\n`);
  };

  const render = () => {
    if (!running) return;
    clear();
    stream.write(
      `${color.info(frames[frameIndex] ?? frames[0])} ${color.dim(text)}`,
    );
    frameIndex = (frameIndex + 1) % frames.length;
  };

  if (stream.isTTY && !isCI) {
    intervalId = setInterval(render, 80);
    render();
  } else {
    stream.write(`${color.dim(SYMBOLS.bullet)} ${color.dim(text)}\n`);
  }

  return {
    succeed: (msg: string) => {
      running = false;
      if (intervalId !== undefined) clearInterval(intervalId);
      writeLine(`${color.success(SYMBOLS.success)} ${color.success(msg)}`);
    },
    fail: (msg: string) => {
      running = false;
      if (intervalId !== undefined) clearInterval(intervalId);
      writeLine(`${color.error(SYMBOLS.error)} ${color.error(msg)}`);
    },
    warn: (msg: string) => {
      running = false;
      if (intervalId !== undefined) clearInterval(intervalId);
      writeLine(`${color.warn(SYMBOLS.warn)} ${color.warn(msg)}`);
    },
    stop: () => {
      running = false;
      if (intervalId !== undefined) clearInterval(intervalId);
      clear();
    },
  };
};

export { createSpinner };
