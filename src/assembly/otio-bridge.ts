import type { UnifiedTimeline, TimelineVideoShot, TimelineDialogueCue } from "../series/timeline-schema.js";

export interface OtioRationalTime {
  OTIO_SCHEMA: "RationalTime.1";
  value: number;
  rate: number;
}

export interface OtioTimeRange {
  OTIO_SCHEMA: "TimeRange.1";
  start_time: OtioRationalTime;
  duration: OtioRationalTime;
}

export interface OtioExternalReference {
  OTIO_SCHEMA: "ExternalReference.1";
  target_url: string;
}

export interface OtioMarker {
  OTIO_SCHEMA: "Marker.1";
  name: string;
  color: "GREEN" | "CYAN" | "ORANGE" | "PURPLE" | "RED" | "BLUE";
  marked_range: OtioTimeRange;
  comment?: string;
}

export interface OtioClip {
  OTIO_SCHEMA: "Clip.1";
  name: string;
  source_range: OtioTimeRange;
  media_reference: OtioExternalReference;
  markers?: OtioMarker[];
  metadata?: Record<string, unknown>;
}

export interface OtioGap {
  OTIO_SCHEMA: "Gap.1";
  source_range: OtioTimeRange;
}

export type OtioTrackItem = OtioClip | OtioGap;

export interface OtioTrack {
  OTIO_SCHEMA: "Track.1";
  name: string;
  kind: "Video" | "Audio";
  children: OtioTrackItem[];
}

export interface OtioStack {
  OTIO_SCHEMA: "Stack.1";
  children: OtioTrack[];
}

export interface OtioTimeline {
  OTIO_SCHEMA: "Timeline.1";
  name: string;
  global_start_time: OtioRationalTime;
  tracks: OtioStack;
  metadata?: Record<string, unknown>;
}

/**
 * OpenTimelineIO (.otio) Bridge for High-End NLE Post-Production (DaVinci Resolve / Premiere Pro).
 */
