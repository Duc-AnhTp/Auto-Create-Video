import { getProviderRequestContext } from "../application/dispatch/provider-request-context.js";
import { countRuntime } from "../../../platform/observability/runtime-metrics.js";
export interface HttpRetryOptions {
  /** Maximum number of attempts including the first call. Default: 3 */
  maxAttempts?: number;
  /** Initial delay before first retry in milliseconds. Default: 1000 */
  initialDelayMs?: number;
  /** Maximum backoff delay in milliseconds. Default: 10000 */
  maxDelayMs?: number;
  /** Exponential backoff multiplier. Default: 2.0 */
  factor?: number;
  /** Random jitter added to delay in milliseconds. Default: 300 */
  jitterMs?: number;
  /** Whether to add randomized jitter to backoff delay. Default: true */
  jitter?: boolean;
  /** HTTP status codes that trigger a retry. Default: [429, 500, 502, 503, 504] */
  retryOnStatus?: number[];
  /** Callback hook on each retry attempt */
  onRetry?: (err: any, attempt: number, delayMs: number) => void;
}

const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ERR_NETWORK",
]);

/**
 * Executes an asynchronous HTTP operation with exponential backoff, jitter,
 * and automatic parsing of the HTTP 429 'Retry-After' header.
 */
export async function withHttpRetry<T>(
  operation: () => Promise<T>,
  options: HttpRetryOptions = {}
): Promise<T> {
  const maxAttempts = getProviderRequestContext()?.kind === "submit" ? 1 : (options.maxAttempts ?? 3);
  const initialDelayMs = options.initialDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 10000;
  const factor = options.factor ?? 2.0;
  const jitterEnabled = options.jitter ?? true;
  const jitterMs = jitterEnabled ? (options.jitterMs ?? 300) : 0;
  const retryOnStatus = new Set(options.retryOnStatus ?? [429, 500, 502, 503, 504]);

  let attempt = 0;

  while (true) {
    attempt++;
    try {
      return await operation();
    } catch (err: any) {
      if(err?.response?.status===429)countRuntime("http429");
      if (attempt >= maxAttempts) {
        throw err;
      }

      const status = err?.response?.status;
      const code = err?.code;
      const isTransientStatus = status !== undefined && retryOnStatus.has(status);
      const isTransientCode = code !== undefined && TRANSIENT_NETWORK_CODES.has(code);
      const isTimeout = err?.message?.toLowerCase().includes("timeout");

      if (!isTransientStatus && !isTransientCode && !isTimeout) {
        // Non-transient error (e.g. 400 Bad Request, 401 Unauthorized, 403 Forbidden)
        throw err;
      }

      // Check Retry-After header on HTTP 429
      let delayMs = 0;
      const retryAfterHeader = err?.response?.headers?.["retry-after"];
      if (retryAfterHeader) {
        const retryAfterNum = Number(retryAfterHeader);
        if (!isNaN(retryAfterNum) && retryAfterNum > 0) {
          delayMs = retryAfterNum * 1000;
        } else {
          const parsedDate = Date.parse(retryAfterHeader);
          if (!isNaN(parsedDate)) {
            delayMs = Math.max(0, parsedDate - Date.now());
          }
        }
      }

      if (delayMs <= 0) {
        const baseDelay = initialDelayMs * Math.pow(factor, attempt - 1);
        const randomJitter = Math.random() * jitterMs;
        delayMs = Math.min(maxDelayMs, baseDelay + randomJitter);
      }

      countRuntime("retry");
      options.onRetry?.(err, attempt, delayMs);

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
