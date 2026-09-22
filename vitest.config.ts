import { defineConfig } from "vitest/config";

const unit = ["src/utils/**/*.test.ts", "src/config.test.ts", "src/render/script-schema.test.ts", "src/series/series-schema.test.ts", "src/series/pacing-calculator.test.ts", "src/server/settings-manager.test.ts"];

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ["src/test-setup.ts"],
    environment: "node",
    include: ["src/**/*.test.ts"],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 30000,
    projects: [
      { extends: true, test: { name: "unit", include: unit } },
      { extends: true, test: { name: "integration", include: ["src/**/*.test.ts"], exclude: unit } },
    ],
  },
});
