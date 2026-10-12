import { WorkflowError } from "../../../platform/workflow-error.js";
import type { BackendProvider } from "../../../contracts/video.js";

export interface ExecutionPolicy {
  mode: "mock" | "production";
  provider: BackendProvider;
  isMock: boolean;
  allowMockMedia: boolean;
}
export function resolveExecutionPolicy(mode: "mock" | "production", provider?: BackendProvider): ExecutionPolicy {
  if (mode === "production" && (!provider || provider === "mock")) throw new WorkflowError("REAL_PROVIDER_REQUIRED", "REAL_PROVIDER_REQUIRED", "failed");
  return { mode, provider: mode === "mock" ? "mock" : provider!, isMock: mode === "mock", allowMockMedia: mode === "mock" };
}
export function resolveDemoPolicy(options: { provider?: BackendProvider; mockVideo?: boolean }): ExecutionPolicy {
  if (options.mockVideo === false || options.provider && options.provider !== "mock") {
    throw new WorkflowError("DEMO_ONLY", "DEMO_ONLY: Use EpisodeRuntime for real production with measured QA", "failed");
  }
  return resolveExecutionPolicy("mock", "mock");
}
