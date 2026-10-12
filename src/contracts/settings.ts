export type ModelCategory = "llm" | "video" | "voice" | "local_gpu";

export interface ProviderConfigField {
  key: string;
  label: string;
  type: "password" | "text" | "number" | "select";
  envKey: string;
  placeholder?: string;
  options?: string[];
  value?: string;
  isMasked?: boolean;
  helpText?: string;
}

export interface ModelProviderInfo {
  id: string;
  name: string;
  category: ModelCategory;
  badge: string;
  icon: string;
  description: string;
  isConfigured: boolean;
  status: "connected" | "unconfigured" | "error" | "testing";
  latencyMs?: number;
  statusMessage?: string;
  fields: ProviderConfigField[];
  extraInfo?: Record<string, unknown>;
}

export interface ProbeResult {
  success: boolean;
  latencyMs: number;
  message: string;
  details?: Record<string, unknown>;
}
