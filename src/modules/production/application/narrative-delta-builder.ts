import { type NarrativeDelta } from "../../../contracts/story.js";
import { extractNarrativeDeltaFromScript } from "./episode-fingerprints.js";
import type { EpisodeDependencies } from "../ports/episode-dependencies.js";
import { type EpisodicScript } from "../../../contracts/episode.js";
export class NarrativeDeltaBuilder {
constructor(private dependencies:Pick<EpisodeDependencies,"bible">){}
public generateNarrativeDelta(script: EpisodicScript): NarrativeDelta {
    const ctx=this.dependencies;
    return extractNarrativeDeltaFromScript(script, ctx.bible, script.seriesId);
  }
}
