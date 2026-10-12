import { defineConfig } from "vitest/config";

const unit = ["src/platform/**/*.test.ts", "src/bootstrap/config.test.ts", "src/modules/media/adapters/render/script-schema.test.ts", "src/contracts/episode.test.ts", "src/modules/media/application/pacing-calculator.test.ts", "src/modules/projects/adapters/settings.test.ts"];
const media=["src/modules/media/adapters/assembly/**/*.test.ts","src/modules/media/adapters/assets/**/*.test.ts","src/modules/media/adapters/**/*.test.ts","src/modules/production/adapters/qa/system-invariants.test.ts","src/modules/production/application/production-verification.test.ts","src/modules/production/application/broadcast-post-processing.test.ts","src/modules/production/application/media-cache-regression.test.ts"];

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
    { test: { ...shared, name: "unit", include: unit,fileParallelism:true } },
    { test: { ...shared, name: "frontend",include:["studio/**/*.test.ts"] } },
    { test: { ...shared, name: "media", include:media,maxWorkers:1 } },
    { test: { ...shared, name: "integration", include: ["src/**/*.test.ts", "tests/rerender.test.ts"], exclude: [...unit,...media] } },
  ] },
});
