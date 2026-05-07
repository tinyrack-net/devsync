import { createInterface } from "node:readline/promises";

export const ask = async (question: string): Promise<string> => {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
};
