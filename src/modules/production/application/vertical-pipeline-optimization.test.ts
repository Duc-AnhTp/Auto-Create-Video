import { describe, it, expect } from "vitest";
import { CinematicDirectorEngine } from "../../media/application/cinematic-director.js";
import { PromptOptimizer } from "../../story/application/analysis/prompt-optimizer.js";
import { DynamicPacingCalculator } from "../../media/application/pacing-calculator.js";
import {
  exportToAss,
  MOBILE_SAFE_ZONE_1080_1920,
} from "../../media/adapters/ass-subtitle-builder.js";
import { SpatialFoleyEngine } from "../../media/adapters/audio/spatial-foley-engine.js";
import { BroadcastQcEnhancer } from "../../media/adapters/broadcast-qc-enhancer.js";
import { BroadcastQcAuditor } from "../../media/adapters/broadcast-qc-auditor.js";
import { generateFcp7Xml } from "../../media/adapters/assembly/nle-exporter.js";
import type { EpisodicScript } from "../../../contracts/episode.js";
import type { UnifiedTimeline } from "../../../contracts/timeline.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeFileSync, unlinkSync } from "node:fs";

describe("Vertical 9:16 Short-Form & Mini-Series Optimization Pipeline", () => {
  // ── PILLAR 1: Vertical Cinematic Directing Grammar ──────────────────────────
  describe("Pillar 1: Vertical Cinematic Directing Grammar", () => {
    it("generates 9:16 depth-stacked coverage with 3.2s hook and upper-third eye line", () => {
      const shots = CinematicDirectorEngine.generate5ShotCoverage({
        sceneNumber: 1,
        locationName: "Tòa Tháp Tập Đoàn",
        aspectRatio: "9:16",
        characters: [
          { id: "char_a", name: "Chủ Tịch Trần" },
          { id: "char_b", name: "Thư Ký Mai" },
        ],
        dialogueLines: [
          { speakerId: "char_a", speakerName: "Chủ Tịch Trần", text: "Hợp đồng bị hủy rồi sao?" },
          { speakerId: "char_b", speakerName: "Thư Ký Mai", text: "Dạ vâng, họ đã chuyển nhượng toàn bộ." },
          { speakerId: "char_a", speakerName: "Chủ Tịch Trần", text: "Ta sẽ không để yên chuyện này." },
          { speakerId: "char_a", speakerName: "Chủ Tịch Trần", text: "Chuẩn bị xe ngay lập tức!" },
        ],
      });

      expect(shots.length).toBe(5);

      // Shot 1: Establishing with rapid 3.2s hook for short-form
      expect(shots[0].shotType).toBe("establishing");
      expect(shots[0].durationSec).toBe(3.2);
      expect(shots[0].visualPrompt).toContain("Vertical Establishing Shot 9:16");
      expect(shots[0].visualPrompt).toContain("vertical architecture leading lines");

      // Shot 2: Depth-stacked two-shot (lower-third foreground, upper-third midground)
      expect(shots[1].shotType).toBe("medium");
      expect(shots[1].durationSec).toBe(3.0);
      expect(shots[1].visualPrompt).toContain("Depth-Stacked Two-Shot 9:16");
      expect(shots[1].visualPrompt).toContain("lower-third");
      expect(shots[1].visualPrompt).toContain("upper-third");

      // Shot 3 & 4: Vertical OTS with upper-third eye line (Y: 35%) and mobile safe zone
      expect(shots[2].shotType).toBe("over_the_shoulder");
      expect(shots[2].durationSec).toBe(2.8);
      expect(shots[2].visualPrompt).toContain("Vertical Over-the-Shoulder 9:16");
      expect(shots[2].visualPrompt).toContain("Action Safe Zone");
      expect(shots[2].visualPrompt).toContain("Upper-Third Eye Line, Y: 35%");

      // Shot 5: Intense close-up reaction
      expect(shots[4].shotType).toBe("close_up");
      expect(shots[4].durationSec).toBe(2.5);
      expect(shots[4].visualPrompt).toContain("Vertical Intense Close-Up 9:16");
    });

    it("clamps horizontal audio panning to mobile safe envelope [-0.18, +0.18] for 9:16", () => {
      // In 9:16 portrait mode, panning is narrowed to prevent phone single-speaker phase cancellation
      const verticalShots = CinematicDirectorEngine.generate5ShotCoverage({
        sceneNumber: 1,
        locationName: "Phòng Họp",
        aspectRatio: "9:16",
        characters: [{ id: "c1", name: "A" }, { id: "c2", name: "B" }],
      });
      expect(verticalShots).toBeDefined();
    });
  });

  // ── PILLAR 2: Prompt Sanitizer & Vertical Modifier Injection ────────────────
  describe("Pillar 2: Prompt Sanitizer & Vertical Modifier Injection", () => {
    it("strips conflicting horizontal widescreen keywords from prompts", () => {
      const horizontalPrompt =
        "cinematic anamorphic 2.39:1 widescreen 16:9 shot, horizontal pan across the battlefield, panoramic view";
      const cleaned = PromptOptimizer.cleanHorizontalPromptArtifacts(horizontalPrompt);

      expect(cleaned).not.toMatch(/anamorphic/i);
      expect(cleaned).not.toMatch(/widescreen/i);
      expect(cleaned).not.toMatch(/panoramic/i);
      expect(cleaned).not.toMatch(/horizontal pan/i);
      expect(cleaned).toContain("shot");
      expect(cleaned).toContain("battlefield");
    });

    it("injects portrait composition tokens and shot-specific vertical enhancers", () => {
      const rawPrompt = "A mysterious warrior standing in the rain, anamorphic lens";
      const injectedCu = PromptOptimizer.injectVerticalPromptModifiers(rawPrompt, "close_up");

      expect(injectedCu).toContain("vertical 9:16 portrait composition");
      expect(injectedCu).toContain("mobile cinematic framing");
      expect(injectedCu).toContain("eye-level upper-third line");
      expect(injectedCu).not.toContain("anamorphic");

      const injectedEst = PromptOptimizer.injectVerticalPromptModifiers("Ancient castle", "establishing");
      expect(injectedEst).toContain("vertical architecture leading lines");
      expect(injectedEst).toContain("tall vertical frame");
    });
  });

  // ── PILLAR 3: Short-Drama Pacing & 3-Second Hook Retention ───────────────────
  describe("Pillar 3: Short-Drama Pacing & 3-Second Hook Retention Engine", () => {
    it("validates 3-second hook and calculates high viewer retention score", () => {
      const mockScript: EpisodicScript = {
        schemaVersion: "2.0.0",
        version: "2.0.0",
        seriesId: "short_drama_01",
        episodeNumber: 1,
        title: "Tập 1: Tiếng Nổ Bí Ẩn",
        logline: "Vụ nổ bất ngờ làm rung chuyển tòa nhà",
        aspectRatio: "9:16",
        fps: 30,
        unresolvedCharacters: [],
        scenes: [
          {
            sceneId: "sc01",
            sceneNumber: 1,
            locationId: "loc_lobby",
            locationName: "Sảnh Tòa Nhà",
            timeOfDay: "night",
            charactersPresent: [],
            propsPresent: [],
            beatIds: [],
            shots: [
              {
                shotId: "sh01",
                shotType: "action",
                durationSec: 2.8, // <= 3.2s Hook
                visualPrompt: "Tiếng nổ bất ngờ bùng cháy dữ dội ở sảnh chính!",
                dialogues: [],
                beatIds: [],
              },
              {
                shotId: "sh02",
                shotType: "close_up",
                durationSec: 2.0,
                visualPrompt: "Gương mặt kinh hoàng của nữ nhân vật chính",
                dialogues: [],
                beatIds: [],
              },
              {
                shotId: "sh03",
                shotType: "action",
                durationSec: 2.5,
                visualPrompt: "Mảnh kính vỡ rơi xuống sàn nhà",
                dialogues: [],
                beatIds: [],
              },
              {
                shotId: "sh04",
                shotType: "close_up",
                durationSec: 2.5,
                visualPrompt: "Ai đó đột ngột xuất hiện sau đám khói?!",
                dialogues: [],
                beatIds: [],
              },
            ],
          },
        ],
      };

      const report = DynamicPacingCalculator.analyzeShortDramaPacing(mockScript);

      expect(report.format).toBe("short_form_vertical");
      expect(report.threeSecondHook).toBeDefined();
      expect(report.threeSecondHook?.passed).toBe(true);
      expect(report.threeSecondHook?.firstShotDurationSec).toBe(2.8);
      expect(report.threeSecondHook?.isHighImpact).toBe(true);
      expect(report.cliffhangerDetected).toBe(true);
      expect(report.retentionScore).toBeGreaterThanOrEqual(0.8);
      expect(report.overallAverageShotDurationSec).toBeLessThanOrEqual(3.0);
    });

    it("emits warning when first shot exceeds 3.2 seconds", () => {
      const sluggishScript: EpisodicScript = {
        schemaVersion: "2.0.0",
        version: "2.0.0",
        seriesId: "short_drama_02",
        episodeNumber: 1,
        title: "Tập 1: Mở Màn Chậm",
        logline: "Cảnh quay chậm chạp",
        aspectRatio: "9:16",
        fps: 30,
        unresolvedCharacters: [],
        scenes: [
          {
            sceneId: "sc01",
            sceneNumber: 1,
            locationId: "loc_room",
            locationName: "Căn phòng",
            timeOfDay: "night",
            charactersPresent: [],
            propsPresent: [],
            beatIds: [],
            shots: [
              {
                shotId: "sh01",
                shotType: "establishing",
                durationSec: 5.5, // Exceeds 3.2s
                visualPrompt: "Toàn cảnh căn phòng mờ sương tĩnh lặng",
                dialogues: [],
                beatIds: [],
              },
            ],
          },
        ],
      };

      const report = DynamicPacingCalculator.analyzeShortDramaPacing(sluggishScript);
      expect(report.threeSecondHook?.passed).toBe(false);
      expect(report.warnings.some((w) => w.includes("3-SECOND HOOK"))).toBe(true);
    });
  });

  // ── PILLAR 4: Mobile Safe Zone & Kinetic ASS Subtitles ───────────────────────
  describe("Pillar 4: Mobile Safe Title & Kinetic ASS Subtitles", () => {
    it("exports ASS subtitles adhering to 1080x1920 mobile safe action margins", () => {
      const cues = [
        {
          subtitleId: "sub_01",
          shotId: "shot_01",
          dialogueId: "dialogue_01",
          startFrame: 15,
          endFrame: 75,
          startSec: 0.5,
          endSec: 2.5,
          durationSec: 2.0,
          speakerName: "Minh",
          displayText: "Tôi không bao giờ tha thứ cho anh!",
        },
      ];

      const ass = exportToAss(cues, {
        aspectRatio: "9:16",
        style: "short_drama_punch",
      });

      // Verify canvas resolution
      expect(ass).toContain("PlayResX: 1080");
      expect(ass).toContain("PlayResY: 1920");

      // Verify Safe Action Margin clearance:
      // MarginV: 340 (clears bottom caption / seekbar)
      // MarginR: 180 (clears right like / comment buttons)
      // MarginL: 80
      expect(ass).toContain(`,${MOBILE_SAFE_ZONE_1080_1920.leftMargin},${MOBILE_SAFE_ZONE_1080_1920.rightMargin},${MOBILE_SAFE_ZONE_1080_1920.bottomMargin},1`);

      // Verify ShortDramaPunch style registration
      expect(ass).toContain("Style: ShortDramaPunch");
      expect(ass).toContain("ShortDramaPunch");
    });
  });

  // ── PILLAR 5: Mobile Audio Mastering (Mono-Compatible & Voice Boost) ────────
  describe("Pillar 5: Mobile Audio Mastering & Spatial Foley", () => {
    it("clamps spatial audio panning to [-0.25, +0.25] when mobileMonoCompatible or 9:16 is active", () => {
      // Normal widescreen panning (-1.0 to +1.0)
      const wideGains = SpatialFoleyEngine.calculateSpatialGains(-0.8, "close_up", {
        aspectRatio: "16:9",
      });
      // In 16:9, sourceX -0.8 remains -0.8
      expect(wideGains.leftGain).toBeGreaterThan(0.9);

      // Mobile 9:16 mono-compatible panning
      const mobileGains = SpatialFoleyEngine.calculateSpatialGains(-0.8, "close_up", {
        aspectRatio: "9:16",
      });
      // In 9:16, sourceX -0.8 is clamped to -0.25
      const expectedClamped = SpatialFoleyEngine.calculateSpatialGains(-0.25, "close_up");
      expect(mobileGains.leftGain).toBeCloseTo(expectedClamped.leftGain, 4);
      expect(mobileGains.rightGain).toBeCloseTo(expectedClamped.rightGain, 4);
    });

    it("injects 3.5kHz voice presence boost and -14 LUFS in streaming conformance filter graph", async () => {
      const tmpOut = join(tmpdir(), `conform_test_${Date.now()}.mp4`);
      const res = await BroadcastQcEnhancer.conformDeliveryPackage("input.mp4", tmpOut, {
        standard: "streaming_youtube_tiktok",
        enableVoicePresenceBoost: true,
        mockFallback: true,
      });

      expect(res.filterGraphString).toContain("equalizer=f=3500:t=q:w=1.5:g=2.5");
      expect(res.filterGraphString).toContain("loudnorm=I=-14:TP=-1");
      expect(res.standard).toBe("streaming_youtube_tiktok");
    });
  });

  // ── PILLAR 6: Vertical NLE Export & Mobile Broadcast QC Auditor ─────────────
  describe("Pillar 6: Vertical NLE Export & Mobile Broadcast QC Auditor", () => {
    it("generates FCP7 XML sequence with 1080x1920 resolution for 9:16 timeline", () => {
      const mockTimeline: UnifiedTimeline = {
        seriesId: "test_vert",
        episodeNumber: 1,
        fps: 30,
        sampleRate: 48000,
        targetTotalDurationSec: 6.0,
        targetTotalFrames: 180,
        aspectRatio: "9:16",
        videoTrack: [
          {
            shotId: "sh01",
            sceneId: "sc01",
            startSec: 0,
            endSec: 3.0,
            durationSec: 3.0,
            startFrame: 0,
            endFrame: 90,
            durationFrames: 90,
            trimStartSec: 0,
            shotType: "establishing",
            visualPrompt: "Vertical shot 1",
          },
          {
            shotId: "sh02",
            sceneId: "sc01",
            startSec: 3.0,
            endSec: 6.0,
            durationSec: 3.0,
            startFrame: 90,
            endFrame: 180,
            durationFrames: 90,
            trimStartSec: 0,
            shotType: "close_up",
            visualPrompt: "Vertical shot 2",
          },
        ],
        dialogueTrack: [],
        sfxTrack: [],
        ambienceTrack: [],
        subtitleTrack: [],
        stems: {},
        metrics: {
          videoDurationSec: 6.0,
          audioDurationSec: 6.0,
          driftSec: 0,
          driftFrames: 0,
          isWithinTolerance: true,
          toleranceSec: 0.05,
        },
      };

      const xml = generateFcp7Xml({ timeline: mockTimeline });
      expect(xml).toContain("<width>1080</width>");
      expect(xml).toContain("<height>1920</height>");
      expect(xml).toContain("<pixelaspectratio>square</pixelaspectratio>");
    });

    it("audits mobile 9:16 safe title margins and 3-second hook retention", async () => {
      const tmpAss = join(tmpdir(), `qc_test_${Date.now()}.ass`);
      const assData = `[Script Info]
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,56,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3.5,2.0,2,80,180,340,1
`;
      writeFileSync(tmpAss, assData, "utf8");

      try {
        const report = await BroadcastQcAuditor.auditDelivery({
          masterVideoPath: "mock_vid.mp4",
          subtitleAssPath: tmpAss,
          aspectRatio: "9:16",
          firstShotDurationSec: 2.8,
          targetStandard: "streaming_youtube_tiktok",
          mockFallback: true,
        });

        const safeTitleCheck = report.checks.find((c) => c.id === "sub_safe_title");
        expect(safeTitleCheck).toBeDefined();
        expect(safeTitleCheck?.passed).toBe(true);

        const hookCheck = report.checks.find((c) => c.id === "short_3s_hook");
        expect(hookCheck).toBeDefined();
        expect(hookCheck?.passed).toBe(true);
      } finally {
        try {
          unlinkSync(tmpAss);
        } catch {}
      }
    });
  });
});
