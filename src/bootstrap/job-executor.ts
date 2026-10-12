import type { ExecutionContext } from '../contracts/execution.js';
export interface WorkerExecutionContext extends Required<Pick<ExecutionContext, 'signal' | 'checkpoint' | 'assertOwnership'>> {
    publish?: (work: () => void) => void;
    progress: (step: number, total: number, message: string) => void;
}
import { WorkflowError } from "../platform/workflow-error.js";
import { join } from "node:path";
import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { SqliteStoryStore } from "./sqlite-story-store.js";
import { ArtifactStore } from "../modules/media/adapters/artifact-store.js";
import { probeVideoFile } from "../modules/media/adapters/media-validator.js";
import { withMediaContext, assertMediaOwnership, publishMediaRename } from "../platform/processes/media-process-runner.js";
import { EpisodeRuntime } from "./episode-runtime.js";
import { SeasonOrchestrator } from "./season-runtime.js";
import { CinematicPostPipeline } from "../modules/media/application/cinematic-post-pipeline.js";
import { ProjectPaths } from "../platform/filesystem/project-paths.js";
import { hashFile } from "../modules/media/adapters/artifact-store.js";
import { renderFingerprint } from "../modules/media/adapters/artifact-cache.js";
import type { StudioJob } from "../contracts/requests.js";
import type { ProviderDispatchStore } from "../modules/production/adapters/sqlite/provider-dispatch-store.js";
export async function executeProductionJob(job: StudioJob, context: WorkerExecutionContext, dependencies: {
    dispatchStore: ProviderDispatchStore;
}): Promise<{
    result: NonNullable<StudioJob["result"]>;
    ready: boolean;
}> {
    return withMediaContext({ signal: context.signal, publish: context.publish, durationSec: 720, checkpoint: context.checkpoint, assertOwnership: context.assertOwnership, acquireEncode: () => dependencies.dispatchStore.acquireResource("media:encode", 1, context.signal) }, async () => {
        const request = job.request;
        if (request.kind === "postprocess") {
            const bible = new SqliteStoryStore(join("data", "series", request.seriesId, "story_bible.db"));
            try {
                const store = new ArtifactStore(bible);
                const input = await store.resolve(request.inputArtifactId, request.seriesId, request.episodeNumber);
                if (input.sha256 !== request.inputSha256 || input.mode !== request.mode)
                    throw new WorkflowError("ARTIFACT_CHANGED", "ARTIFACT_CHANGED", "failed");
                const output = new ProjectPaths().postprocessOutput(request.seriesId, request.episodeNumber, job.id), staging = join(output, "staging-" + randomUUID()), complete = join(output, "complete");
                const fingerprint = renderFingerprint({ input: input.sha256, mode: input.mode, options: request.options });
                if (existsSync(complete)) {
                    const candidate = join(complete, "master_delivery.mp4");
                    const probe = await probeVideoFile(candidate);
                    const manifest = await readFile(join(complete, "delivery-manifest.json"), "utf8").then(JSON.parse).catch(() => null);
                    if (probe.isValid && manifest?.fingerprint === fingerprint && manifest.sha256 === await hashFile(candidate)) {
                        const ready = manifest.ready === true, qaStatus = manifest.qaStatus;
                        const artifact = await store.register(candidate, { seriesId: request.seriesId, episodeNumber: request.episodeNumber, kind: "delivery", mode: input.mode, approved: ready });
                        return { ready, result: { videoPath: candidate, audioPath: "", outputDir: complete, isMock: input.mode === "mock", qaStatus, artifactIds: [artifact.id], postprocess: manifest.postprocess } };
                    }
                    throw new WorkflowError("DELIVERY_REVIEW_REQUIRED", "DELIVERY_REVIEW_REQUIRED", "needs_review");
                }
                await mkdir(staging, { recursive: true });
                context.progress(1, 4, "Chuẩn bị hậu kỳ");
                const result = await withMediaContext({ signal: context.signal, durationSec: Number(input.probe?.durationSec ?? 720), checkpoint: context.checkpoint, assertOwnership: context.assertOwnership, acquireEncode: () => dependencies.dispatchStore.acquireResource("media:encode", 1, context.signal) }, () => CinematicPostPipeline.executePostPipeline({ ...request.options, seriesId: request.seriesId, episodeNumber: request.episodeNumber, inputMasterVideoPath: input.path, outputDir: staging, mockFallback: input.mode === "mock", checkpoint: context.checkpoint, onStage: (step, name) => context.progress(step, 4, name) }));
                const finalStage = join(staging, "master_delivery.mp4");
                if (result.artifacts.finalDeliveryMasterPath !== finalStage)
                    await copyFile(result.artifacts.finalDeliveryMasterPath, finalStage);
                const deliveryProbe=await probeVideoFile(finalStage);
                if (!deliveryProbe.isValid)throw new WorkflowError("DELIVERY_MEDIA_INVALID", "DELIVERY_MEDIA_INVALID: "+deliveryProbe.error, "failed");
                const ready = input.mode === "mock" || result.status === "SUCCESS", qaStatus = input.mode === "mock" ? "MOCK" : ready ? "PASS" : "NEEDS_REVIEW";
                const relocated = JSON.parse(JSON.stringify(result).split(staging.replace(/\\/g, "\\\\")).join(complete.replace(/\\/g, "\\\\"))) as Record<string, unknown>;
                await writeFile(join(staging, "delivery-manifest.json"), JSON.stringify({ fingerprint, sha256: await hashFile(finalStage), ready, qaStatus, postprocess: relocated }));
                await context.checkpoint();
                assertMediaOwnership();
                publishMediaRename(staging, complete);
                assertMediaOwnership();
                const videoPath = join(complete, "master_delivery.mp4");
                const artifact = await store.register(videoPath, { seriesId: request.seriesId, episodeNumber: request.episodeNumber, kind: "delivery", mode: input.mode, approved: ready });
                return { ready, result: { videoPath, audioPath: "", outputDir: complete, isMock: input.mode === "mock", qaStatus, artifactIds: [artifact.id], postprocess: relocated } };
            }
            finally {
                bible.close();
            }
        }
        if (request.kind === "season" && request.season) {
            const runner = new SeasonOrchestrator(join("data", "series", request.seriesId, "story_bible.db"), { orchestratorOptions: { dispatchStore: dependencies.dispatchStore, signal: context.signal, checkpoint: context.checkpoint, parentJobId: job.id } });
            try {
                const seasonOptions = request.season;
                const result = await runner.produceSeason({ seriesId: request.seriesId, ...seasonOptions, provider: request.provider, dryRun: request.mode === "mock", mockTts: request.mode === "mock", allowMockMedia: request.mode === "mock", resume: request.resume, regenerateAudio: request.regenerateAudio, budgetCapUsd: request.budgetCapUsd, hedge: request.hedge, commitCanon: request.mode === "production", requireApproval: seasonOptions.approvalPolicy === "manual", continueOnError: false, useHierarchicalAssembly: true, checkpoint: context.checkpoint, onEpisodeComplete: ep => context.progress(ep.episodeNumber, seasonOptions.toEpisode, `Tập ${ep.episodeNumber}: ${ep.status}`) });
                await context.checkpoint();
                const ready = result.success && result.progress.status === "completed", artifactIds: string[] = [];
                for (const ep of result.progress.episodes)
                    if (ep.outputPath && existsSync(ep.outputPath)) {
                        const artifact = await new ArtifactStore(runner.getBible()).register(ep.outputPath, { seriesId: request.seriesId, episodeNumber: ep.episodeNumber, kind: "master", mode: request.mode, approved: request.mode === "mock" || ["completed", "canon_committed", "approved"].includes(ep.status) });
                        artifactIds.push(artifact.id);
                    }
                return { ready, result: { videoPath: result.progress.episodes.at(-1)?.outputPath ?? "", audioPath: "", outputDir: join("data", "series", request.seriesId), isMock: request.mode === "mock", qaStatus: request.mode === "mock" ? "MOCK" : ready ? "PASS" : "NEEDS_REVIEW", artifactIds, evidencePaths: result.seasonMasterReportPath ? [result.seasonMasterReportPath] : [], costLedger: result.progress.costLedger, season: result } };
            }
            finally {
                runner.close();
            }
        }
        const pipeline = new EpisodeRuntime(join("data", "series", request.seriesId, "story_bible.db"), { orchestratorOptions: { dispatchStore: dependencies.dispatchStore, signal: context.signal, checkpoint: context.checkpoint, parentJobId: job.id } });
        try {
            if (request.targetShotId) {
                await context.checkpoint();
                context.progress(1, 2, `Tái tạo shot ${request.targetShotId}`);
                const outputDir = new ProjectPaths().episodeOutput(request.seriesId, request.episodeNumber);
                const take = await pipeline.rerollShot({
                    operationId: job.id, seriesId: request.seriesId, episodeNumber: request.episodeNumber,
                    shotId: request.targetShotId, promptOverride: request.promptOverride,
                    provider: request.provider, dryRun: request.mode === "mock", outputDir,
                    budgetCapUsd: request.budgetCapUsd, hedge: request.hedge, maxReRolls: request.maxReRolls,
                    remuxAfterReroll: false,
                });
                await context.checkpoint();
                const ledger = pipeline.getOrchestrator().getLedger().getLedgerSummary(request.seriesId);
                const artifact = await new ArtifactStore(pipeline.getBible()).register(take.videoPath, {
                    seriesId: request.seriesId, episodeNumber: request.episodeNumber,
                    kind: "shot", mode: request.mode, approved: take.isApproved,
                });
                context.progress(2, 2, `Take ${take.takeId} đang chờ duyệt`);
                return { ready: false, result: {
                    videoPath: take.videoPath, audioPath: "", outputDir, isMock: request.mode === "mock",
                    reroll: { shotId: take.shotId, takeId: take.takeId, isApproved: take.isApproved },
                    qaStatus: "NEEDS_REVIEW", artifactIds: [artifact.id],
                    financialStatus: ledger.uncertainAttemptCount > 0 ? "uncertain" : ledger.confirmedEstimatedCostUsd > 0 ? "estimated" : "settled",
                    costLedger: { estimated: ledger.estimatedCostUsd, reserved: ledger.reservedCostUsd, confirmed: ledger.confirmedCostUsd, confirmedInvoiced: ledger.confirmedInvoicedCostUsd, confirmedEstimated: ledger.confirmedEstimatedCostUsd, uncertain: ledger.uncertainCostUsd },
                } };
            }
            const result = await pipeline.produceEpisode(request.rawScreenplay, { seriesId: request.seriesId, provider: request.provider, expectedEpisodeNumber: request.episodeNumber, dryRun: request.mode === "mock", mockTts: request.mode === "mock", allowMockMedia: request.mode === "mock", resume: request.resume, regenerateAudio: request.regenerateAudio, budgetCapUsd: request.budgetCapUsd, maxReRolls: request.maxReRolls, hedge: request.hedge, commitCanon: request.mode === "production", exportResolution: request.exportResolution, useHierarchicalAssembly: true, signal: context.signal, assertOwnership: context.assertOwnership, checkpoint: context.checkpoint, onProgress: context.progress });
            await context.checkpoint();
            const ledger = pipeline.getOrchestrator().getLedger().getLedgerSummary(request.seriesId);
            const ready = result.auditPassed && Boolean(result.videoPath) && (result.isMock || result.committedCanon) && ledger.uncertainAttemptCount === 0;
            const artifactIds: string[] = [];
            if (result.videoPath && existsSync(result.videoPath)) {
                const artifact = await new ArtifactStore(pipeline.getBible()).register(result.videoPath, { seriesId: request.seriesId, episodeNumber: request.episodeNumber, kind: "master", mode: result.isMock ? "mock" : "production", approved: ready });
                artifactIds.push(artifact.id);
            }
            return { ready, result: { videoPath: result.videoPath, audioPath: result.audioPath, outputDir: result.outputDir, isMock: result.isMock, qaStatus: result.isMock ? "MOCK" : ready ? "PASS" : "NEEDS_REVIEW", artifactIds, evidencePaths: [join(result.outputDir, "qa_evidence")], financialStatus: ledger.uncertainAttemptCount > 0 ? "uncertain" : ledger.confirmedEstimatedCostUsd > 0 ? "estimated" : "settled", costLedger: { estimated: ledger.estimatedCostUsd, reserved: ledger.reservedCostUsd, confirmed: ledger.confirmedCostUsd, confirmedInvoiced: ledger.confirmedInvoicedCostUsd, confirmedEstimated: ledger.confirmedEstimatedCostUsd, uncertain: ledger.uncertainCostUsd } } };
        }
        finally {
            pipeline.close();
        }
    });
}
