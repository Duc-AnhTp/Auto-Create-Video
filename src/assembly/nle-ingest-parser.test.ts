import { describe, it, expect, vi } from "vitest";
import {
  parseFcp7Xml,
  parseOtioJson,
  parseNleTimeline,
  compareWithTimeline,
  extractShotMetadataFromFilename,
  applyNleEditsToBible,
  applyNleEditsToTimeline,
} from "./nle-ingest-parser.js";
import type { UnifiedTimeline, TimelineVideoShot } from "../series/timeline-schema.js";
import type { BibleManager } from "../bible/bible-manager.js";

const sampleFcp7Xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
  <sequence id="sequence-1">
    <name>Cyber_Saigon_Ep01_Cut</name>
    <rate>
      <timebase>30</timebase>
    </rate>
    <media>
      <video>
        <track>
          <!-- Shot 1: Trimmed from 3.0s (90 frames) down to 2.0s (60 frames) -->
          <clipitem id="clipitem-1">
            <name>sc01_sh01_take01.mp4</name>
            <start>0</start>
            <end>60</end>
            <in>0</in>
            <out>60</out>
            <file id="file-1">
              <pathurl>file://localhost/D:/Media/sc01_sh01_take01.mp4</pathurl>
            </file>
          </clipitem>
          <!-- Shot 2: Swapped from Take 1 to Take 2 -->
          <clipitem id="clipitem-2">
            <name>sc01_sh02_take02.mp4</name>
            <start>60</start>
            <end>180</end>
            <in>0</in>
            <out>120</out>
            <file id="file-2">
              <pathurl>file://localhost/D:/Media/sc01_sh02_take02.mp4</pathurl>
            </file>
          </clipitem>
        </track>
      </video>
      <audio>
        <track>
          <clipitem id="clipitem-a1">
            <name>dialogue_ep01.wav</name>
            <mediatype>audio</mediatype>
            <start>0</start>
            <end>180</end>
          </clipitem>
        </track>
      </audio>
    </media>
  </sequence>
