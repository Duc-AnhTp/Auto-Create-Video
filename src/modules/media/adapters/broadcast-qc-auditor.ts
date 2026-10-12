import {log} from '../../../platform/observability/logger.js';
import { existsSync, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { isFfmpegAvailable, runFfprobe, runFfmpeg } from "./ffmpeg.js";


export interface AudioLoudnessMetrics {
  measurement: "measured" | "mock" | "unavailable";
  integratedLufs: number;
  truePeakDbtp: number;
  loudnessRangeLu: number;
  thresholdLufs?: number;
}

export interface BroadcastQcOptions {
  masterVideoPath: string;
  masterAudioPath?: string;
  dialogueStemPath?: string;
  bgmStemPath?: string;
  subtitleAssPath?: string;
  targetStandard?: "broadcast_ebu_r128" | "streaming_youtube_tiktok";
  mockFallback?: boolean;
  /** Aspect ratio of video, e.g. "9:16" or "16:9" */
  aspectRatio?: "9:16" | "16:9" | string;
  /** Duration of first shot in seconds, for 3-second hook retention verification */
  firstShotDurationSec?: number;
}

export interface QcCheckItem {
  id: string;
  name: string;
  category: "audio" | "video" | "subtitles" | "interchange";
  passed: boolean;
  value: string | number;
  benchmark: string;
  severity: "error" | "warning" | "info";
  detail?: string;
}

export interface BroadcastQcReport {
  evidence: "measured" | "mock" | "unavailable";
  timestamp: string;
  standard: "broadcast_ebu_r128" | "streaming_youtube_tiktok";
  overallPassed: boolean;
  broadcastCompliant: boolean;
  streamingCompliant: boolean;
  checks: QcCheckItem[];
  recommendations: string[];
}

/**
 * Broadcast & Streaming Quality Control (QC) Auditor.
 * Verifies EBU R128 / ITU-R BS.1770 audio compliance, True Peak safety,
 * dialogue stem clarity over BGM, and mobile safe title subtitle adherence.
 */
export class BroadcastQcAuditor {
  /**
   * Evaluates audio loudness metrics.
   * If FFmpeg/ebur128 is not available or mock is requested, provides calibrated standards.
   */
  public static async analyzeAudioLoudness(
    audioPath: string,
    mockFallback = false
  ): Promise<AudioLoudnessMetrics> {
    if (mockFallback) return { measurement: "mock", integratedLufs: -23.1, truePeakDbtp: -1.2, loudnessRangeLu: 8.5 };
    const unavailable: AudioLoudnessMetrics = { measurement: "unavailable", integratedLufs: NaN, truePeakDbtp: NaN, loudnessRangeLu: NaN };
    if (!existsSync(audioPath) || !(await isFfmpegAvailable())) return unavailable;
    try {
      const output = await runFfmpeg(["-hide_banner", "-i", audioPath, "-vn", "-af", "loudnorm=I=-23:TP=-1:LRA=14:print_format=json", "-f", "null", "-"], { captureStderr: true });
      const match = output.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
      if (!match) return unavailable;
      const data = JSON.parse(match[0]);
      const metrics = { measurement: "measured" as const, integratedLufs: Number(data.input_i), truePeakDbtp: Number(data.input_tp), loudnessRangeLu: Number(data.input_lra) };
      return [metrics.integratedLufs, metrics.truePeakDbtp, metrics.loudnessRangeLu].every(Number.isFinite) ? metrics : unavailable;
    } catch { return unavailable; }
  }

  /**
   * Runs the full automated broadcast and streaming QC audit suite.
   */
  public static async auditDelivery(options: BroadcastQcOptions): Promise<BroadcastQcReport> {
    const standard = options.targetStandard ?? "broadcast_ebu_r128";
    const checks: QcCheckItem[] = [];
    const recommendations: string[] = [];

    // 1. Video Container & File Size Check
    const videoExists = existsSync(options.masterVideoPath);
    let videoSize = 0;
    if (videoExists) {
      try {
        const s = await stat(options.masterVideoPath);
        videoSize = s.size;
      } catch (caughtError) { log.warn("[broadcast-qc-auditor] "+String(caughtError)); }
    }

    let validVideo = false;
    try { const probe = JSON.parse(await runFfprobe(["-v", "error", "-show_streams", "-of", "json", options.masterVideoPath])); validVideo = probe.streams?.some((stream: any) => stream.codec_type === "video" && Number(stream.width) > 0); } catch (caughtError) { log.warn("[broadcast-qc-auditor] "+String(caughtError)); }
    checks.push({
      id: "vid_container",
      name: "Master Video Integrity",
      category: "video",
      passed: videoExists && validVideo,
      value: `${(videoSize / 1024).toFixed(1)} KB`,
      benchmark: "Decodable video stream",
      severity: "error",
      detail: videoExists ? "Video file exists and meets minimum size." : "Master video file missing!",
    });

    // 2. Audio Loudness & True Peak Check
    const audioPath = options.masterAudioPath || options.masterVideoPath;
    const loudness = await this.analyzeAudioLoudness(audioPath, options.mockFallback);

    const hasLufs = Number.isFinite(loudness.integratedLufs);
    const isLufsCompliant =
      hasLufs &&
      (standard === "broadcast_ebu_r128"
        ? Math.abs(loudness.integratedLufs - -23.0) <= 1.0
        : Math.abs(loudness.integratedLufs - -14.0) <= 2.0);

    checks.push({
      id: "aud_lufs",
      name: "Integrated Loudness (LUFS)",
      category: "audio",
      passed: isLufsCompliant,
      value: hasLufs ? `${loudness.integratedLufs.toFixed(1)} LUFS` : "UNAVAILABLE",
      benchmark: standard === "broadcast_ebu_r128" ? "-23.0 LUFS ± 1.0" : "-14.0 LUFS ± 2.0",
      severity: hasLufs ? "warning" : "info",
      detail: hasLufs
        ? isLufsCompliant
          ? "Loudness is within target broadcast envelope."
          : "Loudness out of spec; master audio may sound too quiet or loud."
        : "Không thể đo loudness do thiếu FFmpeg hoặc tệp âm thanh.",
    });

    // 3. True Peak Compliance
    const hasPeak = Number.isFinite(loudness.truePeakDbtp);
    const isPeakCompliant = hasPeak && loudness.truePeakDbtp <= -1.0;
    checks.push({
      id: "aud_true_peak",
      name: "Maximum True Peak",
      category: "audio",
      passed: isPeakCompliant,
      value: hasPeak ? `${loudness.truePeakDbtp.toFixed(2)} dBTP` : "UNAVAILABLE",
      benchmark: "<= -1.00 dBTP",
      severity: hasPeak ? "error" : "info",
      detail: hasPeak
        ? isPeakCompliant
          ? "True peak provides safe headroom against clipping."
          : "True peak exceeds -1.0 dBTP; risks inter-sample clipping on consumer DACs."
        : "Không thể đo true peak do thiếu FFmpeg.",
    });

    if (hasPeak && !isPeakCompliant) {
      recommendations.push("Áp dụng limiter -1.0 dBTP trên master bus để ngăn méo tiếng.");
    }

    // 4. Loudness Range (LRA) Check
    const hasLra = Number.isFinite(loudness.loudnessRangeLu);
    const isLraCompliant = hasLra && loudness.loudnessRangeLu <= 14.0;
    checks.push({
      id: "aud_lra",
      name: "Loudness Range (LRA)",
      category: "audio",
      passed: isLraCompliant,
      value: hasLra ? `${loudness.loudnessRangeLu.toFixed(1)} LU` : "UNAVAILABLE",
      benchmark: "<= 14.0 LU",
      severity: hasLra ? "warning" : "info",
      detail: hasLra
        ? isLraCompliant
          ? "Dynamic range is optimal for dialogue intelligibility."
          : "Dynamic range is excessively wide; whispered dialogue may be lost."
        : "Không thể đo loudness range do thiếu FFmpeg.",
    });

    // 5. Dialogue Margin vs BGM Check (Clarity)
    if (options.dialogueStemPath && options.bgmStemPath && existsSync(options.dialogueStemPath)) {
      const diagLoudness = await this.analyzeAudioLoudness(options.dialogueStemPath, options.mockFallback);
      const bgmLoudness = await this.analyzeAudioLoudness(options.bgmStemPath, options.mockFallback);
      const hasMargin = Number.isFinite(diagLoudness.integratedLufs) && Number.isFinite(bgmLoudness.integratedLufs);
      const dialogueMargin = hasMargin ? diagLoudness.integratedLufs - bgmLoudness.integratedLufs : NaN;
      const isClarityOk = hasMargin && dialogueMargin >= 4.0; // Dialogue should be at least 4-6 LU above music

      checks.push({
        id: "aud_dialogue_clarity",
        name: "Dialogue-to-Music Clarity Margin",
        category: "audio",
        passed: isClarityOk,
        value: hasMargin ? `+${dialogueMargin.toFixed(1)} LU` : "UNAVAILABLE",
        benchmark: ">= +4.0 LU",
        severity: hasMargin ? "warning" : "info",
        detail: hasMargin
          ? isClarityOk
            ? "Dialogue is prominent and clear above background music."
            : "Music volume is too close to dialogue; consider increasing auto-ducking depth."
          : "Không thể đo tỷ lệ dialogue-to-music do thiếu FFmpeg.",
      });

      if (hasMargin && !isClarityOk) {
        recommendations.push("Tăng độ sâu ducking (giảm âm lượng BGM thêm 3-6dB khi có lời thoại).");
      }
    }
    // 6. Subtitle Safe Title Margin Check
    if (options.subtitleAssPath && existsSync(options.subtitleAssPath)) {
      const content = readFileSync(options.subtitleAssPath, "utf8");
      const playResY = Number(content.match(/PlayResY:\s*(\d+)/)?.[1]);
      const styles = [...content.matchAll(/^Style:\s*(.+)$/gm)].map(match => match[1].split(","));
      const isVertical = options.aspectRatio === "9:16" || playResY === 1920;
      // In 9:16 mobile format: MarginV (index 21) >= 320 and MarginR (index 20) >= 160
      const safe = isVertical
        ? playResY > 0 && styles.length > 0 && styles.every(fields => Number(fields[21]) >= 320 && Number(fields[20]) >= 160)
        : playResY > 0 && styles.length > 0 && styles.every(fields => Number(fields[21]) >= playResY * 0.05);

      checks.push({
        id: "sub_safe_title",
        name: isVertical ? "Mobile 9:16 Safe Title Subtitle Margins" : "Mobile Safe Title Area Subtitle Margins",
        category: "subtitles",
        passed: safe,
        value: safe ? "Verified safe ASS margins" : "UNAVAILABLE or unsafe margins",
        benchmark: isVertical ? "MarginV >= 320, MarginR >= 160 (TikTok/Shorts UI safe)" : "Bottom margin >= 5% frame height",
        severity: "warning",
        detail: safe
          ? "Phụ đề né tránh vùng tương tác di động (TikTok/Shorts UI)."
          : "Phụ đề có thể bị che bởi nút like/share hoặc caption thanh cuộn đáy.",
      });

      if (!safe && isVertical) {
        recommendations.push("Điều chỉnh MarginV >= 340 và MarginR >= 180 trong file phụ đề ASS để tránh bị giao diện TikTok che mất.");
      }
    }

    // 7. Short-Form 3-Second Visual Hook Check
    if (options.firstShotDurationSec !== undefined) {
      const isHookCompliant = options.firstShotDurationSec <= 3.2;
      checks.push({
        id: "short_3s_hook",
        name: "3-Second Visual Hook Retention",
        category: "video",
        passed: isHookCompliant,
        value: `${options.firstShotDurationSec.toFixed(1)}s`,
        benchmark: "<= 3.2s first shot duration",
        severity: "warning",
        detail: isHookCompliant
          ? "Cú máy mở màn dưới 3.2s đảm bảo nhịp giữ chân người xem di động."
          : `Cú máy mở màn kéo dài ${options.firstShotDurationSec.toFixed(1)}s có thể làm giảm tỷ lệ giữ chân (retention drop).`,
      });
      if (!isHookCompliant) {
        recommendations.push("Rút ngắn cú máy mở màn xuống dưới 3.2s với tình tiết kịch tính cao để tối ưu thuật toán short-form.");
      }
    }

    const errorCount = checks.filter((c) => !c.passed && c.severity === "error").length;
    const warningCount = checks.filter((c) => !c.passed && c.severity === "warning").length;
    const overallPassed = errorCount === 0 && loudness.measurement === "measured";

    return {
      evidence: loudness.measurement,
      timestamp: new Date().toISOString(),
      standard,
      overallPassed,
      broadcastCompliant: standard === "broadcast_ebu_r128" && overallPassed && warningCount === 0,
      streamingCompliant: standard === "streaming_youtube_tiktok" && overallPassed && warningCount === 0,
      checks,
      recommendations,
    };
  }
}
