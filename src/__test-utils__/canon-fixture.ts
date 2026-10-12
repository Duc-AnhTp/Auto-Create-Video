import type { StoryStore } from "../bootstrap/ports/workflow-store.js";
import type { NarrativeDelta } from "../contracts/story.js";
import type { EpisodeResult } from "../modules/production/ports/episode-options.js";

/** Explicit test data setup. Mock production itself must never commit canon. */
export function seedCanonFixture(bible:StoryStore,result:EpisodeResult,seriesId:string,delta:NarrativeDelta):void {
  bible.commitEpisode({series_id:seriesId,episode_number:result.episodeNumber,title:result.title,logline:result.script.logline,major_events:delta.major_events??delta.majorEvents??[],delta_changes:{...delta}},delta,{seriesId,force:true});
}
