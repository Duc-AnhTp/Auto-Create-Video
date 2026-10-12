import {checkExecution} from './execution-control.js';
import {evaluateCanonGate} from '../domain/canon-gate.js';
import {approveEpisodeForCanon,commitEpisodeCanon} from './canon-commit.js';
import {errorCode} from '../../../platform/workflow-error.js';


import { join } from "node:path";

import { type EpisodeSummaryRecord, type NarrativeDelta } from "../../../contracts/story.js";

import { log } from "../../../platform/observability/logger.js";

import type { EpisodeDependencies } from "../ports/episode-dependencies.js";

import { type EpisodeOptions, type EpisodeResult } from "../ports/episode-options.js";

import type { FinalizeProductionInput } from "./phases/contracts.js";
export class FinalizeProduction {
constructor(private dependencies:Pick<EpisodeDependencies,"bible"|"orchestrator"|"faceQa"|"narrativeDelta"|"checkpoints">){}
async execute(input:FinalizeProductionInput,options:EpisodeOptions):Promise<EpisodeResult> {
const ctx=this.dependencies;
let script = structuredClone(input.script);
let job = structuredClone(input.job);
let provider = input.provider;
let mockTts = input.mockTts;
let seriesId = input.seriesId;
let outputDir = input.outputDir;
let finalVideoPath = input.finalVideoPath;
let audioPath = input.audioPath;
let auditPassed = input.auditPassed;
let faceQaWarnCount = input.faceQaWarnCount;
let faceQaFailCount = input.faceQaFailCount;
let faceQaUnavailableCount = input.faceQaUnavailableCount;
let beatCoveragePassed = input.beatCoveragePassed;
let beatCoverageStatus = input.beatCoverageStatus;
let missingMandatoryBeatIds = input.missingMandatoryBeatIds;
log.step(7, 8, "Ghi nhận tiến trình cốt truyện vào Story Bible SQLite");
    await checkExecution(options);
    options.onProgress?.(7, 8, "Ghi nhận tiến trình cốt truyện vào Story Bible SQLite");
    let committedCanon = false;

    // Strict Canon Commit gating (Requirement A & G):
    // Mock, dry-run, skipRender CANNOT mutate production canon under any circumstances.
    let shouldCommit = false;
    const lifecycle = ctx.bible.getEpisodeLifecycle(seriesId, script.episodeNumber);

    const allShots = script.scenes.flatMap((s) => s.shots);
    const unapprovedCanonShots = allShots.filter((sh) => {
      const approved = ctx.bible.getApprovedTakeForShot(seriesId, script.episodeNumber, sh.shotId);
      return !approved || provider!=="mock"&&approved.provider==="mock";
    });

    const ledger = ctx.orchestrator.getLedger().getLedgerSummary(seriesId);
    const blockers=evaluateCanonGate({mockMedia:provider==='mock'||Boolean(options.dryRun||options.skipRender),mockAudio:mockTts,mockVisualQa:Boolean(ctx.faceQa.backend.isMockBackend),
      auditPassed,faceWarnings:faceQaWarnCount,faceFailures:faceQaFailCount,faceUnavailable:faceQaUnavailableCount,unapprovedShots:unapprovedCanonShots.length,
      beatCoveragePassed:beatCoveragePassed&&beatCoverageStatus!=='FAIL'&&beatCoverageStatus!=='ERROR',billingUncertain:ledger.uncertainAttemptCount>0,budgetExceeded:ledger.totalCommittedUsd>ledger.maxBudgetUsd});
    if(blockers.length) {
      log.warn('[CANON COMMIT BLOCKED] '+blockers.join(', '));
      if(blockers.includes('BEAT_COVERAGE_FAILED'))ctx.bible.setEpisodeLifecycle({seriesId,episodeNumber:script.episodeNumber,status:'draft',needsReview:true,reviewNotes:`Story beat coverage status: ${beatCoverageStatus}. Missing: ${missingMandatoryBeatIds.join(', ')}`});
    } else {
      try {approveEpisodeForCanon(ctx.bible,seriesId,script.episodeNumber,'automatic',{autoCommit:options.autoCommitCanon,requireApproval:options.requireApproval,storyboardRequired:options.storyboardReviewRequired});shouldCommit=true;}
      catch(error) {if(!['CANON_APPROVAL_REQUIRED','STORYBOARD_APPROVAL_REQUIRED'].includes(errorCode(error)??''))throw error;log.warn('[CANON COMMIT BLOCKED] '+String(error));}
    }

    if (shouldCommit) {
      const delta: NarrativeDelta = options.narrativeDelta || ctx.narrativeDelta(script);
      const deltaObj = delta;
      const majorEvents = deltaObj.major_events || (script.logline ? [script.logline] : ["Hoàn thành tập phim"]);
      const summaryRecord: EpisodeSummaryRecord = {
        series_id: seriesId,
        episode_number: script.episodeNumber,
        title: script.title,
        logline: script.logline,
        major_events: majorEvents,
        delta_changes: {...deltaObj},
        created_at: new Date().toISOString(),
      };

      commitEpisodeCanon(ctx.bible,summaryRecord,delta,'automatic');
      committedCanon = true;
      job.status = "completed";
      job.currentPhase = "committed";
      job.canonCommitted = true;
      job.qaPassed = auditPassed;
      log.info("  Story Bible đã được cập nhật trạng thái mới cho các tập kế tiếp!");
    } else {
      job.canonCommitted = false;
      job.qaPassed = auditPassed;
      if (provider === "mock") {
        job.status = "completed";
        job.currentPhase = "mock_completed";
        log.info("  [MOCK MODE] Bỏ qua commit Story Bible vì đang ở chế độ mock. Giữ nguyên trạng thái canon hiện tại.");
      } else if (options.dryRun) {
        job.status = "completed";
        job.currentPhase = "mock_completed";
        log.info("  [DRY-RUN] Bỏ qua commit Story Bible vì đang ở chế độ dry-run.");
      } else {
        job.status = "needs_review";
        job.currentPhase = "assembled_pending_review";
        log.info("  [APPROVAL REQUIRED] Bản dựng đã hoàn tất nhưng chưa commit Story Bible (chờ đạo diễn phê duyệt). Trạng thái: needs_review.");
      }
    }

    await ctx.checkpoints.save(outputDir, job);

    log.step(8, 8, `HOÀN THÀNH TẬP ${script.episodeNumber}!`);
    await checkExecution(options);
    options.onProgress?.(8, 8, `HOÀN THÀNH TẬP ${script.episodeNumber}!`);
    return {
      episodeNumber: script.episodeNumber,
      title: script.title,
      script,
      videoPath: finalVideoPath,
      audioPath: audioPath || "",
      outputDir,
      auditPassed,
      isMock: provider === "mock",
      committedCanon,
    };
  
}
}