export class OtioBridge {
  /**
   * Serializes a UnifiedTimeline into standard OpenTimelineIO (.otio) JSON schema.
   */
  public static exportToOtio(timeline: UnifiedTimeline): string {
    const fps = timeline.fps || 30;

    // 1. Build Video Track with Gaps
    const videoChildren: OtioTrackItem[] = [];
    let videoCursor = 0;

    for (const shot of timeline.videoTrack) {
      if (shot.startSec > videoCursor + 0.001) {
        const gapSec = shot.startSec - videoCursor;
        videoChildren.push({
          OTIO_SCHEMA: "Gap.1",
          source_range: {
            OTIO_SCHEMA: "TimeRange.1",
            start_time: {
              OTIO_SCHEMA: "RationalTime.1",
              value: Math.round(videoCursor * fps),
              rate: fps,
            },
            duration: {
              OTIO_SCHEMA: "RationalTime.1",
              value: Math.max(1, Math.round(gapSec * fps)),
              rate: fps,
            },
          },
        });
      }

      const trimStartSec = shot.trimStartSec || 0;
      const startValue = Math.round(trimStartSec * fps);
      const durationValue = Math.max(1, Math.round(shot.durationSec * fps));

      // Determine DaVinci Resolve clip color and director notes
      let markerColor: OtioMarker["color"] = "GREEN";
      let markerNote = "Approved Take";

      if ((shot as any).priority === "hero") {
        markerColor = "CYAN";
        markerNote = "Hero Shot - High Priority";
      } else if (shot.shotType === "action") {
        markerColor = "ORANGE";
        markerNote = "Action Sequence";
      } else if (shot.shotType === "establishing") {
        markerColor = "PURPLE";
        markerNote = "Establishing Geography";
      } else if (shot.shotType === "close_up" || shot.shotType === "extreme_close_up") {
        markerColor = "BLUE";
        markerNote = "Close-up Reaction";
      }

      if ((shot as any).cameraMovement) {
        markerNote += ` | Camera: ${(shot as any).cameraMovement}`;
      }

      const clipMarker: OtioMarker = {
        OTIO_SCHEMA: "Marker.1",
        name: `Shot_${shot.shotId}`,
        color: markerColor,
        marked_range: {
          OTIO_SCHEMA: "TimeRange.1",
          start_time: {
            OTIO_SCHEMA: "RationalTime.1",
            value: startValue,
            rate: fps,
          },
          duration: {
            OTIO_SCHEMA: "RationalTime.1",
            value: Math.min(fps, durationValue),
            rate: fps,
          },
        },
        comment: markerNote,
      };

      videoChildren.push({
        OTIO_SCHEMA: "Clip.1",
        name: shot.shotId,
        source_range: {
          OTIO_SCHEMA: "TimeRange.1",
          start_time: {
            OTIO_SCHEMA: "RationalTime.1",
            value: startValue,
            rate: fps,
          },
          duration: {
            OTIO_SCHEMA: "RationalTime.1",
            value: durationValue,
            rate: fps,
          },
        },
        media_reference: {
          OTIO_SCHEMA: "ExternalReference.1",
          target_url: shot.approvedClipPath || `shots/${shot.shotId}.mp4`,
        },
        markers: [clipMarker],
        metadata: {
          shotType: shot.shotType,
          characterId: shot.characterId,
          visualPrompt: shot.visualPrompt,
          directorNote: markerNote,
        },
      });

      videoCursor = shot.endSec;
    }

    const videoTrack: OtioTrack = {
      OTIO_SCHEMA: "Track.1",
      name: "Video Track 1",
      kind: "Video",
      children: videoChildren,
    };

    // 2. Build Dialogue Audio Track with Gaps
    const dialogueChildren: OtioTrackItem[] = [];
    let audioCursor = 0;

    for (const cue of timeline.dialogueTrack) {
      if (cue.startSec > audioCursor + 0.001) {
        // Insert Gap between dialogues
        const gapSec = cue.startSec - audioCursor;
        dialogueChildren.push({
          OTIO_SCHEMA: "Gap.1",
          source_range: {
            OTIO_SCHEMA: "TimeRange.1",
            start_time: {
              OTIO_SCHEMA: "RationalTime.1",
              value: Math.round(audioCursor * fps),
              rate: fps,
            },
            duration: {
              OTIO_SCHEMA: "RationalTime.1",
              value: Math.max(1, Math.round(gapSec * fps)),
              rate: fps,
            },
          },
        });
      }

      const cueDurFrames = Math.max(1, Math.round(cue.durationSec * fps));
      dialogueChildren.push({
        OTIO_SCHEMA: "Clip.1",
        name: `${cue.speakerName} - ${cue.dialogueId}`,
        source_range: {
          OTIO_SCHEMA: "TimeRange.1",
          start_time: {
            OTIO_SCHEMA: "RationalTime.1",
            value: 0,
            rate: fps,
          },
          duration: {
            OTIO_SCHEMA: "RationalTime.1",
            value: cueDurFrames,
            rate: fps,
          },
        },
        media_reference: {
          OTIO_SCHEMA: "ExternalReference.1",
          target_url: cue.audioPath || `audio/${cue.dialogueId}.mp3`,
        },
        metadata: {
          speaker: cue.speakerName,
          characterId: cue.characterId,
          text: cue.subtitleText,
        },
      });

      audioCursor = cue.endSec;
    }

    const dialogueTrack: OtioTrack = {
      OTIO_SCHEMA: "Track.1",
      name: "Dialogue Track",
      kind: "Audio",
      children: dialogueChildren,
    };

    const allTracks: OtioTrack[] = [videoTrack, dialogueTrack];

    // 3. Build SFX Track with Gaps (if present)
    if (timeline.sfxTrack && timeline.sfxTrack.length > 0) {
      const sfxChildren: OtioTrackItem[] = [];
      let sfxCursor = 0;
      for (const cue of timeline.sfxTrack) {
        if (cue.startSec > sfxCursor + 0.001) {
          const gapSec = cue.startSec - sfxCursor;
          sfxChildren.push({
            OTIO_SCHEMA: "Gap.1",
            source_range: {
              OTIO_SCHEMA: "TimeRange.1",
              start_time: {
                OTIO_SCHEMA: "RationalTime.1",
                value: Math.round(sfxCursor * fps),
                rate: fps,
              },
              duration: {
                OTIO_SCHEMA: "RationalTime.1",
                value: Math.max(1, Math.round(gapSec * fps)),
                rate: fps,
              },
            },
          });
        }
        const sfxDurFrames = Math.max(1, Math.round(cue.durationSec * fps));
        sfxChildren.push({
          OTIO_SCHEMA: "Clip.1",
          name: `SFX - ${cue.name}`,
          source_range: {
            OTIO_SCHEMA: "TimeRange.1",
            start_time: {
              OTIO_SCHEMA: "RationalTime.1",
              value: 0,
              rate: fps,
            },
            duration: {
              OTIO_SCHEMA: "RationalTime.1",
              value: sfxDurFrames,
              rate: fps,
            },
          },
          media_reference: {
            OTIO_SCHEMA: "ExternalReference.1",
            target_url: cue.audioPath || `audio/sfx_${cue.cueId}.mp3`,
          },
          metadata: {
            cueId: cue.cueId,
            name: cue.name,
            volume: cue.volume,
          },
        });
        sfxCursor = cue.startSec + cue.durationSec;
      }
      allTracks.push({
        OTIO_SCHEMA: "Track.1",
        name: "SFX Track",
        kind: "Audio",
        children: sfxChildren,
      });
    }

    // 4. Build Ambience Track with Gaps (if present)
    if (timeline.ambienceTrack && timeline.ambienceTrack.length > 0) {
      const ambChildren: OtioTrackItem[] = [];
      let ambCursor = 0;
      for (const cue of timeline.ambienceTrack) {
        if (cue.startSec > ambCursor + 0.001) {
          const gapSec = cue.startSec - ambCursor;
          ambChildren.push({
            OTIO_SCHEMA: "Gap.1",
            source_range: {
              OTIO_SCHEMA: "TimeRange.1",
              start_time: {
                OTIO_SCHEMA: "RationalTime.1",
                value: Math.round(ambCursor * fps),
                rate: fps,
              },
              duration: {
                OTIO_SCHEMA: "RationalTime.1",
                value: Math.max(1, Math.round(gapSec * fps)),
                rate: fps,
              },
            },
          });
        }
        const ambDurFrames = Math.max(1, Math.round(cue.durationSec * fps));
        ambChildren.push({
          OTIO_SCHEMA: "Clip.1",
          name: `Ambience - ${cue.name}`,
          source_range: {
            OTIO_SCHEMA: "TimeRange.1",
            start_time: {
              OTIO_SCHEMA: "RationalTime.1",
              value: 0,
              rate: fps,
            },
            duration: {
              OTIO_SCHEMA: "RationalTime.1",
              value: ambDurFrames,
              rate: fps,
            },
          },
          media_reference: {
            OTIO_SCHEMA: "ExternalReference.1",
            target_url: cue.audioPath || `audio/amb_${cue.cueId}.mp3`,
          },
          metadata: {
            cueId: cue.cueId,
            name: cue.name,
            volume: cue.volume,
          },
        });
        ambCursor = cue.startSec + cue.durationSec;
      }
      allTracks.push({
        OTIO_SCHEMA: "Track.1",
        name: "Ambience Track",
        kind: "Audio",
        children: ambChildren,
      });
    }

    // 5. Build BGM Track (if present)
    if (timeline.bgmTrack && timeline.bgmTrack.audioPath) {
      const bgmChildren: OtioTrackItem[] = [];
      if (timeline.bgmTrack.startSec > 0.001) {
        bgmChildren.push({
          OTIO_SCHEMA: "Gap.1",
          source_range: {
            OTIO_SCHEMA: "TimeRange.1",
            start_time: {
              OTIO_SCHEMA: "RationalTime.1",
              value: 0,
              rate: fps,
            },
            duration: {
              OTIO_SCHEMA: "RationalTime.1",
              value: Math.max(1, Math.round(timeline.bgmTrack.startSec * fps)),
              rate: fps,
            },
          },
        });
      }
      const bgmDur = timeline.bgmTrack.durationSec || timeline.targetTotalDurationSec;
      bgmChildren.push({
        OTIO_SCHEMA: "Clip.1",
        name: "BGM Track",
        source_range: {
          OTIO_SCHEMA: "TimeRange.1",
          start_time: {
            OTIO_SCHEMA: "RationalTime.1",
            value: 0,
            rate: fps,
          },
          duration: {
            OTIO_SCHEMA: "RationalTime.1",
            value: Math.max(1, Math.round(bgmDur * fps)),
            rate: fps,
          },
        },
        media_reference: {
          OTIO_SCHEMA: "ExternalReference.1",
          target_url: timeline.bgmTrack.audioPath,
        },
        metadata: {
          baseVolume: timeline.bgmTrack.baseVolume,
          duckedVolume: timeline.bgmTrack.duckedVolume,
        },
      });
      allTracks.push({
        OTIO_SCHEMA: "Track.1",
        name: "BGM Track",
        kind: "Audio",
        children: bgmChildren,
      });
    }

    // 6. Assemble Top-Level OpenTimelineIO Document
    const otioDoc: OtioTimeline = {
      OTIO_SCHEMA: "Timeline.1",
      name: `Series_${timeline.seriesId}_Episode_${timeline.episodeNumber}`,
      global_start_time: {
        OTIO_SCHEMA: "RationalTime.1",
        value: 0,
        rate: fps,
      },
      tracks: {
        OTIO_SCHEMA: "Stack.1",
        children: allTracks,
      },
      metadata: {
        seriesId: timeline.seriesId,
        episodeNumber: timeline.episodeNumber,
        targetTotalDurationSec: timeline.targetTotalDurationSec,
      },
    };

    return JSON.stringify(otioDoc, null, 2);
  }

