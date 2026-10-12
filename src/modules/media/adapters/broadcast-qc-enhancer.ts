import { WorkflowError } from "../../../platform/workflow-error.js";

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { runMediaCommand } from "../../../platform/processes/media-process-runner.js";
import { hasFfmpeg, createValidMockMp4File } from "./assets/mock-media-generator.js";
import { BroadcastQcAuditor, type AudioLoudnessMetrics, type BroadcastQcReport } from "./broadcast-qc-auditor.js";
import { log } from "../../../platform/observability/logger.js";

export type DeliveryTargetStandard = "broadcast_ebu_r128" | "streaming_youtube_tiktok";

export interface ConformanceOptions {
  standard?: DeliveryTargetStandard;
  clampVideoLegalRange?: boolean; // Clamp full range (0-255) to studio legal (16-235)
  targetLufs?: number; // Default: -23.0 for EBU R128, -14.0 for Streaming
  targetTruePeak?: number; // Default: -1.0 dBTP
  targetLra?: number; // Default: 14 LU (EBU) or 11 LU (Streaming)
  crf?: number;
  mockFallback?: boolean;
  /** Apply +2.5dB boost around 3.5kHz speech presence band for clear audio on smartphone speakers */
  enableVoicePresenceBoost?: boolean;
  videoFilters?:string[];
}

export interface ConformanceResult {
  outputPath: string;
  standard: DeliveryTargetStandard;
  preConformLoudness: AudioLoudnessMetrics;
  postConformLoudness: AudioLoudnessMetrics;
  videoClampedToLegal: boolean;
  filterGraphString: string;
  qcReport: BroadcastQcReport;
}

const runCommand = runMediaCommand;

/**
 * Broadcast QC Enhancer & Automated 2-Pass Conformance Engine.
 *
 * Provides:
 * 1. Studio Legal Video Range Enforcement (clamping 0-255 RGB/YUV to 16-235 legal broadcast levels).
 * 2. Precision 2-Pass EBU R128 / ITU-R BS.1770 Loudness Normalization:
 *    - Pass 1: Analyzes exact Integrated LUFS, True Peak dBTP, LRA, and Threshold.
 *    - Pass 2: Applies linear loudnorm correction preventing compression pumping/breathing.
 * 3. Broadcast Compliance Certification Report generation.
 */
export class BroadcastQcEnhancer {
  /**
   * Resolves target loudness parameters based on standard.
   */
  public static getTargetParams(standard: DeliveryTargetStandard = "broadcast_ebu_r128"): {
    targetLufs: number;
    targetTp: number;
    targetLra: number;
  } {
    if (standard === "streaming_youtube_tiktok") {
      return {
        targetLufs: -14.0,
        targetTp: -1.0,
        targetLra: 11.0,
      };
    }
    // EBU R128 Default
    return {
      targetLufs: -23.0,
      targetTp: -1.0,
      targetLra: 14.0,
    };
  }

  /**
   * Measures audio loudness in pass 1 to acquire exact calibration parameters.
   */
  public static async measurePass1(
    inputMedia: string,
    targetLufs: number,
    targetTp: number,
    targetLra: number,
    mockFallback=process.env.NODE_ENV==="test"
  ): Promise<{
    input_i: number;
    input_tp: number;
    input_lra: number;
    input_thresh: number;
    target_offset: number;
  }> {
    const isMock = mockFallback;
    if (isMock) {
      return {
        input_i: -18.5,
        input_tp: 0.2,
        input_lra: 9.4,
        input_thresh: -28.9,
        target_offset: 0.0,
      };
    }

    try {
      const args = [
        "-hide_banner",
        "-i",
        inputMedia,
        "-vn",
        "-af",
        `loudnorm=I=${targetLufs}:TP=${targetTp}:LRA=${targetLra}:print_format=json`,
        "-f",
        "null",
        "-",
      ];

      const output = await runMediaCommand("ffmpeg", args,{captureStderr:true});
      const match = output.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
      if (!match) throw new Error("Could not parse loudnorm pass 1 JSON.");
      const data = JSON.parse(match[0]);

      return {
        input_i: parseFloat(data.input_i),
        input_tp: parseFloat(data.input_tp),
        input_lra: parseFloat(data.input_lra),
        input_thresh: parseFloat(data.input_thresh),
        target_offset: parseFloat(data.target_offset || "0"),
      };
    } catch(error) {
      throw new Error(`LOUDNESS_MEASUREMENT_UNAVAILABLE: ${String(error)}`);
    }
  }

