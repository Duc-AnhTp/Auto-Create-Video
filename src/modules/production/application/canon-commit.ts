import type {EpisodeSummaryRecord,NarrativeDelta,EpisodeLifecycleRecord} from '../../../contracts/story.js';
import type {FinalizeServiceStore} from '../ports/finalize-service-store.js';
import {WorkflowError} from '../../../platform/workflow-error.js';
export type CanonCommitStore=Pick<FinalizeServiceStore,'commitEpisode'|'getEpisodeLifecycle'|'setEpisodeLifecycle'>;
export function assertDirectorLifecycle(lifecycle:EpisodeLifecycleRecord|null):void {
 if(lifecycle&&!['draft','rendered','unrendered','script_generated','approved','committed'].includes(lifecycle.status))throw new WorkflowError('LIFECYCLE_GATE_FAILED',`Lifecycle '${lifecycle.status}' requires an explicit reset before finalization`,'needs_review');
}
export function approveEpisodeForCanon(store:CanonCommitStore, seriesId:string, episodeNumber:number, approval:'automatic'|'director', options:{autoCommit?:boolean;requireApproval?:boolean;storyboardRequired?:boolean}={}): EpisodeLifecycleRecord | null {
 const lifecycle=store.getEpisodeLifecycle(seriesId,episodeNumber);
 if(approval==='director') {
  if(lifecycle?.status==='committed')return lifecycle;
  assertDirectorLifecycle(lifecycle);
  if(lifecycle?.status!=='approved')store.setEpisodeLifecycle({seriesId,episodeNumber,status:'approved',needsReview:false,reviewNotes:'director_approval'});
 } else {
  if(options.requireApproval||options.autoCommit===false)throw new WorkflowError('CANON_APPROVAL_REQUIRED','Director approval is required','needs_review');
  if(!lifecycle)store.setEpisodeLifecycle({seriesId,episodeNumber,status:'approved',needsReview:false});
  else if(lifecycle.status!=='approved')throw new WorkflowError('CANON_APPROVAL_REQUIRED','Episode lifecycle is not approved','needs_review');
  if(options.storyboardRequired&&!lifecycle?.storyboard_approved_at)throw new WorkflowError('STORYBOARD_APPROVAL_REQUIRED','Storyboard approval is required','needs_review');
 }
 return store.getEpisodeLifecycle(seriesId,episodeNumber);
}
export function commitEpisodeCanon(store:CanonCommitStore, summary:EpisodeSummaryRecord,delta:NarrativeDelta,approval:'automatic'|'director') {
 return store.commitEpisode(summary,delta,{seriesId:summary.series_id,...(approval==='director'?{confirmationSource:'director_approval' as const,force:false}:{})});
}
