import { WorkflowError } from "../../../platform/workflow-error.js";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  SuperResolutionEngine,
  type SuperResolutionOptions,
  type SuperResolutionResult,
} from "../adapters/super-resolution.js";
import { CdlGradingEngine, type AscCdl, type CinematicPresetName, type CdlGradeOptions, type CdlGradeResult } from "../adapters/cdl-grading-engine.js";
import { SpatialFoleyEngine, type SpatialAudioCue, type SpatialFoleyResult } from "../adapters/audio/spatial-foley-engine.js";
import { BroadcastQcEnhancer, type ConformanceResult, type DeliveryTargetStandard } from "../adapters/broadcast-qc-enhancer.js";
import { createValidMockMp4File } from "../adapters/assets/mock-media-generator.js";
import { log } from "../../../platform/observability/logger.js";
import { runFfmpeg } from "../adapters/ffmpeg.js";

export interface MasterPostProcessingOptions {
  seriesId: string;
  episodeNumber: number;
  inputMasterVideoPath: string;
  outputDir?: string;
  aspectRatio?: "16:9" | "9:16" | "1:1";

  // Phase 1: 4K Super-Resolution
  enableSuperResolution?: boolean;
  resolutionStandard?: "4k" | "1080p";
  filmGrainIntensity?: number; // 0.0 to 1.0 (default 0.15)
  unsharpStrength?: number;

  // Phase 2: ASC CDL Color Grading
  enableCdlGrading?: boolean;
  cdlPreset?: CinematicPresetName;
  customCdl?: Partial<AscCdl>;

  // Phase 3: Spatial Action Foley
  enableSpatialFoley?: boolean;
  foleyCues?: SpatialAudioCue[];

  // Phase 4: Broadcast QC & Conformance
  enableBroadcastConformance?: boolean;
  deliveryStandard?: DeliveryTargetStandard;
  clampLegalRange?: boolean;

  mockFallback?: boolean;
  checkpoint?:()=>Promise<void>;
  onStage?:(step:number,name:string)=>void;
}

export interface MasterPostProcessingResult {
  status: "SUCCESS" | "WARN" | "FAIL";
  isMock: boolean;
  seriesId: string;
  episodeNumber: number;
  stagesCompleted: string[];
  superResolution?: SuperResolutionResult;
  colorGrading?: CdlGradeResult;
  spatialFoley?: SpatialFoleyResult;
  conformance?: ConformanceResult;
  artifacts: {
    upscaledVideoPath?: string;
    gradedVideoPath?: string;
    lutCubePath?: string;
    cdlXmlPath?: string;
    spatialFoleyStemPath?: string;
    finalDeliveryMasterPath: string;
    qcReportPath?: string;
  };
}

/**
 * Unified Broadcast Cinematic Post-Processing Pipeline.
 *
 * Coordinates 4 post-production disciplines into an automated Hollywood delivery workflow:
 * 1. 4K Lanczos4/Unsharp optical upscaling with organic film grain synthesis.
 * 2. ASC CDL mathematical color grading with 33x33x33 3D LUT (.cube) and DaVinci Resolve CDL XML export.
 * 3. Action Foley V2A audio synthesis with constant-power spatial panning and acoustic distance falloff.
 * 4. Precision 2-Pass EBU R128 / ITU-R BS.1770 loudness conformance and studio legal range clamping.
 */
