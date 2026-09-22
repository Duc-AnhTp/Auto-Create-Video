/** Remove configured secrets from diagnostics before they cross a UI/log boundary. */
export function redact(value: string): string {
  let result = value;
  for (const [key, secret] of Object.entries(process.env)) {
    if (/(KEY|TOKEN|SECRET|PASSWORD)/i.test(key) && secret && secret.length >= 4) result = result.split(secret).join("[REDACTED]");
  }
  return result.replace(/(Bearer\s+)[^\s"']+/gi, "$1[REDACTED]");
}
