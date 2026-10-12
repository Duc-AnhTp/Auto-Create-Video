import type { ApprovedTimeline } from '../../ports/approved-timeline.js';
import { log } from '../../../../platform/observability/logger.js';
import { WorkflowError } from '../../../../platform/workflow-error.js';
import type { ApproveEpisodeTakeStore } from "../../ports/studio/approve-episode-take-store.js";
export async function approveEpisodeTake(bible: ApproveEpisodeTakeStore, args: {
    body: {
        takeId: string;
        expectedQaReport?: string | null | undefined;
    };
    id: string;
    episode: number;
    shotId: string;
}, timeline?: ApprovedTimeline) {
    const { body, id, episode, shotId } = args;
    const take = bible.getShotTake(body.takeId);
    if (!take || take.series_id !== id || take.episode_number !== episode || !bible.getEquivalentShotIds(shotId).includes(take.shot_id))
        throw new WorkflowError("TAKE_NOT_FOUND", "TAKE_NOT_FOUND");
    if (body.expectedQaReport !== undefined && (take.qa_report_json ?? null) !== body.expectedQaReport)
        throw new WorkflowError("TAKE_VERSION_CONFLICT", "TAKE_VERSION_CONFLICT");
    bible.approveShotTake(body.takeId);
    const approved = bible.getShotTake(body.takeId);
    if (approved && timeline)
        try {
            await timeline.update(id, episode, shotId, approved);
        }
        catch (error) {
            log.warn('[TAKE TIMELINE] Approved take remains durable; preview update failed: ' + String(error));
        }
    return approved;
}
