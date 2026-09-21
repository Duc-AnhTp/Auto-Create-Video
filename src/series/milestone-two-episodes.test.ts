import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BibleManager } from "../bible/bible-manager.js";
import { finalizeEpisodeProduction } from "./finalize-service.js";
import { SeasonOrchestrator } from "../orchestration/season-orchestrator.js";
import { createValidMockMp4File } from "../assets/mock-media-generator.js";

describe("Milestone: 2 Consecutive Episodes Real Production Pipeline", () => {
  const testDbPath = join("data", "test-milestone-2eps.db");
  const testOutputDir = join("data", "test-milestone-output");
  let bible: BibleManager;

  const seriesId = "series_milestone_2eps";
  const planId = "plan_milestone_2eps";

  beforeEach(async () => {
    BibleManager.closeAll();
    await rm(testDbPath, { force: true });
    await rm(testOutputDir, { recursive: true, force: true });
    await mkdir(testOutputDir, { recursive: true });

    bible = new BibleManager(testDbPath);

    // 1. Setup Series Metadata & Story Bible
    bible.upsertSeriesMetadata({
      id: seriesId,
      title: "Bí Mật Thành Phố Ngầm",
      genre: "Cyberpunk Mystery",
      visual_style: "Cinematic 35mm, neon noir, anamorphic lens",
      aspect_ratio: "9:16",
      fps: 30,
      created_at: new Date().toISOString(),
    });

    // Characters: Detective Minh & Assistant Lan
    bible.upsertCharacter({
      id: "char_minh",
      series_id: seriesId,
      name: "Minh",
      role: "protagonist",
      status: "alive",
      visual_summary: "Minh, 32 tuổi, thám tử điều tra, áo khoác dạ xám",
    });

    bible.upsertCharacter({
      id: "char_lan",
      series_id: seriesId,
      name: "Lan",
      role: "supporting",
      status: "alive",
      visual_summary: "Lan, 26 tuổi, chuyên gia mật mã, kính mắt phát quang",
    });

    // Key Prop: Cyber Code (initially held by Minh)
    bible.upsertKeyProp({
      id: "prop_cyber_code",
      series_id: seriesId,
      name: "Mật mã Cyber",
      current_holder_id: "char_minh",
      visual_summary: "Thẻ nhớ kim loại phát sáng ánh xanh chứa thuật toán mật mã",
      status: "intact",
    });

    // Locations
    bible.upsertLocation({
      id: "loc_van_phong",
      series_id: seriesId,
      name: "Văn Phòng Thám Tử",
      visual_summary: "Văn phòng ngầm cũ kỹ ngập ánh đèn neon xanh tím",
    });

    // Series Plan (2 Episodes, 120s each)
    bible.upsertSeriesPlan({
      id: planId,
      series_id: seriesId,
      source_id: "novel_cyber_01",
      revision: 1,
      target_episodes: 2,
      target_duration_per_episode_sec: 120,
      pacing_preset: "standard",
      status: "approved",
      summary_json: JSON.stringify({
        totalEpisodes: 2,
        arcs: ["Điều tra vụ rò rỉ dữ liệu"],
      }),
    });

    bible.upsertPlannedEpisode({
      id: `${planId}_ep1`,
      plan_id: planId,
      series_id: seriesId,
      episode_number: 1,
      title: "Tập 1: Chuyển Giao Mật Mã",
      logline: "Minh bàn giao Mật mã Cyber cho Lan bảo quản trước khi dấn thân vào vùng nguy hiểm.",
      target_duration_sec: 120,
    });

    bible.upsertPlannedEpisode({
      id: `${planId}_ep2`,
      plan_id: planId,
      series_id: seriesId,
      episode_number: 2,
      title: "Tập 2: Giải Mã Bí Mật",
      logline: "Lan tiến hành giải mã dữ liệu và phát hiện Tập đoàn Nova đứng sau vụ rò rỉ.",
      target_duration_sec: 120,
    });
  });

  afterEach(async () => {
    BibleManager.closeAll();
    await rm(testDbPath, { force: true });
    await rm(testOutputDir, { recursive: true, force: true });
  });

  it("Executes end-to-end 2 consecutive episodes with prop transfer and secret discovery", async () => {
    // ══════════════════════════════════════════════════════════════════════════
    // EPISODE 1: "Chuyển Giao Mật Mã"
    // ══════════════════════════════════════════════════════════════════════════
    const ep1Dir = join(testOutputDir, "ep-01");
    const ep1AssemblyDir = join(ep1Dir, "assembly");
    await mkdir(ep1AssemblyDir, { recursive: true });

    // Create real video files for shots
    const ep1Sh1Path = join(ep1Dir, "sh01_take01.mp4");
    const ep1Sh2Path = join(ep1Dir, "sh02_take01.mp4");
    await createValidMockMp4File(ep1Sh1Path, 3, 720, 1280);
    await createValidMockMp4File(ep1Sh2Path, 3, 720, 1280);

    // Record approved takes in Story Bible
    bible.recordShotTake({
      id: "take_ep1_sh01",
      series_id: seriesId,
      episode_number: 1,
      shot_id: "ep1_sh01",
      provider: "kling",
      prompt: "Minh đứng bên cửa sổ văn phòng, tay cầm Mật mã Cyber",
      duration_sec: 3.0,
      local_path: ep1Sh1Path,
      is_approved: 1,
      created_at: new Date().toISOString(),
    });

    bible.recordShotTake({
      id: "take_ep1_sh02",
      series_id: seriesId,
      episode_number: 1,
      shot_id: "ep1_sh02",
      provider: "kling",
      prompt: "Minh đưa Mật mã Cyber cho Lan. Lan nhận lấy và cất vào túi áo",
      duration_sec: 3.0,
      local_path: ep1Sh2Path,
      is_approved: 1,
      created_at: new Date().toISOString(),
    });

    // Write Episode 1 Timeline with stems
    const ep1Timeline = {
      dialogueTrack: [
        {
          id: "dia_ep1_01",
          speaker: "Minh",
          text: "Lan, cầm lấy cái này. Cô là người duy nhất tôi tin tưởng.",
          startSec: 0.5,
          durationSec: 2.0,
        },
      ],
      sfxTrack: [
        {
          id: "sfx_ep1_01",
          name: "digital_beep",
          startSec: 3.2,
          durationSec: 0.5,
        },
      ],
      ambienceTrack: {
        name: "neon_hum",
        volume: 0.3,
      },
      bgmTrack: {
        name: "cyberpunk_tension",
        volume: 0.4,
      },
      subtitleTrack: [
        {
          id: "sub_ep1_01",
          text: "Lan, cầm lấy cái này. Cô là người duy nhất tôi tin tưởng.",
          startSec: 0.5,
          durationSec: 2.0,
        },
      ],
    };
    await writeFile(join(ep1Dir, "timeline.json"), JSON.stringify(ep1Timeline, null, 2));

    const ep1Script = {
      seriesId,
      episodeNumber: 1,
      title: "Tập 1: Chuyển Giao Mật Mã",
      logline: "Minh bàn giao Mật mã Cyber cho Lan bảo quản trước khi dấn thân vào nguy hiểm.",
      scenes: [
        {
          sceneId: "ep1_sc01",
          sceneNumber: 1,
          locationId: "loc_van_phong",
          charactersPresent: ["char_minh", "char_lan"],
          propsPresent: ["prop_cyber_code"],
          shots: [
            {
              shotId: "ep1_sh01",
              durationSec: 3,
              visualPrompt: "Minh đứng bên bàn làm việc, ngắm nhìn chiếc Mật mã Cyber.",
            },
            {
              shotId: "ep1_sh02",
              durationSec: 3,
              visualPrompt: "Minh đưa chiếc Mật mã Cyber cho Lan. Lan nhận lấy và cẩn thận cất vào túi áo.",
            },
          ],
        },
      ],
    };

    // Finalize Episode 1
    const resEp1 = await finalizeEpisodeProduction({
      seriesId,
      episodeNumber: 1,
      script: ep1Script,
      bible,
      outputDir: ep1Dir,
      allowMockMedia: true,
    });

    expect(resEp1.success).toBe(true);
    expect(resEp1.canonCommitted).toBe(true);
    expect(resEp1.masterVideoPath).toBeDefined();
    expect(existsSync(resEp1.masterVideoPath!)).toBe(true);

    // Verify Prop Transfer in Story Bible: Lan is now the holder of Cyber Code!
    const updatedPropEp1 = bible.getKeyProp("prop_cyber_code");
    expect(updatedPropEp1?.current_holder_id).toBe("char_lan");

    // Verify Canon History has 1 entry
    const canonEp1 = bible.getCanonHistory(seriesId);
    expect(canonEp1.length).toBe(1);
    expect(canonEp1[0].episode_number).toBe(1);
    expect(canonEp1[0].title).toBe("Tập 1: Chuyển Giao Mật Mã");

    // ══════════════════════════════════════════════════════════════════════════
    // EPISODE 2: "Giải Mã Bí Mật"
    // ══════════════════════════════════════════════════════════════════════════
    const ep2Dir = join(testOutputDir, "ep-02");
    const ep2AssemblyDir = join(ep2Dir, "assembly");
    await mkdir(ep2AssemblyDir, { recursive: true });

    const ep2Sh1Path = join(ep2Dir, "sh01_take01.mp4");
    const ep2Sh2Path = join(ep2Dir, "sh02_take01.mp4");
    await createValidMockMp4File(ep2Sh1Path, 3, 720, 1280);
    await createValidMockMp4File(ep2Sh2Path, 3, 720, 1280);

    bible.recordShotTake({
      id: "take_ep2_sh01",
      series_id: seriesId,
      episode_number: 2,
      shot_id: "ep2_sh01",
      provider: "kling",
      prompt: "Lan ngồi trước màn hình ba chiều, cắm Mật mã Cyber vào máy phân tích",
      duration_sec: 3.0,
      local_path: ep2Sh1Path,
      is_approved: 1,
      created_at: new Date().toISOString(),
    });

    bible.recordShotTake({
      id: "take_ep2_sh02",
      series_id: seriesId,
      episode_number: 2,
      shot_id: "ep2_sh02",
      provider: "kling",
      prompt: "Màn hình lóe sáng, hiện logo Tập đoàn Nova và tài liệu rò rỉ",
      duration_sec: 3.0,
      local_path: ep2Sh2Path,
      is_approved: 1,
      created_at: new Date().toISOString(),
    });

    const ep2Timeline = {
      dialogueTrack: [
        {
          id: "dia_ep2_01",
          speaker: "Lan",
          text: "Không thể tin được... Tập đoàn Nova chính là kẻ chủ mưu!",
          startSec: 1.0,
          durationSec: 2.5,
        },
      ],
      sfxTrack: [
        {
          id: "sfx_ep2_01",
          name: "terminal_access_granted",
          startSec: 0.5,
          durationSec: 0.8,
        },
      ],
      ambienceTrack: { name: "server_room_hum", volume: 0.2 },
      bgmTrack: { name: "revelation_synth", volume: 0.5 },
      subtitleTrack: [
        {
          id: "sub_ep2_01",
          text: "Không thể tin được... Tập đoàn Nova chính là kẻ chủ mưu!",
          startSec: 1.0,
          durationSec: 2.5,
        },
      ],
    };
    await writeFile(join(ep2Dir, "timeline.json"), JSON.stringify(ep2Timeline, null, 2));

    const ep2Script = {
      seriesId,
      episodeNumber: 2,
      title: "Tập 2: Giải Mã Bí Mật",
      logline: "Lan tiến hành giải mã dữ liệu và phát hiện Tập đoàn Nova đứng sau vụ rò rỉ.",
      scenes: [
        {
          sceneId: "ep2_sc01",
          sceneNumber: 1,
          locationId: "loc_van_phong",
          charactersPresent: ["char_lan"],
          propsPresent: ["prop_cyber_code"],
          shots: [
            {
              shotId: "ep2_sh01",
              durationSec: 3,
              visualPrompt: "Lan cắm Mật mã Cyber vào khe đọc của máy chủ.",
            },
            {
              shotId: "ep2_sh02",
              durationSec: 3,
              visualPrompt: "Màn hình giải mã hé lộ tài liệu tuyệt mật của Tập đoàn Nova.",
            },
          ],
        },
      ],
      newKnowledge: [
        {
          characterId: "char_lan",
          factKey: "secret_nova_leak",
          notes: "Tập đoàn Nova đứng sau vụ rò rỉ dữ liệu mật mã",
        },
      ],
    };

    // Finalize Episode 2
    const resEp2 = await finalizeEpisodeProduction({
      seriesId,
      episodeNumber: 2,
      script: ep2Script,
      bible,
      outputDir: ep2Dir,
      allowMockMedia: true,
    });

    expect(resEp2.success).toBe(true);
    expect(resEp2.canonCommitted).toBe(true);
    expect(resEp2.masterVideoPath).toBeDefined();
    expect(existsSync(resEp2.masterVideoPath!)).toBe(true);

    // Verify Prop Holder continuity: Lan still holds prop_cyber_code
    const propAfterEp2 = bible.getKeyProp("prop_cyber_code");
    expect(propAfterEp2?.current_holder_id).toBe("char_lan");

    // Verify Knowledge State discovery in Story Bible
    const knowledgeStates = bible.listKnowledgeStates(seriesId);
    const novaSecret = knowledgeStates.find((k) => k.fact_key === "secret_nova_leak");
    expect(novaSecret).toBeDefined();
    expect(novaSecret?.entity_id).toBe("char_lan");
    expect(novaSecret?.notes).toContain("Tập đoàn Nova");

    // Verify Canon History has 2 entries in sequential order
    const canonEp2 = bible.getCanonHistory(seriesId);
    expect(canonEp2.length).toBe(2);
    expect(canonEp2[0].episode_number).toBe(1);
    expect(canonEp2[1].episode_number).toBe(2);

    // ══════════════════════════════════════════════════════════════════════════
    // RESUME & SPECHASH INVALIDATION
    // ══════════════════════════════════════════════════════════════════════════
    const orchestrator = new SeasonOrchestrator(bible);
    const plannedEp1 = bible.getPlannedEpisode(`${planId}_ep1`)!;

    // 1. Identical parameters produce identical specHash (reproducible resume)
    const hash1a = orchestrator.computeEpisodeSpecHash(
      seriesId,
      planId,
      plannedEp1,
      { seriesId, provider: "mock", mockTts: true, allowMockMedia: true },
      ep1Dir
    );
    const hash1b = orchestrator.computeEpisodeSpecHash(
      seriesId,
      planId,
      plannedEp1,
      { seriesId, provider: "mock", mockTts: true, allowMockMedia: true },
      ep1Dir
    );
    expect(hash1a).toBe(hash1b);

    // 2. Switching mockTts: true -> false invalidates hash (prevents stale mock audio)
    const hashRealTts = orchestrator.computeEpisodeSpecHash(
      seriesId,
      planId,
      plannedEp1,
      { seriesId, provider: "mock", mockTts: false, allowMockMedia: true },
      ep1Dir
    );
    expect(hashRealTts).not.toBe(hash1a);

    // 3. Switching allowMockMedia invalidates hash
    const hashStrictMedia = orchestrator.computeEpisodeSpecHash(
      seriesId,
      planId,
      plannedEp1,
      { seriesId, provider: "mock", mockTts: true, allowMockMedia: false },
      ep1Dir
    );
    expect(hashStrictMedia).not.toBe(hash1a);
  });
});
