import { nleRoundTripConformer_conform, parseFcp7Xml } from '../../../media/index.js';
import type { NleWorkspace } from '../../ports/nle-workspace.js';
import type { ApproveConformedTakesStore } from '../../ports/studio/approve-conformed-takes-store.js';
import { approveConformedTakes } from './approve-conformed-takes.js';
import { UnifiedTimelineSchema } from '../../../../contracts/timeline.js';
import { WorkflowError } from '../../../../platform/workflow-error.js';

export async function conformEpisodeTimeline(
    dependencies: {
        workspace: NleWorkspace;
        withStore<T>(seriesId: string, action: (store: ApproveConformedTakesStore) => T | Promise<T>): Promise<T>;
    },
    request: { seriesId: string; episode: number; xmlContent: string; apply?: boolean },
) {
    const document = await dependencies.workspace.load(request.seriesId, request.episode);
    const result = nleRoundTripConformer_conform(document.timeline, parseFcp7Xml(request.xmlContent));
    if (request.apply) {
        if (!result.conformedTimeline.videoTrack.length) throw new WorkflowError("NLE_EMPTY_TIMELINE", "Không thể áp dụng timeline rỗng.", "needs_review");
        const validation = UnifiedTimelineSchema.safeParse(result.conformedTimeline);
        if (!validation.success) throw new WorkflowError("NLE_TIMELINE_INVALID", "Timeline conform không hợp lệ.", "needs_review");
        await document.publish(validation.data);
        if (result.diffReport.swappedTakes.length > 0) {
            await dependencies.withStore(request.seriesId, store => approveConformedTakes(store, {
                conformResult: result, id: request.seriesId, epNum: request.episode,
            }));
        }
    }
    return { success: true, ...result, applied: request.apply ?? false };
}
