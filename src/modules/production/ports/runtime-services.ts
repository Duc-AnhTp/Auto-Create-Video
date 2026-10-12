import type {JobStore} from '../adapters/sqlite/job-store.js';
import type {ProviderDispatchStore} from '../adapters/sqlite/provider-dispatch-store.js';
import type {ProviderWebhookRegistry} from '../adapters/webhook-registry.js';
import type {EnqueueMediaJob} from '../application/media-jobs.js';
/** Public operations; connection ownership stays in the composition root. */
export type JobQueue = Pick<JobStore,Exclude<keyof JobStore,'close'>>;
export type DispatchCoordination = Pick<ProviderDispatchStore,Exclude<keyof ProviderDispatchStore,'close'>>;
export type WebhookReceiver = Pick<ProviderWebhookRegistry,'receiveWebhook'>;
export type MediaJobs = Pick<EnqueueMediaJob,'enqueue'|'enqueueLegacy'>;