</xmeml>`;

describe("NleIngestParser", () => {
  it("extracts shotId and takeNumber from filename correctly", () => {
    expect(extractShotMetadataFromFilename("sc01_sh01_take02.mp4")).toEqual({
      shotId: "sc01_sh01",
      takeNumber: 2,
    });
    expect(extractShotMetadataFromFilename("shot_05_take1.mov")).toEqual({
      shotId: "shot_05",
      takeNumber: 1,
    });
    expect(extractShotMetadataFromFilename("intro_take3")).toEqual({
      shotId: "intro",
      takeNumber: 3,
    });
  });

  it("parses FCP7 XML into IngestedNleTimeline structure", () => {
    const timeline = parseFcp7Xml(sampleFcp7Xml);

    expect(timeline.sequenceName).toBe("Cyber_Saigon_Ep01_Cut");
    expect(timeline.fps).toBe(30);
    expect(timeline.videoClips.length).toBe(2);
    expect(timeline.audioClips.length).toBe(1);

    expect(timeline.videoClips[0].shotId).toBe("sc01_sh01");
    expect(timeline.videoClips[0].takeNumber).toBe(1);
    expect(timeline.videoClips[0].durationFrames).toBe(60);

    expect(timeline.videoClips[1].shotId).toBe("sc01_sh02");
    expect(timeline.videoClips[1].takeNumber).toBe(2);
    expect(timeline.videoClips[1].durationFrames).toBe(120);

    expect(timeline.totalFrames).toBe(180);
    expect(timeline.totalDurationSec).toBe(6.0);
  });

  it("compares ingested timeline against UnifiedTimeline and detects trim and take swaps", () => {
    const mockOriginalShot1: TimelineVideoShot = {
      shotId: "sc01_sh01",
      sceneId: "scene_1",
      startFrame: 0,
      endFrame: 90,
      durationFrames: 90,
      startSec: 0,
      endSec: 3.0,
      durationSec: 3.0,
      shotType: "wide",
      visualPrompt: "Neon city",
      approvedClipPath: "D:/Media/sc01_sh01_take01.mp4",
      trimStartSec: 0,
    };

    const mockOriginalShot2: TimelineVideoShot = {
      shotId: "sc01_sh02",
      sceneId: "scene_1",
      startFrame: 90,
      endFrame: 210,
      durationFrames: 120,
      startSec: 3.0,
      endSec: 7.0,
      durationSec: 4.0,
      shotType: "close_up",
      visualPrompt: "Detective looking at terminal",
      approvedClipPath: "D:/Media/sc01_sh02_take01.mp4",
      trimStartSec: 0,
    };

    const mockOriginalTimeline: UnifiedTimeline = {
      seriesId: "cyber_saigon",
      episodeNumber: 1,
      fps: 30,
      sampleRate: 48000,
      targetTotalFrames: 210,
      targetTotalDurationSec: 7.0,
      videoTrack: [mockOriginalShot1, mockOriginalShot2],
      dialogueTrack: [],
      sfxTrack: [],
      ambienceTrack: [],
      subtitleTrack: [],
      stems: {},
      metrics: {
        videoDurationSec: 7.0,
        audioDurationSec: 7.0,
        driftSec: 0,
        driftFrames: 0,
        isWithinTolerance: true,
        toleranceSec: 0.05,
      },
    };

    const ingested = parseFcp7Xml(sampleFcp7Xml);
    const diff = compareWithTimeline(mockOriginalTimeline, ingested);

    expect(diff.hasModifications).toBe(true);

    // Shot 1 was trimmed from 3.0s down to 2.0s
    expect(diff.trimmedShots.length).toBe(1);
    expect(diff.trimmedShots[0].shotId).toBe("sc01_sh01");
    expect(diff.trimmedShots[0].originalDurationSec).toBe(3.0);
    expect(diff.trimmedShots[0].editedDurationSec).toBe(2.0);
    expect(diff.trimmedShots[0].deltaSec).toBeCloseTo(-1.0);

    // Shot 2 swapped take from 1 to 2
    expect(diff.swappedTakes.length).toBe(1);
    expect(diff.swappedTakes[0].shotId).toBe("sc01_sh02");
    expect(diff.swappedTakes[0].originalTakeNumber).toBe(1);
    expect(diff.swappedTakes[0].newTakeNumber).toBe(2);
  });

  it("applies swapped takes and records state event in Story Bible", () => {
    const mockBible = {
      listShotTakes: vi.fn().mockReturnValue([
        { shot_id: "sc01_sh02", take_number: 1, is_approved: 1 },
        { shot_id: "sc01_sh02", take_number: 2, is_approved: 0 },
      ]),
      upsertShotTake: vi.fn(),
      recordStateEvent: vi.fn(),
    } as unknown as BibleManager;

    const diff = {
      hasModifications: true,
      sequenceName: "Test",
      originalTotalDurationSec: 10,
      editedTotalDurationSec: 9,
      totalDurationDeltaSec: -1,
      trimmedShots: [],
      swappedTakes: [
        {
          shotId: "sc01_sh02",
          originalTakeNumber: 1,
          newTakeNumber: 2,
          newClipPath: "D:/Media/sc01_sh02_take02.mp4",
        },
      ],
      removedShots: [],
      reorderedShots: [],
    };

    const applied = applyNleEditsToBible(diff, mockBible, "series_1", 1);
    expect(applied).toBe(true);
    expect(mockBible.upsertShotTake).toHaveBeenCalledTimes(2);
    expect(mockBible.recordStateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        series_id: "series_1",
        episode_number: 1,
        event_type: "status_change",
        confirmation_source: "manual_override",
      })
    );
  });

  it("parses OpenTimelineIO (.otio) JSON correctly", () => {
    const mockOtio = {
      OTIO_SCHEMA: "Timeline.1",
      name: "Cyber_Saigon_Ep01_OTIO",
      global_start_time: { rate: 30, value: 0 },
      tracks: {
        OTIO_SCHEMA: "Stack.1",
        children: [
          {
            OTIO_SCHEMA: "Track.1",
            name: "Video Track",
            kind: "Video",
            children: [
              {
                OTIO_SCHEMA: "Clip.1",
                name: "sc01_sh01_take01.mp4",
                source_range: {
                  start_time: { rate: 30, value: 0 },
                  duration: { rate: 30, value: 75 }, // 2.5s
                },
                media_reference: {
                  OTIO_SCHEMA: "ExternalReference.1",
                  target_url: "file:///D:/Media/sc01_sh01_take01.mp4",
                },
              },
            ],
          },
        ],
      },
    };

    const ingested = parseOtioJson(JSON.stringify(mockOtio));
    expect(ingested.sequenceName).toBe("Cyber_Saigon_Ep01_OTIO");
    expect(ingested.fps).toBe(30);
    expect(ingested.videoClips.length).toBe(1);
    expect(ingested.videoClips[0].shotId).toBe("sc01_sh01");
    expect(ingested.videoClips[0].durationFrames).toBe(75);
    expect(ingested.totalDurationSec).toBe(2.5);

    // Also verify universal parser delegates to OTIO
    const ingestedUni = parseNleTimeline(JSON.stringify(mockOtio));
    expect(ingestedUni.sequenceName).toBe("Cyber_Saigon_Ep01_OTIO");
  });

  it("recalculates UnifiedTimeline continuous timestamps with Zero-Drift after trimming", () => {
    const mockOrigTimeline: UnifiedTimeline = {
      seriesId: "cyber_saigon",
      episodeNumber: 1,
      fps: 30,
      sampleRate: 48000,
      targetTotalFrames: 180,
      targetTotalDurationSec: 6.0,
      videoTrack: [
        {
          shotId: "sc01_sh01",
          sceneId: "scene_1",
          startFrame: 0,
          endFrame: 90,
          durationFrames: 90,
          startSec: 0,
          endSec: 3.0,
          durationSec: 3.0,
          shotType: "wide",
          visualPrompt: "City",
          approvedClipPath: "D:/Media/sc01_sh01_take01.mp4",
          trimStartSec: 0,
        },
        {
          shotId: "sc01_sh02",
          sceneId: "scene_1",
          startFrame: 90,
          endFrame: 180,
          durationFrames: 90,
          startSec: 3.0,
          endSec: 6.0,
          durationSec: 3.0,
          shotType: "close_up",
          visualPrompt: "Face",
          approvedClipPath: "D:/Media/sc01_sh02_take01.mp4",
          trimStartSec: 0,
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

    // Diff where shot 1 was trimmed from 3.0s down to 2.0s, and shot 2 swapped take
    const diff = {
      hasModifications: true,
      sequenceName: "Cut",
      originalTotalDurationSec: 6.0,
      editedTotalDurationSec: 5.0,
      totalDurationDeltaSec: -1.0,
      trimmedShots: [
        {
          shotId: "sc01_sh01",
          originalDurationSec: 3.0,
          editedDurationSec: 2.0,
          deltaSec: -1.0,
        },
      ],
      swappedTakes: [
        {
          shotId: "sc01_sh02",
          originalTakeNumber: 1,
          newTakeNumber: 2,
          newClipPath: "D:/Media/sc01_sh02_take02.mp4",
        },
      ],
      removedShots: [],
      reorderedShots: [],
    };

    const dummyEdited = {
      sequenceName: "Cut",
      fps: 30,
      videoClips: [],
      audioClips: [],
      totalFrames: 150,
      totalDurationSec: 5.0,
    };

    const newTimeline = applyNleEditsToTimeline(mockOrigTimeline, diff, dummyEdited);

    expect(newTimeline.targetTotalDurationSec).toBe(5.0);
    expect(newTimeline.targetTotalFrames).toBe(150);

    // Shot 1: 0 -> 2.0s (0 -> 60 frames)
    expect(newTimeline.videoTrack[0].durationSec).toBe(2.0);
    expect(newTimeline.videoTrack[0].durationFrames).toBe(60);
    expect(newTimeline.videoTrack[0].startSec).toBe(0);
    expect(newTimeline.videoTrack[0].endSec).toBe(2.0);

    // Shot 2: seamlessly continues from 2.0s -> 5.0s (60 -> 150 frames) with swapped take path
    expect(newTimeline.videoTrack[1].durationSec).toBe(3.0);
    expect(newTimeline.videoTrack[1].startSec).toBe(2.0);
    expect(newTimeline.videoTrack[1].endSec).toBe(5.0);
    expect(newTimeline.videoTrack[1].startFrame).toBe(60);
    expect(newTimeline.videoTrack[1].endFrame).toBe(150);
    expect(newTimeline.videoTrack[1].approvedClipPath).toBe("D:/Media/sc01_sh02_take02.mp4");
  });

  it("preserves head trims (inFrame) as trimStartSec during timeline update", () => {
    const mockOrigTimeline: UnifiedTimeline = {
      seriesId: "cyber_saigon",
      episodeNumber: 1,
      fps: 30,
      sampleRate: 48000,
      targetTotalFrames: 90,
      targetTotalDurationSec: 3.0,
      videoTrack: [
        {
          shotId: "sc01_sh01",
          sceneId: "scene_1",
          startFrame: 0,
          endFrame: 90,
          durationFrames: 90,
          startSec: 0,
          endSec: 3.0,
          durationSec: 3.0,
          shotType: "wide",
          visualPrompt: "City",
          approvedClipPath: "D:/Media/sc01_sh01_take01.mp4",
          trimStartSec: 0,
        },
      ],
      dialogueTrack: [],
      sfxTrack: [],
      ambienceTrack: [],
      subtitleTrack: [],
      stems: {},
      metrics: {
        videoDurationSec: 3.0,
        audioDurationSec: 3.0,
        driftSec: 0,
        driftFrames: 0,
        isWithinTolerance: true,
        toleranceSec: 0.05,
      },
    };

    const diff = {
      hasModifications: true,
      sequenceName: "TrimHead",
      originalTotalDurationSec: 3.0,
      editedTotalDurationSec: 2.0,
      totalDurationDeltaSec: -1.0,
      trimmedShots: [
        {
          shotId: "sc01_sh01",
          originalDurationSec: 3.0,
          editedDurationSec: 2.0,
          deltaSec: -1.0,
        },
      ],
      swappedTakes: [],
      removedShots: [],
      reorderedShots: [],
    };

    const editedWithHeadTrim = {
      sequenceName: "TrimHead",
      fps: 30,
      videoClips: [
        {
          id: "clip-1",
          name: "sc01_sh01_take01.mp4",
          startFrame: 0,
          endFrame: 60,
          inFrame: 30, // 1 second head trim
          outFrame: 90,
          durationFrames: 60,
          shotId: "sc01_sh01",
          takeNumber: 1,
          isAudio: false,
        },
      ],
      audioClips: [],
      totalFrames: 60,
      totalDurationSec: 2.0,
    };

    const updatedTimeline = applyNleEditsToTimeline(mockOrigTimeline, diff, editedWithHeadTrim);
    expect(updatedTimeline.videoTrack[0].trimStartSec).toBe(1.0); // 30 frames / 30 fps
    expect(updatedTimeline.videoTrack[0].durationSec).toBe(2.0);
  });

  it("auto-inserts newly chosen take record into SQLite if it did not exist", () => {
    const mockBible = {
      listShotTakes: vi.fn().mockReturnValue([]), // No takes currently recorded
      upsertShotTake: vi.fn(),
      recordStateEvent: vi.fn(),
    } as unknown as BibleManager;

    const diff = {
      hasModifications: true,
      sequenceName: "NewTakeTest",
      originalTotalDurationSec: 5,
      editedTotalDurationSec: 5,
      totalDurationDeltaSec: 0,
      trimmedShots: [],
      swappedTakes: [
        {
          shotId: "sc01_sh03",
          originalTakeNumber: 1,
          newTakeNumber: 3,
          newClipPath: "D:/Media/sc01_sh03_take03.mp4",
        },
      ],
      removedShots: [],
      reorderedShots: [],
    };

    applyNleEditsToBible(diff, mockBible, "series_1", 1);
    expect(mockBible.upsertShotTake).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "sc01_sh03_take03",
        shot_id: "sc01_sh03",
        series_id: "series_1",
        episode_number: 1,
        take_number: 3,
        local_path: "D:/Media/sc01_sh03_take03.mp4",
        is_approved: 1,
      })
    );
  });
});
