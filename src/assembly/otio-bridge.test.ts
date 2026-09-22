import { describe, it, expect } from "vitest";
import { OtioBridge } from "./otio-bridge.js";
import type { UnifiedTimeline } from "../series/timeline-schema.js";

describe("OtioBridge", () => {
  const dummyTimeline: UnifiedTimeline = {
    seriesId: "test_series",
    episodeNumber: 1,
    fps: 30,
    sampleRate: 48000,
    targetTotalFrames: 300,
    targetTotalDurationSec: 10,
    videoTrack: [
      {
        shotId: "shot_01",
        sceneId: "scene_01",
        startFrame: 0,
        endFrame: 150,
        durationFrames: 150,
        startSec: 0,
        endSec: 5,
        durationSec: 5,
        shotType: "establishing",
        visualPrompt: "Bình minh trên nóc nhà cổ",
        approvedClipPath: "output/shots/shot_01.mp4",
        trimStartSec: 0,
      },
      {
        shotId: "shot_02",
        sceneId: "scene_01",
        startFrame: 150,
        endFrame: 300,
        durationFrames: 150,
        startSec: 5,
        endSec: 10,
        durationSec: 5,
        shotType: "close_up",
        visualPrompt: "Ánh mắt kiên định của nhân vật",
        approvedClipPath: "output/shots/shot_02.mp4",
        trimStartSec: 0,
      },
    ],
    dialogueTrack: [
      {
        dialogueId: "d1",
        shotId: "shot_01",
        characterId: "c1",
        speakerName: "Minh",
        rawText: "Ngày mới đã bắt đầu.",
        subtitleText: "Ngày mới đã bắt đầu.",
        ttsText: "Ngày mới đã bắt đầu.",
        startFrame: 30,
        endFrame: 90,
        durationFrames: 60,
        startSec: 1.0,
        endSec: 3.0,
        durationSec: 2.0,
        audioPath: "output/audio/d1.mp3",
        volume: 1.0,
        type: "speech",
        isOffScreen: false,
      },
    ],
    sfxTrack: [],
    ambienceTrack: [],
    subtitleTrack: [],
    stems: {},
    metrics: {
      videoDurationSec: 10,
      audioDurationSec: 10,
      driftSec: 0,
      driftFrames: 0,
      isWithinTolerance: true,
      toleranceSec: 0.05,
    },
  };

  it("exports a valid OpenTimelineIO (.otio) JSON document", () => {
    const otioJson = OtioBridge.exportToOtio(dummyTimeline);
    const parsed = JSON.parse(otioJson);

    expect(parsed.OTIO_SCHEMA).toBe("Timeline.1");
    expect(parsed.name).toBe("Series_test_series_Episode_1");
    expect(parsed.tracks.children).toHaveLength(2);

    const videoTrack = parsed.tracks.children[0];
    expect(videoTrack.kind).toBe("Video");
    expect(videoTrack.children).toHaveLength(2);
    expect(videoTrack.children[0].name).toBe("shot_01");

    const audioTrack = parsed.tracks.children[1];
    expect(audioTrack.kind).toBe("Audio");
    // Should have 1 Gap (from 0 to 1.0s) and 1 Clip
    expect(audioTrack.children[0].OTIO_SCHEMA).toBe("Gap.1");
    expect(audioTrack.children[1].OTIO_SCHEMA).toBe("Clip.1");
  });

  it("parses OpenTimelineIO clip durations round-trip", () => {
    const otioJson = OtioBridge.exportToOtio(dummyTimeline);
    const clips = OtioBridge.parseOtioClips(otioJson);

    expect(clips).toHaveLength(2);
    expect(clips[0].shotId).toBe("shot_01");
    expect(clips[0].durationSec).toBe(5);
    expect(clips[1].shotId).toBe("shot_02");
    expect(clips[1].durationSec).toBe(5);
  });

  it("exports multi-track SFX, Ambience, BGM and handles video gaps", () => {
    const timelineWithTracks: UnifiedTimeline = {
      ...dummyTimeline,
      videoTrack: [
        {
          ...dummyTimeline.videoTrack[0],
          startSec: 1.0, // starts with 1.0s gap
          endSec: 6.0,
        },
      ],
      sfxTrack: [
        {
          cueId: "sfx_1",
          name: "Thunder",
          startFrame: 30,
          durationFrames: 60,
          startSec: 1.0,
          durationSec: 2.0,
          volume: 0.8,
          audioPath: "output/audio/sfx_1.mp3",
        },
      ],
      ambienceTrack: [
        {
          cueId: "amb_1",
          name: "Rain",
          startFrame: 0,
          durationFrames: 180,
          startSec: 0,
          durationSec: 6.0,
          volume: 0.4,
          fadeInSec: 0.5,
          fadeOutSec: 0.5,
          audioPath: "output/audio/amb_1.mp3",
        },
      ],
      bgmTrack: {
        audioPath: "output/audio/bgm.mp3",
        startFrame: 0,
        durationFrames: 180,
        startSec: 0,
        durationSec: 6.0,
        baseVolume: 0.2,
        duckedVolume: 0.05,
        duckingWindows: [],
      },
    };

    const otioJson = OtioBridge.exportToOtio(timelineWithTracks);
    const parsed = JSON.parse(otioJson);

    expect(parsed.tracks.children).toHaveLength(5); // Video, Dialogue, SFX, Ambience, BGM
    const videoTrack = parsed.tracks.children[0];
    expect(videoTrack.children[0].OTIO_SCHEMA).toBe("Gap.1"); // Gap before shot_01
    expect(videoTrack.children[1].OTIO_SCHEMA).toBe("Clip.1");

    const sfxTrack = parsed.tracks.children.find((t: any) => t.name === "SFX Track");
    expect(sfxTrack).toBeDefined();
    expect(sfxTrack.children[0].OTIO_SCHEMA).toBe("Gap.1");
    expect(sfxTrack.children[1].OTIO_SCHEMA).toBe("Clip.1");

    const ambTrack = parsed.tracks.children.find((t: any) => t.name === "Ambience Track");
    expect(ambTrack).toBeDefined();

    const bgmTrack = parsed.tracks.children.find((t: any) => t.name === "BGM Track");
    expect(bgmTrack).toBeDefined();
  });

  it("handles malformed JSON and missing video tracks safely in parseOtioClips", () => {
    expect(OtioBridge.parseOtioClips("invalid json")).toEqual([]);
    expect(OtioBridge.parseOtioClips(JSON.stringify({}))).toEqual([]);
    expect(OtioBridge.parseOtioClips(JSON.stringify({ tracks: { children: [] } }))).toEqual([]);
  });
});
