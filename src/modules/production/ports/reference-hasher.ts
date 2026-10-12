export interface ReferenceHasher {
  hash(value?: string, signal?: AbortSignal): Promise<string | null>;
}
