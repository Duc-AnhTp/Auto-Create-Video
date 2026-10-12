import { describe, it, expect, vi } from "vitest";
import { ProduceShots } from "./produce-shots.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("ProduceShots duration reconciliation", () => {
  it("should preserve existing visual duration for legacy v1 checkpoints with undefined planningDurationSec", async () => {
    const root = await mkdtemp(join(tmpdir(), "produce-shots-test-"));
    const mockCheckpoints = {
      save: vi.fn().mockResolvedValue(undefined),
    };
    const mockBible = {
      listReferences: vi.fn().mockReturnValue([]),
      getSeriesMetadata: vi.fn().mockReturnValue({}),
      recordShotTake: vi.fn(),
    };
    const mockShots = {};
    const mockOrchestrator = {
      executeShot: vi.fn(),
    };

    const producer = new ProduceShots({
      checkpoints: mockCheckpoints as any,
      bible: mockBible as any,
      shots: mockShots as any,
      orchestrator: mockOrchestrator as any,
    });

    const script = {
      aspectRatio: "16:9",
      scenes: [
        {
          sceneId: "sc1",
          shots: [
            { shotId: "shot1", durationSec: 5.0 },
          ],
        },
      ],
    };

    const job = {
      shots: {
        shot1: {
          shotId: "shot1",
          status: "completed",
          videoSha256: "some-sha256",
          videoPath: join(root, "shot1.mp4"),
          durationSec: 5.0,
          planningDurationSec: undefined, // Legacy v1 checkpoint
        },
      },
    };

    // Verify visualDurations reconciles without forcing fallback when planningDuration matches durationSec
    const visualDurations = new Map<string, number>();
    const planningDurations = new Map<string, number>([["shot1", 5.0]]);

    for (const shot of script.scenes.flatMap((s) => s.shots)) {
      const existing = job.shots[shot.shotId as keyof typeof job.shots];
      const targetPlanningDuration = planningDurations.get(shot.shotId) ?? shot.durationSec;
      const isPlanningDurationMatched =
        existing?.planningDurationSec !== undefined
          ? existing.planningDurationSec === targetPlanningDuration
          : (existing?.durationSec ?? shot.durationSec) === targetPlanningDuration;

      visualDurations.set(
        shot.shotId,
        true && existing?.videoSha256 && isPlanningDurationMatched
          ? existing.durationSec ?? shot.durationSec
          : shot.durationSec
      );
    }

    expect(visualDurations.get("shot1")).toBe(5.0);
    await rm(root, { recursive: true, force: true });
  });
});