export class CinematicPostPipeline {
  /**
   * Executes the full end-to-end cinematic post-processing pipeline.
   */
  public static async executePostPipeline(
    options: MasterPostProcessingOptions
  ): Promise<MasterPostProcessingResult> {
    const { seriesId, episodeNumber } = options;
    const baseDir =
      options.outputDir || join("data", "series", seriesId, `ep_${episodeNumber}_cinematic_post`);
    await mkdir(baseDir, { recursive: true });

    log.info(`[CINEMATIC POST] Khởi chạy Cinematic Post Pipeline cho Series [${seriesId}] - Tập ${episodeNumber}...`);

    const isMock = options.mockFallback === true;
    let currentVideoPath = options.inputMasterVideoPath;
    if (!existsSync(currentVideoPath)) {
      if (!isMock) throw new WorkflowError("INPUT_MEDIA_REQUIRED", "INPUT_MEDIA_REQUIRED: Master video is missing", "failed");
      log.warn(`[CINEMATIC POST] Video đầu vào không tồn tại tại: ${currentVideoPath}. Tạo mock video để tiến hành.`);
      await createValidMockMp4File(currentVideoPath, 5.0);
    }

    const stagesCompleted: string[] = [];
    const fuse=!isMock&&process.env.MEDIA_FILTER_FUSION!=="0";
    const videoFilters:string[]=[];
    let srResult: SuperResolutionResult | undefined;
    let cdlResult: CdlGradeResult | undefined;
    let foleyResult: SpatialFoleyResult | undefined;
    let confResult: ConformanceResult | undefined;

    const artifacts: MasterPostProcessingResult["artifacts"] = {
      finalDeliveryMasterPath: currentVideoPath,
    };

    // ── Stage 1: 4K Super-Resolution Upscaling ───────────────────────────────
    if (options.enableSuperResolution !== false) {
      await options.checkpoint?.();options.onStage?.(1,"Nâng độ phân giải");
      log.info(`[CINEMATIC POST] [Stage 1] 4K Super-Resolution Upscaling...`);
      const upscaledPath = join(baseDir, `master_ep_${episodeNumber}_4k.mp4`);
      const srOptions:SuperResolutionOptions={
        targetStandard: options.resolutionStandard || "4k",
        aspectRatio: options.aspectRatio || "16:9",
        filmGrainIntensity: options.filmGrainIntensity ?? 0.15,
        unsharpStrength: options.unsharpStrength ?? 0.8,
        bitDepth: 10,
        colorSpace: "bt709",
        mockFallback: options.mockFallback,
      };
      if(fuse){const dimensions=SuperResolutionEngine.computeTargetDimensions(srOptions.aspectRatio,srOptions.targetStandard);const filter=SuperResolutionEngine.buildFfmpegFilterGraph(dimensions,srOptions);videoFilters.push(filter);srResult={outputPath:upscaledPath,outputResolution:dimensions,algorithmUsed:"lanczos4",bitDepth:10,colorSpace:"bt709",hasFilmGrain:(srOptions.filmGrainIntensity??0)>0,filterGraphString:filter};}
      else srResult=await SuperResolutionEngine.upscaleVideo(currentVideoPath,upscaledPath,srOptions);

      if(!fuse)currentVideoPath = srResult.outputPath;
      artifacts.upscaledVideoPath = srResult.outputPath;
      stagesCompleted.push("super_resolution_4k");
    }

    // ── Stage 2: ASC CDL Color Grading & 3D LUT Generation ───────────────────
    if (options.enableCdlGrading !== false) {
      await options.checkpoint?.();options.onStage?.(2,"Chỉnh màu");
      const preset = options.cdlPreset || "kodak_2383";
      log.info(`[CINEMATIC POST] [Stage 2] ASC CDL Color Grading [${preset}]...`);
      const gradedPath = join(baseDir, `master_ep_${episodeNumber}_graded.mp4`);

      const gradeOptions:CdlGradeOptions={
        customCdl: options.customCdl,
        outputLutPath: join(baseDir, `cinematic_${preset}_3d.cube`),
        outputXmlPath: join(baseDir, `cinematic_${preset}_cdl.xml`),
        mockFallback: options.mockFallback,
      };
      cdlResult=fuse?await CdlGradingEngine.prepareGrade(gradedPath,preset,gradeOptions):await CdlGradingEngine.applyCdlGrade(currentVideoPath,gradedPath,preset,gradeOptions);
      if(fuse)videoFilters.push(cdlResult.filterGraphString);

      if(!fuse)currentVideoPath = cdlResult.outputPath;
      artifacts.gradedVideoPath = cdlResult.outputPath;
      artifacts.lutCubePath = cdlResult.lutPath;
      artifacts.cdlXmlPath = cdlResult.xmlPath;
      stagesCompleted.push(`cdl_grading_${preset}`);
    }

    // ── Stage 3: Spatial Action Foley Synthesis & Panning ────────────────────
    const shouldEnableSpatialFoley =
      options.enableSpatialFoley !== undefined
        ? options.enableSpatialFoley
        : isMock; // Only default true in mock mode; in production requires explicit opt-in

    if (shouldEnableSpatialFoley) {
      await options.checkpoint?.();options.onStage?.(3,"Âm thanh không gian");
      if (!isMock && !options.mockFallback) {
        throw new WorkflowError("SPATIAL_FOLEY_DELIVERY_UNAVAILABLE", "SPATIAL_FOLEY_DELIVERY_UNAVAILABLE: Stem mixing into delivery master is not configured", "needs_review");
      }
      log.info(`[CINEMATIC POST] [Stage 3] Action Foley V2A Spatial Audio Synthesis...`);
      const foleyStemPath = join(baseDir, `spatial_foley_stem_ep_${episodeNumber}.mp3`);
      const cues = options.foleyCues || this.getDefaultSpatialCues(episodeNumber);

      foleyResult = await SpatialFoleyEngine.renderSpatialFoleyTrack(
        currentVideoPath,
        cues,
        foleyStemPath,
        {
          mockFallback: options.mockFallback,
        }
      );

      artifacts.spatialFoleyStemPath = foleyResult.outputPath;
      stagesCompleted.push("spatial_foley_panning");
    }

    // ── Stage 4: Broadcast QC & 2-Pass Conformance ───────────────────────────
    if (options.enableBroadcastConformance !== false) {
      await options.checkpoint?.();options.onStage?.(4,"Kiểm định delivery");
      const std = options.deliveryStandard || "broadcast_ebu_r128";
      log.info(`[CINEMATIC POST] [Stage 4] Broadcast QC & 2-Pass Conformance [${std}]...`);
      const deliveryMasterPath = join(baseDir, `master_ep_${episodeNumber}_delivery.mp4`);

      confResult = await BroadcastQcEnhancer.conformDeliveryPackage(
        currentVideoPath,
        deliveryMasterPath,
        {
          standard: std,
          clampVideoLegalRange: options.clampLegalRange ?? true,
          videoFilters,
          mockFallback: options.mockFallback,
        }
      );

      currentVideoPath = confResult.outputPath;
      artifacts.finalDeliveryMasterPath = confResult.outputPath;
      if(fuse){if(srResult){srResult.outputPath=currentVideoPath;artifacts.upscaledVideoPath=currentVideoPath;}if(cdlResult){cdlResult.outputPath=currentVideoPath;artifacts.gradedVideoPath=currentVideoPath;}stagesCompleted.push("fused_video_filters");}

      // Save QC report artifact
      const qcJsonPath = join(baseDir, `broadcast_qc_report_ep_${episodeNumber}.json`);
      await writeFile(qcJsonPath, JSON.stringify(confResult.qcReport, null, 2), "utf8");
      artifacts.qcReportPath = qcJsonPath;

      stagesCompleted.push("broadcast_qc_conformance");
    } else {
      if(fuse&&videoFilters.length){const path=join(baseDir,`master_ep_${episodeNumber}_fused.mp4`);await runFfmpeg(["-y","-i",currentVideoPath,"-vf",videoFilters.join(","),"-c:v","libx264","-preset","fast","-crf","18","-c:a","copy",path]);currentVideoPath=path;if(srResult){srResult.outputPath=path;artifacts.upscaledVideoPath=path;}if(cdlResult){cdlResult.outputPath=path;artifacts.gradedVideoPath=path;}stagesCompleted.push("fused_video_filters");}
      artifacts.finalDeliveryMasterPath = currentVideoPath;
    }

    log.info(`[CINEMATIC POST] Hoàn tất 4 giai đoạn hậu kỳ điện ảnh! Master: ${artifacts.finalDeliveryMasterPath}`);

    return {
      status: isMock || (confResult && !confResult.qcReport.overallPassed) ? "WARN" : "SUCCESS",
      isMock,
      seriesId,
      episodeNumber,
      stagesCompleted,
      superResolution: srResult,
      colorGrading: cdlResult,
      spatialFoley: foleyResult,
      conformance: confResult,
      artifacts,
    };
  }

  /**
   * Generates balanced default spatial audio cues if not provided explicitly.
   */
  private static getDefaultSpatialCues(episodeNumber: number): SpatialAudioCue[] {
    return [
      {
        id: `cue_ep${episodeNumber}_footsteps`,
        actionPrompt: "Nhịp bước chân dứt khoát trên sàn đá cẩm thạch",
        sourceX: -0.65, // Left-biased
        distance: "medium",
        offsetSec: 0.5,
        durationSec: 3.5,
        baseVolume: 0.75,
      },
      {
        id: `cue_ep${episodeNumber}_door`,
        actionPrompt: "Tiếng then cửa sắt kim loại mở nặng nề",
        sourceX: 0.80, // Far right
        distance: "close_up",
        offsetSec: 2.0,
        durationSec: 2.5,
        baseVolume: 0.85,
      },
      {
        id: `cue_ep${episodeNumber}_impact`,
        actionPrompt: "Tiếng va đập đồ vật trong không gian rộng",
        sourceX: 0.0, // Center
        distance: "wide",
        offsetSec: 4.0,
        durationSec: 2.0,
        baseVolume: 0.60,
      },
    ];
  }
}
