import type { TimelineVideoShot } from "../../../../contracts/timeline.js";
import type { ReadNleShotMetadataStore } from "../../ports/studio/read-nle-shot-metadata-store.js";
export async function readNleShotMetadata(bible: ReadNleShotMetadataStore, args: {
    seriesId: string;
    epNum: number;
}) {
    const { seriesId, epNum } = args;
    const takes = bible.listShotTakes(seriesId, epNum);
    const approvedTakes = takes.filter((t) => t.is_approved === 1);
    const shots: TimelineVideoShot[] = approvedTakes.map((t, idx) => ({
        shotId: t.shot_id,
        sceneId: "scene_1",
        startFrame: idx * 90,
        endFrame: (idx + 1) * 90,
        durationFrames: 90,
        startSec: idx * 3.0,
        endSec: (idx + 1) * 3.0,
        durationSec: 3.0,
        shotType: "medium",
        visualPrompt: t.prompt || "Shot visual prompt",
        approvedClipPath: t.local_path,
        trimStartSec: 0,
    }));
    return {
        seriesId,
        episodeNumber: epNum,
        fps: 30,
        sampleRate: 48000,
        targetTotalFrames: shots.length * 90,
        targetTotalDurationSec: shots.length * 3.0,
        videoTrack: shots,
        dialogueTrack: [],
        sfxTrack: [],
        ambienceTrack: [],
        subtitleTrack: [],
        stems: {},
        metrics: {
            videoDurationSec: shots.length * 3.0,
            audioDurationSec: shots.length * 3.0,
            driftSec: 0,
            driftFrames: 0,
            isWithinTolerance: true,
            toleranceSec: 0.05,
        },
    };
}
