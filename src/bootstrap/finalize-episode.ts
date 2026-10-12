import { finalizeProduction, type FinalizeProductionOptions } from '../modules/production/application/finalize-service.js';
import { createMediaFactories } from './media-services.js';
export type { FinalizeProductionResult } from '../modules/production/application/finalize-service.js';
export function finalizeEpisodeProduction(options: Omit<FinalizeProductionOptions, 'media'>) {
    return finalizeProduction({ ...options, media: createMediaFactories() });
}
