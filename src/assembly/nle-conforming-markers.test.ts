import { describe, it, expect } from "vitest";
import { OtioBridge } from "./otio-bridge.js";
import { exportFcp7Xml } from "./nle-exporter.js";
import { parseNleTimeline, compareWithTimeline } from "./nle-ingest-parser.js";
import type { UnifiedTimeline } from "../series/timeline-schema.js";

describe("Phase 4: Studio NLE Two-Way Conforming & Color Markers", () => {
  const mockTimeline: UnifiedTimeline = {
    seriesId: "series_cyber",
    episodeNumber: 1,
    fps: 30,
    sampleRate: 48000,
    targetTotalFrames: 345,
    targetTotalDurationSec: 11.5,
    videoTrack: [
      {
        shotId: "sc01_sh01_est",
        sceneId: "sc01",
        shotType: "establishing",
        cameraMovement: "dolly_in_slow",
        startSec: 0,
        endSec: 4.5,
        durationSec: 4.5,
        visualPrompt: "Toàn cảnh bến cảng Cyber",
        approvedClipPath: "shots/sc01_sh01_take01.mp4",
        status: "approved",
      } as any,
      {
        shotId: "sc01_sh02_act",
        sceneId: "sc01",
        shotType: "action",
        cameraMovement: "tracking_shot",
        startSec: 4.5,
        endSec: 7.5,
        durationSec: 3.0,
        visualPrompt: "Rượt đuổi mô tô",
        approvedClipPath: "shots/sc01_sh02_take01.mp4",
        status: "approved",
      } as any,
      {
        shotId: "sc01_sh03_hero",
        sceneId: "sc01",
        shotType: "close_up",
        priority: "hero",
        cameraMovement: "dolly_in_slow",
        startSec: 7.5,
        endSec: 11.5,
        durationSec: 4.0,
        visualPrompt: "Cận cảnh gương mặt thám tử Minh",
        approvedClipPath: "shots/sc01_sh03_take02.mp4",
        status: "approved",
      } as any,
    ],
    dialogueTrack: [
      {
        dialogueId: "dia_01",
        shotId: "sc01_sh03_hero",
        characterId: "char_minh",
        speakerName: "Minh",
        rawText: "Kẻ đó đang ở rất gần.",
        subtitleText: "Kẻ đó đang ở rất gần.",
        ttsText: "Kẻ đó đang ở rất gần.",
        type: "speech",
        isOffScreen: false,
        startFrame: 240,
        endFrame: 315,
        durationFrames: 75,
        volume: 1.0,
        startSec: 8.0,
        endSec: 10.5,
        durationSec: 2.5,
        audioPath: "audio/d01.mp3",
      },
    ],
    sfxTrack: [],
    ambienceTrack: [],
    bgmTrack: undefined,
    subtitleTrack: [],
    stems: {},
    metrics: {
      videoDurationSec: 11.5,
      audioDurationSec: 11.5,
      driftSec: 0,
      driftFrames: 0,
      isWithinTolerance: true,
      toleranceSec: 0.05,
    },
  };

  it("OtioBridge.exportToOtio embeds DaVinci Resolve color markers and camera movement director notes", () => {
    const otioJson = OtioBridge.exportToOtio(mockTimeline);
    const parsed = JSON.parse(otioJson);

    expect(parsed.OTIO_SCHEMA).toBe("Timeline.1");
    const videoTrack = parsed.tracks.children.find((t: any) => t.kind === "Video");
    expect(videoTrack).toBeDefined();

    const clips = videoTrack.children.filter((c: any) => c.OTIO_SCHEMA === "Clip.1");
    expect(clips.length).toBe(3);

    // Establishing shot -> PURPLE marker
    const estClip = clips[0];
    expect(estClip.markers).toBeDefined();
    expect(estClip.markers[0].color).toBe("PURPLE");
    expect(estClip.markers[0].comment).toContain("Camera: dolly_in_slow");

    // Action shot -> ORANGE marker
    const actClip = clips[1];
    expect(actClip.markers).toBeDefined();
    expect(actClip.markers[0].color).toBe("ORANGE");
    expect(actClip.markers[0].comment).toContain("Camera: tracking_shot");

    // Hero shot -> CYAN marker
    const heroClip = clips[2];
    expect(heroClip.markers).toBeDefined();
    expect(heroClip.markers[0].color).toBe("CYAN");
    expect(heroClip.markers[0].comment).toContain("Hero Shot");
  });

  it("exportFcp7Xml embeds XML marker tags with appropriate color and director notes", () => {
    const xml = exportFcp7Xml(mockTimeline);

    expect(xml).toContain("<marker>");
    expect(xml).toContain("<color>Purple</color>");
    expect(xml).toContain("<color>Orange</color>");
    expect(xml).toContain("<color>Cyan</color>");
    expect(xml).toContain("Camera: dolly_in_slow");
    expect(xml).toContain("Hero Shot - High Priority");
  });

  it("parseNleTimeline and compareWithTimeline complete a round-trip conforming validation without drift", () => {
    const otioJson = OtioBridge.exportToOtio(mockTimeline);
    const ingested = parseNleTimeline(otioJson, "otio");

    expect(ingested.videoClips.length).toBe(3);
    expect(ingested.fps).toBe(30);

    const diff = compareWithTimeline(mockTimeline, ingested);
    // Exact round-trip: no duration changes, take swaps, or deletions
    expect(diff.trimmedShots.length).toBe(0);
    expect(diff.swappedTakes.length).toBe(0);
    expect(diff.removedShots.length).toBe(0);
    expect(diff.hasModifications).toBe(false);
  });
});