  /**
   * Parses an OpenTimelineIO (.otio) document and extracts trimmed clip boundaries.
   */
  public static parseOtioClips(
    otioJson: string
  ): Array<{ shotId: string; startSec: number; durationSec: number }> {
    let doc: OtioTimeline;
    try {
      doc = typeof otioJson === "string" ? JSON.parse(otioJson) : (otioJson as OtioTimeline);
    } catch {
      return [];
    }
    const clips: Array<{ shotId: string; startSec: number; durationSec: number }> = [];

    const videoTrack = doc.tracks?.children?.find((t) => t.kind === "Video");
    if (!videoTrack || !Array.isArray(videoTrack.children)) return clips;

    let cursorSec = 0;
    for (const item of videoTrack.children) {
      if (!item || !item.source_range || !item.source_range.duration) continue;
      const rate = item.source_range.duration.rate || 30;
      const val = item.source_range.duration.value || 0;
      const durSec = rate > 0 ? val / rate : 0;
      if (item.OTIO_SCHEMA === "Clip.1" && (item as OtioClip).name) {
        clips.push({
          shotId: (item as OtioClip).name,
          startSec: Number(cursorSec.toFixed(3)),
          durationSec: Number(durSec.toFixed(3)),
        });
      }
      cursorSec += durSec;
    }

    return clips;
  }
}
