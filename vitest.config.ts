import { defineConfig } from "vitest/config";

const unit = ["src/utils/**/*.test.ts", "src/config.test.ts", "src/render/script-schema.test.ts", "src/series/series-schema.test.ts", "src/series/pacing-calculator.test.ts", "src/server/settings-manager.test.ts"];

const shared = {
    globals: true,
    setupFiles: ["src/test-setup.ts"],
    environment: "node",
    pool: "forks" as const,
    fileParallelism: false,
    testTimeout: 30000,
};
export default defineConfig({
  test: { fileParallelism: false, projects: [
    { test: { ...shared, name: "unit", include: unit } },
    { test: { ...shared, name: "integration", include: ["src/**/*.test.ts"], exclude: unit } },
  ] },
});
