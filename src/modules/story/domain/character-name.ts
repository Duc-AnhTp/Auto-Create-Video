export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export function buildCharacterNameRegex(name: string, suffixPattern = ""): RegExp {
  const escaped = escapeRegex(name);
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])${suffixPattern}`, "iu");
}
