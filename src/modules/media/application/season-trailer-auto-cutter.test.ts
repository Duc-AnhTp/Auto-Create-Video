import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SeasonTrailerAutoCutter,
  type CandidateShot,
} from "./season-trailer-auto-cutter.js";
import { MultiEpisodeRunner } from "../../../bootstrap/multi-episode-runtime.js";

describe("Option 4: Hollywood Season Trailer Auto-Cut & End-to-End Production Run", () => {
  const testOutputDir = join("data", "test_trailer_output");

  beforeEach(async () => {
    if (existsSync(testOutputDir)) {
      await rm(testOutputDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  afterEach(async () => {
    if (existsSync(testOutputDir)) {
      await rm(testOutputDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  describe("1. SeasonTrailerAutoCutter: 4-Act Pacing Structure", () => {
    it("should plan 60-second Hollywood Teaser 4-Act timeline accurately", () => {
      const plan = SeasonTrailerAutoCutter.planTrailerPacing(60);

      expect(plan.totalTargetDurationSec).toBe(60);
      expect(plan.actStructure.length).toBe(4);

      // Act 1: The Hook (0s to 15s)
      expect(plan.actStructure[0].act).toBe("act_1_hook");
      expect(plan.actStructure[0].startSec).toBe(0);
      expect(plan.actStructure[0].endSec).toBe(15);

      // Act 2: The Escalation (15s to 38s)
      expect(plan.actStructure[1].act).toBe("act_2_escalation");
      expect(plan.actStructure[1].startSec).toBe(15);
      expect(plan.actStructure[1].endSec).toBe(38);

      // Act 3: The Climax Montage (38s to 52s)
      expect(plan.actStructure[2].act).toBe("act_3_climax");
      expect(plan.actStructure[2].startSec).toBe(38);
      expect(plan.actStructure[2].endSec).toBe(52);

      // Outro: Title Card & Tagline (52s to 60s)
      expect(plan.actStructure[3].act).toBe("outro_title_card");
      expect(plan.actStructure[3].startSec).toBe(52);
      expect(plan.actStructure[3].endSec).toBe(60);
    });

    it("should plan 30-second Short Promo and 90-second Extended Teaser", () => {
      const plan30 = SeasonTrailerAutoCutter.planTrailerPacing(30);
      expect(plan30.totalTargetDurationSec).toBe(30);
      expect(plan30.actStructure[3].endSec).toBe(30);

      const plan90 = SeasonTrailerAutoCutter.planTrailerPacing(90);
      expect(plan90.totalTargetDurationSec).toBe(90);
      expect(plan90.actStructure[3].endSec).toBe(90);
    });
  });

  describe("2. Trailer Candidate Shot Scoring & Selection", () => {
    const mockCandidates: CandidateShot[] = [
      {
        shotId: "ep1_shot_est",
        episodeNumber: 1,
        shotType: "establishing",
        clipPath: "mock_path_1.mp4",
        sourceDurationSec: 4.5,
        tensionScore: 0.3,
        dialogueSnippet: "Thành phố này đã chìm trong bóng tối quá lâu.",
        speakerName: "Minh",
        emotionScore: 0.7,
      },
      {
        shotId: "ep3_shot_confront",
        episodeNumber: 3,
        shotType: "two_shot",
        clipPath: "mock_path_2.mp4",
        sourceDurationSec: 3.5,
        tensionScore: 0.85,
        dialogueSnippet: "Kẻ phản bội chính là người đứng cạnh ngươi!",
        speakerName: "Lan",
        emotionScore: 0.9,
      },
      {
        shotId: "ep5_shot_climax_ecu",
        episodeNumber: 5,
        shotType: "extreme_close_up",
        clipPath: "mock_path_3.mp4",
        sourceDurationSec: 2.0,
        tensionScore: 1.0,
        actionDensity: "peak",
        dialogueSnippet: "Khai hỏa!",
        speakerName: "Minh",
        emotionScore: 1.0,
      },
      {
        shotId: "ep4_shot_close_up",
        episodeNumber: 4,
        shotType: "close_up",
        clipPath: "mock_path_4.mp4",
        sourceDurationSec: 2.5,
        tensionScore: 0.75,
        dialogueSnippet: "Tôi sẽ không bỏ lại bất kỳ ai.",
        speakerName: "Minh",
        emotionScore: 0.95,
      },
    ];

    it("should score establishing shot highest for Act 1 and extreme close-up highest for Act 3", () => {
      const scoreAct1Est = SeasonTrailerAutoCutter.scoreCandidateShot(mockCandidates[0], "act_1_hook");
      const scoreAct1Climax = SeasonTrailerAutoCutter.scoreCandidateShot(mockCandidates[2], "act_1_hook");
      expect(scoreAct1Est).toBeGreaterThan(0.4);

      const scoreAct3Climax = SeasonTrailerAutoCutter.scoreCandidateShot(mockCandidates[2], "act_3_climax");
      const scoreAct3Est = SeasonTrailerAutoCutter.scoreCandidateShot(mockCandidates[0], "act_3_climax");
      expect(scoreAct3Climax).toBeGreaterThan(scoreAct3Est);
    });

    it("should select trailer cuts and generate outro title card sequence", () => {
      const plan = SeasonTrailerAutoCutter.planTrailerPacing(60);
      const cuts = SeasonTrailerAutoCutter.selectTrailerCuts(
        mockCandidates,
        plan,
        "CHIẾN BINH THỜI GIAN",
        "Số Phận Đã Định"
      );

      expect(cuts.length).toBeGreaterThan(8);

      // Verify cuts cover all 4 acts
      const actsPresent = new Set(cuts.map((c) => c.act));
      expect(actsPresent.has("act_1_hook")).toBe(true);
      expect(actsPresent.has("act_2_escalation")).toBe(true);
      expect(actsPresent.has("act_3_climax")).toBe(true);
      expect(actsPresent.has("outro_title_card")).toBe(true);

      // Verify final cut is the Title Card
      const finalCut = cuts[cuts.length - 1];
      expect(finalCut.act).toBe("outro_title_card");
      expect(finalCut.shotId).toBe("trailer_title_card");
      expect(finalCut.audioHit).toBe("title_sting");
    });
  });

  describe("3. Multi-Format Master Trailer Export", () => {
    it("should generate 60s trailer master video, DaVinci XML, and CMX 3600 EDL", async () => {
      const candidates: CandidateShot[] = [
        {
          shotId: "shot_01",
          episodeNumber: 1,
          shotType: "establishing",
          clipPath: "dummy_clip1.mp4",
          sourceDurationSec: 4.0,
          tensionScore: 0.4,
          dialogueSnippet: "Câu hỏi bắt đầu từ đây.",
        },
        {
          shotId: "shot_02",
          episodeNumber: 2,
          shotType: "two_shot",
          clipPath: "dummy_clip2.mp4",
          sourceDurationSec: 3.0,
          tensionScore: 0.7,
          dialogueSnippet: "Không còn đường lui nữa rồi.",
        },
        {
          shotId: "shot_03",
          episodeNumber: 3,
          shotType: "close_up",
          clipPath: "dummy_clip3.mp4",
          sourceDurationSec: 2.0,
          tensionScore: 0.95,
          dialogueSnippet: "Ngay bây giờ!",
        },
      ];

      const result = await SeasonTrailerAutoCutter.generateSeasonTrailer(candidates, {
        seriesId: "test_trailer_series",
        seriesTitle: "HẠT BỤI ĐIỆN BIÊN",
        tagline: "Bản Hùng Ca Bất Diệt",
        targetDurationSec: 60,
        outputDir: testOutputDir,
        mockVideo: true,
      });

      expect(result.seriesId).toBe("test_trailer_series");
      expect(result.targetDurationSec).toBe(60);
      expect(result.cuts.length).toBeGreaterThan(5);

      // Verify generated files on disk
      expect(existsSync(result.trailerVideoPath)).toBe(true);
      expect(existsSync(result.fcp7XmlPath)).toBe(true);
      expect(existsSync(result.cmx3600EdlPath)).toBe(true);
      expect(existsSync(result.manifestPath)).toBe(true);

      // Verify FCP7 XML validity
      const xml = readFileSync(result.fcp7XmlPath, "utf8");
      expect(xml).toContain("<?xml version=");
      expect(xml).toContain("<xmeml");
      expect(xml).toMatch(/<sequence(?:\s|>)/);
      expect(xml).toContain("<track>");

      // Verify CMX 3600 EDL validity
      const edl = readFileSync(result.cmx3600EdlPath, "utf8");
      expect(edl).toContain("TITLE:");
      expect(edl).toContain("FCM: NON-DROP FRAME");
    });
  });

  describe("4. End-to-End MultiEpisodeRunner with Season Trailer Auto-Cut", () => {
    it("should produce a complete 5-episode season with lighting harmonization, lipsync, and trailer auto-cut", async () => {
      const runner = new MultiEpisodeRunner(":memory:");

      const seasonManifest = await runner.runSeason({
        seriesId: "season_1_blockbuster",
        totalEpisodes: 3, // Running 3 episodes for fast, robust test execution
        fromEpisode: 1,
        toEpisode: 3,
        seasonBudgetUsd: 60.0,
        outputBaseDir: testOutputDir,
        enableLightingHarmonization: true,
        enableEmotionalVoice: true,
        enableLipSync: true,
        enable4kPost: true,
        generateSeasonTrailer: true,
        trailerTargetDurationSec: 30, // 30s teaser
        trailerTagline: "Cuộc Chiến Vượt Thời Gian",
      });

      expect(seasonManifest.seriesId).toBe("season_1_blockbuster");
      expect(seasonManifest.completedEpisodes).toBe(3);
      expect(seasonManifest.episodes.length).toBe(3);

      // Verify all episodes have completed pipelines
      for (const ep of seasonManifest.episodes) {
        expect(ep.status).toMatch(/SUCCESS|WARN/);
        expect(ep.lightingHarmonized).toBe(true);
        // Mock lip-sync artifacts have a zero confidence score and must not be reported as aligned.
        expect(ep.lipSyncAligned).toBe(false);
        expect(ep.final4kDeliveryPath).toBeDefined();
        expect(existsSync(ep.masterVideoPath!)).toBe(true);
      }

      // Verify Season Trailer Auto-Cut result
      expect(seasonManifest.trailerResult).toBeDefined();
      expect(seasonManifest.trailerResult?.targetDurationSec).toBe(30);
      expect(seasonManifest.trailerResult?.cutsCount).toBeGreaterThan(5);
      expect(existsSync(seasonManifest.trailerResult!.trailerVideoPath)).toBe(true);
      expect(existsSync(seasonManifest.trailerResult!.fcp7XmlPath)).toBe(true);
      expect(existsSync(seasonManifest.trailerResult!.cmx3600EdlPath)).toBe(true);
    });
  });
});
