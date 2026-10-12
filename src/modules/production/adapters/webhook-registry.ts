import {normalizeWebhookPayload} from '../domain/webhook-payload.js';
import { WorkflowError } from "../../../platform/workflow-error.js";
import type { VideoJobStatus } from "../../../contracts/video.js";


interface PendingWebhookEntry {
  resolve: (status: VideoJobStatus) => void;
  reject: (err: Error) => void;
  timeoutTimer: NodeJS.Timeout;
  provider: string;
  registeredAt: number;
}

/**
 * Registry for asynchronous provider webhook callbacks.
 * Enables Dual-Mode: allows real AI providers to push instant completion notifications,
 * bypassing polling latency while keeping polling as a reliable fallback.
 */
export class ProviderWebhookRegistry {
  private pendingJobs: Map<string, PendingWebhookEntry> = new Map();

  /**
   * Registers a job as awaiting an external webhook callback.
   * If the webhook is not received before timeoutMs, rejects with a timeout error.
   */
  public waitForWebhook(
    jobId: string,
    provider: string,
    timeoutMs = 300000 // 5 minutes default
  ): Promise<VideoJobStatus> {
    return new Promise<VideoJobStatus>((resolve, reject) => {
      // Clean up previous registration for same jobId if any
      this.cancel(jobId, provider);

      const timeoutTimer = setTimeout(() => {
        this.pendingJobs.delete(`${provider}:${jobId}`);
        reject(new Error(`Webhook callback timed out after ${timeoutMs}ms for job ${jobId}`));
      }, timeoutMs);
      timeoutTimer.unref();

      this.pendingJobs.set(`${provider}:${jobId}`, {
        resolve,
        reject,
        timeoutTimer,
        provider,
        registeredAt: Date.now(),
      });
    });
  }

  /**
   * Receives and dispatches an incoming webhook payload from a video provider.
   * Returns true if a pending job matched and was resolved.
   */
  public receiveWebhook(provider: string, payload: unknown): boolean {
    const status=normalizeWebhookPayload(payload);if(!status)return false;
    const pending=this.pendingJobs.get(`${provider}:${status.jobId}`);if(!pending)return false;
    clearTimeout(pending.timeoutTimer);this.pendingJobs.delete(`${provider}:${status.jobId}`);
    if(status.status==="failed")pending.reject(new Error(status.error));else pending.resolve(status);
    return true;
  }

  /**
   * Cancels a pending webhook registration.
   */
  public cancel(jobId: string, provider?: string): void {
    for (const [key, pending] of this.pendingJobs) {
      if (key !== `${pending.provider}:${jobId}` || provider && pending.provider !== provider) continue;
      clearTimeout(pending.timeoutTimer);
      this.pendingJobs.delete(key);
      pending.reject(new WorkflowError("WEBHOOK_CANCELLED", "WEBHOOK_CANCELLED", "failed"));
    }
  }

  /**
   * Returns count of jobs currently awaiting webhook callbacks.
   */
  public getPendingCount(): number {
    return this.pendingJobs.size;
  }
}

/** Global default webhook registry instance */
export const defaultWebhookRegistry = new ProviderWebhookRegistry();

