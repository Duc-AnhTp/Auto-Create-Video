import type { EpisodeDependencies } from "../ports/episode-dependencies.js";
import type { EpisodeOptions, EpisodeResult } from "../ports/episode-options.js";
import { PrepareProduction } from "./prepare-production.js";
import { ProduceAudio } from "./produce-audio.js";
import { ProduceShots } from "./produce-shots.js";
import { EvaluateShots } from "./evaluate-shots.js";
import { AssembleProduction } from "./assemble-production.js";
import { FinalizeProduction } from "./finalize-production.js";
export class EpisodeProductionUseCase {
    private prepare: PrepareProduction;
    private audio: ProduceAudio;
    private shots: ProduceShots;
    private evaluate: EvaluateShots;
    private assembly: AssembleProduction;
    private finalize: FinalizeProduction;
    constructor(dependencies: EpisodeDependencies) {
        this.prepare = new PrepareProduction(dependencies);
        this.audio = new ProduceAudio(dependencies);
        this.shots = new ProduceShots(dependencies);
        this.evaluate = new EvaluateShots(dependencies);
        this.assembly = new AssembleProduction(dependencies);
        this.finalize = new FinalizeProduction(dependencies);
    }
    async produceEpisode(rawScriptTextOrPath: string, options: EpisodeOptions = {}): Promise<EpisodeResult> {
        const prepared = await this.prepare.execute({ rawScriptTextOrPath }, options);
        const audio = await this.audio.execute({ script: prepared.script, job: prepared.job, effectiveConfig: prepared.effectiveConfig, outputDir: prepared.outputDir, mockTts: prepared.mockTts }, options);
        const shots = await this.shots.execute({ script: audio.script, job: audio.job, visualDurations: audio.visualDurations, planningDurations: audio.planningDurations, provider: prepared.provider, outputDir: prepared.outputDir, seriesId: prepared.seriesId }, options);
        const evaluated = await this.evaluate.execute({ script: shots.script, job: shots.job, provider: prepared.provider, seriesId: prepared.seriesId, outputDir: prepared.outputDir, reusedShotIds: shots.reusedShotIds, videoShotsDir: shots.videoShotsDir, shotVideos: shots.shotVideos }, options);
        const assembled = await this.assembly.execute({ script: evaluated.script, job: evaluated.job, provider: prepared.provider, seriesId: prepared.seriesId, outputDir: prepared.outputDir, videoShotsDir: shots.videoShotsDir, shotVideos: evaluated.shotVideos, visualDurations: shots.visualDurations, effectiveConfig: prepared.effectiveConfig, audioPath: audio.audioPath, audioRes: audio.audioRes, audioDurationSec: audio.audioDurationSec, pacingReport: prepared.pacingReport, auditPassed: prepared.auditPassed }, options);
        if (assembled.kind === "skipped")
            return assembled.result;
        return this.finalize.execute({ script: assembled.value.script, job: assembled.value.job, provider: prepared.provider, mockTts: prepared.mockTts, seriesId: prepared.seriesId, outputDir: prepared.outputDir, finalVideoPath: assembled.value.finalVideoPath, audioPath: audio.audioPath, auditPassed: prepared.auditPassed, faceQaWarnCount: evaluated.faceQaWarnCount, faceQaFailCount: evaluated.faceQaFailCount, faceQaUnavailableCount: evaluated.faceQaUnavailableCount, beatCoveragePassed: assembled.value.beatCoveragePassed, beatCoverageStatus: assembled.value.beatCoverageStatus, missingMandatoryBeatIds: assembled.value.missingMandatoryBeatIds }, options);
    }
}
