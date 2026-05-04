import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    maxWorkers: "90%",
    testTimeout: 20_000,
    exclude: ["./node_modules/*", "./dist/*"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      reporter: ["text", "lcov"],
    },
  },
});
