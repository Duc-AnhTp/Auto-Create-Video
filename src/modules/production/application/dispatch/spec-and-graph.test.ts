import { describe, it, expect } from "vitest";
import { computeVideoSpecHash, computeAudioSpecHash } from "../../domain/spec-hasher.js";
import { type ShotSpecComposite } from "../../domain/spec-hasher.js";
import { DependencyInvalidationGraph } from "../../adapters/filesystem/dependency-invalidation.js";

describe("Spec Hasher & Dependency Invalidation Graph (Requirements 5 & 6)", () => {
  it("computes deterministic video spec hash resistant to whitespace and key ordering", async () => {
    const hash1 = await computeVideoSpecHash({
      prompt: "Cyberpunk neon street, rain puddle reflections",
      provider: "api_kling",
      modelName: "kling-v2",
      durationSec: 4.5,
      aspectRatio: "9:16",
      fps: 30,
    });

    const hash2 = await computeVideoSpecHash({
      fps: 30,
      aspectRatio: "9:16",
      durationSec: 4.5,
      modelName: "kling-v2",
      provider: "api_kling",
      prompt: "  Cyberpunk   neon street,  rain puddle reflections   ",
    });

    expect(hash1).toBe(hash2);

    // Any factor change alters the hash
    const hashPromptChanged = await computeVideoSpecHash({
      prompt: "Daylight street in ancient Hanoi",
      provider: "api_kling",
      modelName: "kling-v2",
      durationSec: 4.5,
    });
    expect(hashPromptChanged).not.toBe(hash1);

    const hashDurationChanged = await computeVideoSpecHash({
      prompt: "Cyberpunk neon street, rain puddle reflections",
      provider: "api_kling",
      modelName: "kling-v2",
      durationSec: 5.0,
    });
    expect(hashDurationChanged).not.toBe(hash1);
  });

  it("computes deterministic audio spec hash", async () => {
    const hashA = await computeAudioSpecHash({
      dialogueText: "Minh, cẩn thận phía sau!",
      speakerId: "an_protagonist",
      voiceProfileId: "voice_an_vietnamese_f",
      speed: 1.05,
      emotion: "urgent",
    });

    const hashB = await computeAudioSpecHash({
      speakerId: "an_protagonist",
      dialogueText: "  Minh,   cẩn thận phía sau! ",
      voiceProfileId: "voice_an_vietnamese_f",
      speed: 1.05,
      emotion: "urgent",
    });

    expect(hashA).toBe(hashB);

    const hashTextModified = await computeAudioSpecHash({
      dialogueText: "Minh, dừng lại ngay!",
      speakerId: "an_protagonist",
      voiceProfileId: "voice_an_vietnamese_f",
      speed: 1.05,
      emotion: "urgent",
    });
    expect(hashTextModified).not.toBe(hashA);
  });

  it("Requirement 6: Changing dialogue ONLY invalidates audio, preserving 100% of video clips", async () => {
    const graph = new DependencyInvalidationGraph();

    const shot1: ShotSpecComposite = {
      shotId: "ep01_sc01_sh01",
      video: {
        prompt: "Minh walking in neon alley",
        provider: "api_kling",
        durationSec: 4.0,
      },
      audio: {
        dialogueText: "Tôi phải tìm ra manh mối.",
        speakerId: "minh",
      },
      requiresLipSync: false,
    };

    const shot2: ShotSpecComposite = {
      shotId: "ep01_sc01_sh02",
      video: {
        prompt: "Camera panning to cybernetic drone",
        provider: "api_kling",
        durationSec: 3.5,
      },
      audio: {
        dialogueText: "Có thiết bị theo dõi!",
        speakerId: "an",
      },
      requiresLipSync: false,
    };

    // Register existing rendered assets
    graph.registerShot(shot1.shotId, shot1, {
      videoAssetPath: "/output/ep01/shots/sh01_video.mp4",
      audioAssetPath: "/output/ep01/shots/sh01_audio.mp3",
      muxedAssetPath: "/output/ep01/shots/sh01_muxed.mp4",
    });
    graph.registerShot(shot2.shotId, shot2, {
      videoAssetPath: "/output/ep01/shots/sh02_video.mp4",
      audioAssetPath: "/output/ep01/shots/sh02_audio.mp3",
      muxedAssetPath: "/output/ep01/shots/sh02_muxed.mp4",
    });

    // SỬA THOẠI TRONG SHOT 1: chỉ thay đổi câu thoại, video giữ nguyên
    const updatedShot1: ShotSpecComposite = {
      ...shot1,
      audio: {
        dialogueText: "Tôi phải tìm ra con chip trước bình minh.", // modified text
        speakerId: "minh",
      },
    };

    // Shot 2 giữ nguyên 100%
    const updatedShots = [updatedShot1, shot2];

    const plan = graph.computeInvalidationPlan(updatedShots);

    // KẾT QUẢ NGHIỆM THU:
    // 1. Không có video nào bị render lại!
    expect(plan.videoShotsToRender).toEqual([]);
    // 2. Video của cả 2 shot đều được tái sử dụng nguyên vẹn:
    expect(plan.reusableVideoShots.get("ep01_sc01_sh01")).toBe("/output/ep01/shots/sh01_video.mp4");
    expect(plan.reusableVideoShots.get("ep01_sc01_sh02")).toBe("/output/ep01/shots/sh02_video.mp4");
    // 3. Chỉ audio của shot 1 cần sinh lại:
    expect(plan.audioShotsToRender).toEqual(["ep01_sc01_sh01"]);
    // 4. Audio của shot 2 được tái sử dụng:
    expect(plan.reusableAudioShots.get("ep01_sc01_sh02")).toBe("/output/ep01/shots/sh02_audio.mp3");
    // 5. Tính toán tiết kiệm 100% chi phí sinh video
    expect(plan.metrics.savedVideoComputePercent).toBe(100);
  });

  it("Invalidates video when visual prompt changes, keeping audio untouched", async () => {
    const graph = new DependencyInvalidationGraph();

    const shot1: ShotSpecComposite = {
      shotId: "ep01_sc01_sh01",
      video: {
        prompt: "Old prompt: Day scene",
        provider: "api_kling",
        durationSec: 4.0,
      },
      audio: {
        dialogueText: "Chào buổi sáng.",
        speakerId: "minh",
      },
    };

    graph.registerShot(shot1.shotId, shot1, {
      videoAssetPath: "/output/ep01/shots/sh01_video.mp4",
      audioAssetPath: "/output/ep01/shots/sh01_audio.mp3",
    });

    const updatedShot1: ShotSpecComposite = {
      ...shot1,
      video: {
        ...shot1.video,
        prompt: "New prompt: Midnight rain storm",
      },
    };

    const plan = graph.computeInvalidationPlan([updatedShot1]);

    expect(plan.videoShotsToRender).toEqual(["ep01_sc01_sh01"]);
    expect(plan.audioShotsToRender).toEqual([]); // Audio not re-rendered
    expect(plan.reusableAudioShots.get("ep01_sc01_sh01")).toBe("/output/ep01/shots/sh01_audio.mp3");
  });

  it("Respects lip-sync coupling: invalidates video if dialogue changes AND requiresLipSync is true", async () => {
    const graph = new DependencyInvalidationGraph();

    const shot1: ShotSpecComposite = {
      shotId: "ep01_sc01_sh01",
      video: {
        prompt: "Extreme close up of mouth speaking",
        provider: "api_kling",
        durationSec: 3.0,
      },
      audio: {
        dialogueText: "Thì thầm bí mật",
        speakerId: "minh",
      },
      requiresLipSync: true, // EXPLICIT LIP SYNC
    };

    graph.registerShot(shot1.shotId, shot1, {
      videoAssetPath: "/output/ep01/shots/sh01_video.mp4",
      audioAssetPath: "/output/ep01/shots/sh01_audio.mp3",
    });

    const updatedShot1: ShotSpecComposite = {
      ...shot1,
      audio: {
        dialogueText: "Thì thầm điều khác",
        speakerId: "minh",
      },
    };

    const plan = graph.computeInvalidationPlan([updatedShot1]);
    expect(plan.videoShotsToRender).toEqual(["ep01_sc01_sh01"]);
    expect(plan.audioShotsToRender).toEqual(["ep01_sc01_sh01"]);
  });

  it("Full-Spectrum Deterministic Spec Hash: alters hash when character reference, turnaround, or regional conditioning changes", async () => {
    const baseInput = {
      prompt: "Close up portrait of warrior",
      provider: "api_kling",
      modelName: "kling-v3",
      durationSec: 5.0,
      characterReferenceImage: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      characterTurnaround: {
        front: "front_angle.png",
        threeQuarter: "3_4_angle.png",
        profile: "profile_angle.png",
        fullBody: "full_body.png",
        viewAngle: "front" as const,
      },
    };

    const baseHash = computeVideoSpecHash(baseInput);
    expect(baseHash).toBeDefined();
    expect(baseHash.length).toBe(64);

    // 1. Changing characterReferenceImage alters hash
    const changedCharRefHash = await computeVideoSpecHash({
      ...baseInput,
      characterReferenceImage: "data:image/png;base64,DIFFERENT_IMAGE_CONTENT",
    });
    expect(changedCharRefHash).not.toBe(baseHash);

    // 2. Changing any turnaround angle alters hash
    const changedTurnaroundHash = await computeVideoSpecHash({
      ...baseInput,
      characterTurnaround: {
        ...baseInput.characterTurnaround,
        front: "different_front.png",
      },
    });
    expect(changedTurnaroundHash).not.toBe(baseHash);

    // 3. Changing turnaround viewAngle alters hash
    const changedViewAngleHash = await computeVideoSpecHash({
      ...baseInput,
      characterTurnaround: {
        ...baseInput.characterTurnaround,
        viewAngle: "profile" as const,
      },
    });
    expect(changedViewAngleHash).not.toBe(baseHash);

    // 4. Adding regional conditioning alters hash
    const withRegionalHash = await computeVideoSpecHash({
      ...baseInput,
      regionalConditioning: {
        enabled: true,
        characterAPrompt: "Warrior on the left",
        characterASide: "left",
      },
    });
    expect(withRegionalHash).not.toBe(baseHash);

    // 5. Changing secondary character reference alters hash
    const withSecCharHash = await computeVideoSpecHash({
      ...baseInput,
      secondaryCharacterReferenceImage: "sec_char.png",
    });
    expect(withSecCharHash).not.toBe(baseHash);
  });
});
