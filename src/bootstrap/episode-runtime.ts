import {FileAudioGenerationStore} from '../modules/production/adapters/filesystem/audio-generation-store.js';
import {log} from '../platform/observability/logger.js';
import { createMediaFactories } from './media-services.js';
import { createEpisodeVideoGateway } from "./video-gateway.js";
import { SqliteStoryStore } from "./sqlite-story-store.js";
import { type NarrativeDelta } from "../contracts/story.js";
import { VideoModelGateway } from "../modules/production/application/dispatch/video-gateway.js";
import { type BackendProvider, type ShotExecutionSpec } from "../contracts/video.js";
import { ResilientJobOrchestrator } from "./shot-orchestrator.js";
import { FaceQaEvaluator } from "../modules/production/adapters/qa/face-evaluator.js";
import { AssemblyEpisodeUseCase } from "../modules/production/application/assembly-episode-use-case.js";
import { AudioAssembler } from "./audio-assembler.js";
import { EpisodeProductionUseCase } from "../modules/production/application/episode-production-use-case.js";
import { NarrativeDeltaBuilder } from "../modules/production/application/narrative-delta-builder.js";
import { type EpisodeOptions, type EpisodeResult } from "../modules/production/ports/episode-options.js";
import { FileCheckpointStore } from "../modules/production/adapters/filesystem/checkpoint-store.js";
import { type EpisodeProductionJob, type EpisodicScript } from "../contracts/episode.js";
import { ShotQaUseCase } from "../modules/production/application/shot-qa-use-case.js";
import { FileRerollReservationStore } from "../modules/production/adapters/filesystem/reroll-reservation-store.js";
export * from "../modules/production/application/episode-fingerprints.js";
export * from "../modules/production/ports/episode-options.js";
export class EpisodeRuntime {
    private checkpoints: FileCheckpointStore;
    private shotQaUseCase: ShotQaUseCase;
    private assemblyEpisodeUseCase: AssemblyEpisodeUseCase;
    private narrativeDeltaBuilder: NarrativeDeltaBuilder;
    private episodeProductionUseCase: EpisodeProductionUseCase;
    private ownsBible: boolean;
    private biblePath: string;
    private bible: SqliteStoryStore;
    private gateway: VideoModelGateway;
    private audioAssembler: AudioAssembler;
    private faceQa: FaceQaEvaluator;
    private orchestrator: ResilientJobOrchestrator;
    constructor(bibleOrPath: string | SqliteStoryStore = "story_bible.db", options?: {
        faceQa?: FaceQaEvaluator;
        gateway?: VideoModelGateway;
        orchestratorOptions?: import("../modules/production/application/dispatch/job-orchestrator.js").OrchestratorOptions;
    }) {
        this.ownsBible = typeof bibleOrPath === "string";
        if (bibleOrPath instanceof SqliteStoryStore) {
            this.bible = bibleOrPath;
            this.biblePath = bibleOrPath.getDbPath() || ":memory:";
        }
        else {
            this.biblePath = bibleOrPath;
            this.bible = new SqliteStoryStore(bibleOrPath);
        }
        this.gateway = options?.gateway ?? createEpisodeVideoGateway();
        this.audioAssembler = new AudioAssembler();
        this.faceQa = options?.faceQa || new FaceQaEvaluator();
        this.orchestrator = new ResilientJobOrchestrator(this.bible, this.gateway, options?.orchestratorOptions);
        this.checkpoints = new FileCheckpointStore(this.bible);
        this.assemblyEpisodeUseCase = new AssemblyEpisodeUseCase({ bible: this.bible, checkpoints: this.checkpoints });
        this.narrativeDeltaBuilder = new NarrativeDeltaBuilder({ bible: this.bible });
        this.shotQaUseCase = new ShotQaUseCase({ bible: this.bible, gateway: this.gateway, faceQa: this.faceQa, orchestrator: this.orchestrator, checkpoints: this.checkpoints, remux: (...args) => this.assemblyEpisodeUseCase.remuxEpisode(...args) }, new FileRerollReservationStore());
        this.episodeProductionUseCase = new EpisodeProductionUseCase({ audioGenerations: new FileAudioGenerationStore(), media: createMediaFactories(), bible: this.bible, gateway: this.gateway, audioAssembler: this.audioAssembler, faceQa: this.faceQa, orchestrator: this.orchestrator, checkpoints: this.checkpoints, remux: (...args) => this.assemblyEpisodeUseCase.remuxEpisode(...args), narrativeDelta: (...args) => this.narrativeDeltaBuilder.generateNarrativeDelta(...args), shots: this.shotQaUseCase });
    }
    public getBible(): SqliteStoryStore {
        return this.bible;
    }
    /**
     * Resolves character portrait image path from Story Bible.
     * If character lacks a reference portrait or file is missing, automatically invokes
     * ConceptArtGenerator to produce a high-fidelity concept art anchor with synthetic face embedding.
     */
    private async resolveCharacterFaceReference(characterId: string, seriesId: string, autoGenerate = false, allowMock = true): Promise<string | undefined> { return this.shotQaUseCase.resolveCharacterFaceReference(characterId, seriesId, autoGenerate, allowMock); }
    private async validateHedgeCandidate(path: string, spec: ShotExecutionSpec, options: EpisodeOptions): Promise<"PASS" | "FAIL" | "UNAVAILABLE"> { return this.shotQaUseCase.validateHedgeCandidate(path, spec, options); }
    public getOrchestrator(): ResilientJobOrchestrator {
        return this.orchestrator;
    }
    private closed = false;
    public close(): void {
        if (this.closed)
            return;
        this.closed = true;
        this.orchestrator.dispose();
        if (this.ownsBible && this.bible) {
            try {
                this.bible.close();
            }
            catch(error) {log.warn("[EPISODE DISPOSE] "+String(error));}
        }
    }
    /**
     * Loads checkpoint for an episode if it exists.
     */
    public async loadCheckpoint(outputDir: string): Promise<EpisodeProductionJob | null> { return this.checkpoints.load(outputDir); }
    /**
     * Saves checkpoint state to disk atomically via temporary file and rename.
     * Prevents corrupted JSON files upon sudden process interruption.
     */
    public async saveCheckpoint(outputDir: string, job: EpisodeProductionJob): Promise<void> { return this.checkpoints.save(outputDir, job); }
    /**
     * Runs the complete 8-step episodic production pipeline with checkpointing & resume support.
     */
    public async produceEpisode(rawScriptTextOrPath: string, options: EpisodeOptions = {}): Promise<EpisodeResult> { return this.episodeProductionUseCase.produceEpisode(rawScriptTextOrPath, options); }
    /**
     * Remuxes the full episode video from existing approved shot videos and audio soundtrack
     * without re-calling TTS or AI Video models.
     */
    public async remuxEpisode(outputDirOrOptions: string | {
        seriesId: string;
        episodeNumber: number;
        outputDir?: string;
        provider?: BackendProvider;
        skipRender?: boolean;
        transitionDurationSec?: number;
        dryRun?: boolean;
    }, optionsPositional?: {
        seriesId?: string;
        episodeNumber?: number;
        provider?: BackendProvider;
        skipRender?: boolean;
        transitionDurationSec?: number;
        dryRun?: boolean;
    }): Promise<{
        videoPath: string;
        audioPath: string;
        episodeNumber?: number;
    }> { return this.assemblyEpisodeUseCase.remuxEpisode(outputDirOrOptions, optionsPositional); }
    /**
     * Re-generates a single shot without re-generating any other shot in the episode.
     * Records a new take in Story Bible SQLite, updates the active take, and remuxes the episode.
     */
    public async rerollShot(options: {
        operationId?: string;
        seriesId: string;
        episodeNumber: number;
        shotId: string;
        provider?: BackendProvider;
        dryRun?: boolean;
        outputDir?: string;
        promptOverride?: string;
        remuxAfterReroll?: boolean;
        transitionDurationSec?: number;
        budgetCapUsd?: number;
        hedge?: EpisodeOptions["hedge"];
        maxReRolls?: number;
        preserveExistingApproval?: boolean;
        forceApprove?: boolean;
        autoGenerateMissingConceptArt?: boolean;
    }): Promise<{
        shotId: string;
        takeId: string;
        videoPath: string;
        isApproved: boolean;
    }> { return this.shotQaUseCase.rerollShot(options); }
    /**
     * Generates structured narrative delta from the normalized script and Bible state
     * when caller does not provide explicit options.narrativeDelta.
     */
    public generateNarrativeDelta(script: EpisodicScript): NarrativeDelta { return this.narrativeDeltaBuilder.generateNarrativeDelta(script); }
}
