import { describe, it, expect } from "vitest";
import { buildMasterTimeline } from "./audio-assembler.js";
import { decomposeShotDuration } from "../pipeline/shot-chaining.js";
import { EpisodicScriptSchema, type EpisodicScript } from "./series-schema.js";

describe("Long-Form Scalability Verification: Longer Film Duration & Shot Chaining", () => {
  describe("1. Zero Cumulative Drift on Long-Form Timelines (60-120 shots / 5-10 minutes)", () => {
    it("guarantees sample-accurate synchronization across a 60-shot (5-minute) master timeline", () => {
      // Synthesize a 60-shot episodic script (~300 seconds = 5 minutes)
      const scenes: any[] = [];
      let globalShotIndex = 1;

      for (let s = 1; s <= 6; s++) {
        const shots: any[] = [];
        for (let sh = 1; sh <= 10; sh++) {
          const shotId = `sc${s}_sh${sh}`;
          const durationSec = 4.0 + ((globalShotIndex * 3) % 4); // Variations between 4s, 5s, 6s, 7s
          const hasDialogue = globalShotIndex % 2 === 0;

          shots.push({
            shotId,
            shotType: sh === 1 ? "establishing" : sh % 3 === 0 ? "close_up" : "medium",
            durationSec,
            visualPrompt: `Phân cảnh đại lộ Sài Gòn 2088 cú máy ${globalShotIndex}`,
            characterId: hasDialogue ? "minh" : undefined,
            dialogue: hasDialogue
              ? {
                  speakerId: "minh",
                  speakerName: "Minh",
                  text: `Câu thoại số ${globalShotIndex} về bản kế hoạch tác chiến ngầm.`,
                }
              : undefined,
          });
          globalShotIndex++;
        }

        scenes.push({
          sceneNumber: s,
          locationId: `loc_${s}`,
          locationName: `Khu vực ${s}`,
          timeOfDay: "night",
          charactersPresent: ["minh"],
          propsPresent: ["chip_luong_tu"],
          shots,
        });
      }

      const rawScript: EpisodicScript = {
        seriesId: "cyber-saigon-longform",
        episodeNumber: 10,
        title: "Tập Đặc Biệt 5 Phút: Chiến Dịch Giải Phóng",
        logline: "Chiến dịch quy mô lớn 5 phút xuyên suốt 6 phân khu Sài Gòn 2088.",
        aspectRatio: "9:16",
        fps: 30,
        scenes,
      };

      const validated = EpisodicScriptSchema.parse(rawScript);
      const timeline = buildMasterTimeline(validated);

      // Verify total shots
      expect(timeline.videoTrack.length).toBe(60);

      // Verify mathematical continuity without any cumulative gap or drift
      let expectedStart = 0;
      for (let i = 0; i < timeline.videoTrack.length; i++) {
        const item = timeline.videoTrack[i];
        expect(Math.abs(item.startSec - expectedStart)).toBeLessThan(0.00001);
        expect(Math.abs(item.endSec - (item.startSec + item.durationSec))).toBeLessThan(0.00001);
        expectedStart += item.durationSec;
      }

      // Verify total duration equals sum of all 60 shots exactly
      expect(Math.abs(timeline.totalDurationSec - expectedStart)).toBeLessThan(0.00001);
      expect(timeline.totalDurationSec).toBeGreaterThanOrEqual(250); // ~5 minutes

      // Verify all 30 dialogue cues align exactly with their shot startSec
      expect(timeline.dialogueTrack.length).toBe(30);
      for (const cue of timeline.dialogueTrack) {
        const matchingShot = timeline.videoTrack.find((v) => v.shotId === cue.shotId);
        expect(matchingShot).toBeDefined();
        expect(Math.abs(cue.startSec - matchingShot!.startSec)).toBeLessThan(0.00001);
      }
    });
  });

  describe("2. Shot Duration Decomposition & Chaining for Extended Takes", () => {
    it("decomposes shots exceeding provider duration limits into linked passes", () => {
      // Test 1: Short shot (4s <= 5s) -> 1 pass
      const decompShort = decomposeShotDuration("sc1_sh1", 4.0, 5.0);
      expect(decompShort.passes.length).toBe(1);
      expect(decompShort.passes[0].durationSec).toBe(4.0);
      expect(decompShort.passes[0].chainedFromPass).toBeUndefined();

      // Test 2: Standard shot (5s == 5s) -> 1 pass
      const decompExact = decomposeShotDuration("sc1_sh2", 5.0, 5.0);
      expect(decompExact.passes.length).toBe(1);
      expect(decompExact.passes[0].durationSec).toBe(5.0);

      // Test 3: Extended shot (12s > 5s) -> 3 passes (5s + 5s + 2s)
      const decompLong = decomposeShotDuration("sc1_sh3", 12.0, 5.0);
      expect(decompLong.passes.length).toBe(3);
      expect(decompLong.passes[0].durationSec).toBe(5.0);
      expect(decompLong.passes[0].chainedFromPass).toBeUndefined();

      expect(decompLong.passes[1].durationSec).toBe(5.0);
      expect(decompLong.passes[1].chainedFromPass).toBe(0); // Chained from pass 0

      expect(decompLong.passes[2].durationSec).toBe(2.0);
      expect(decompLong.passes[2].chainedFromPass).toBe(1); // Chained from pass 1

      // Total duration of passes must equal original duration
      const sumDuration = decompLong.passes.reduce((acc, p) => acc + p.durationSec, 0);
      expect(sumDuration).toBe(12.0);
    });
  });
});