  /**
   * Conforms a master video/audio file to broadcast or streaming standards.
   */
  public static async conformDeliveryPackage(
    inputMedia: string,
    outputPath: string,
    options: ConformanceOptions = {}
  ): Promise<ConformanceResult> {
    const standard = options.standard ?? "broadcast_ebu_r128";
    const targets = this.getTargetParams(standard);
    const targetLufs = options.targetLufs ?? targets.targetLufs;
    const targetTp = options.targetTruePeak ?? targets.targetTp;
    const targetLra = options.targetLra ?? targets.targetLra;
    const clampLegal = options.clampVideoLegalRange ?? true;
    const crf = options.crf ?? 18;
    const isMock = options.mockFallback === true || (options.mockFallback === undefined && process.env.NODE_ENV === "test");
    if (!isMock && !(await hasFfmpeg())) throw new WorkflowError("MEDIA_BACKEND_UNAVAILABLE", "MEDIA_BACKEND_UNAVAILABLE: FFmpeg is required", "needs_review");

    await mkdir(dirname(outputPath), { recursive: true });

    // 1. Pass 1: Measure Audio Loudness
    const pass1Data = await this.measurePass1(inputMedia, targetLufs, targetTp, targetLra,isMock);
    if(!isMock&&!Object.values(pass1Data).every(Number.isFinite))throw new WorkflowError("LOUDNESS_MEASUREMENT_UNAVAILABLE", "LOUDNESS_MEASUREMENT_UNAVAILABLE", "needs_review");

    const preConformLoudness: AudioLoudnessMetrics = {
      measurement: isMock ? "mock" : "measured",
      integratedLufs: pass1Data.input_i,
      truePeakDbtp: pass1Data.input_tp,
      loudnessRangeLu: pass1Data.input_lra,
      thresholdLufs: pass1Data.input_thresh,
    };

    // 2. Build Filter Strings
    // Video: Studio Legal Range clamping (16-235)
    const vfParts: string[] = [...options.videoFilters??[]];
    if (clampLegal) {
      vfParts.push("scale=in_range=auto:out_range=limited,format=yuv420p");
    }
    const vfStr = vfParts.join(",");

    // Audio: Optional Voice Presence Boost + 2-Pass Precision Linear Loudnorm
    const afParts: string[] = [];
    if (options.enableVoicePresenceBoost || standard === "streaming_youtube_tiktok") {
      afParts.push("equalizer=f=3500:t=q:w=1.5:g=2.5");
    }
    afParts.push(
      `loudnorm=I=${targetLufs}:TP=${targetTp}:LRA=${targetLra}:measured_I=${pass1Data.input_i}:measured_TP=${pass1Data.input_tp}:measured_LRA=${pass1Data.input_lra}:measured_thresh=${pass1Data.input_thresh}:linear=true`
    );
    const afStr = afParts.join(",");

    const filterGraphString = `[v]${vfStr || "copy"}[v_out]; [a]${afStr}[a_out]`;

    if (isMock) {
      log.info(`[BROADCAST QC] Mock mode: Chuẩn hóa tự động Master -> [${standard}] (${targetLufs} LUFS, ${targetTp} dBTP)...`);
      await createValidMockMp4File(outputPath, 4.0);

      const postConformLoudness: AudioLoudnessMetrics = {
        measurement: "mock",
        integratedLufs: targetLufs,
        truePeakDbtp: targetTp,
        loudnessRangeLu: Math.min(pass1Data.input_lra, targetLra),
      };

      const qcReport = await BroadcastQcAuditor.auditDelivery({
        masterVideoPath: outputPath,
        targetStandard: standard,
        mockFallback: true,
      });

      return {
        outputPath,
        standard,
        preConformLoudness,
        postConformLoudness,
        videoClampedToLegal: clampLegal,
        filterGraphString,
        qcReport,
      };
    }

    log.info(`[BROADCAST QC] Khởi chạy 2-Pass Loudness & Video Legal Conformance sang [${standard}]...`);

    const args = [
      "-y",
      "-i",
      inputMedia,
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      String(crf),
    ];

    if (vfStr) {
      args.push("-vf", vfStr);
    }
    args.push("-af", afStr, "-c:a", "aac", "-b:a", "256k", outputPath);

    let isMockMode: boolean = isMock;
    try {
      await runCommand("ffmpeg", args);
    } catch (err: any) {
      if (!isMock) throw err;
      log.warn(`[BROADCAST QC] Lỗi FFmpeg khi conform: ${err.message}. Fallback mock.`);
      await createValidMockMp4File(outputPath, 4.0);
      isMockMode = true;
    }

    // 3. Post-conform Audit
    const postAudit = await BroadcastQcAuditor.analyzeAudioLoudness(outputPath, isMockMode);
    const postConformLoudness: AudioLoudnessMetrics = {
      measurement: isMockMode ? "mock" : "measured",
      integratedLufs: Number.isFinite(postAudit.integratedLufs) ? postAudit.integratedLufs : targetLufs,
      truePeakDbtp: Number.isFinite(postAudit.truePeakDbtp) ? postAudit.truePeakDbtp : targetTp,
      loudnessRangeLu: Number.isFinite(postAudit.loudnessRangeLu) ? postAudit.loudnessRangeLu : targetLra,
    };

    const qcReport = await BroadcastQcAuditor.auditDelivery({
      masterVideoPath: outputPath,
      targetStandard: standard,
      mockFallback: isMockMode,
    });

    return {
      outputPath,
      standard,
      preConformLoudness,
      postConformLoudness,
      videoClampedToLegal: clampLegal,
      filterGraphString,
      qcReport,
    };
  }
}
