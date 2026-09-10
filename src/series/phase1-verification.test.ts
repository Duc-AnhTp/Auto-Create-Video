import { describe, it, expect, beforeEach } from "vitest";
import { parseRawScreenplay, enrichWithBibleContext } from "./script-normalizer.js";
import { buildMasterTimeline, AudioAssembler } from "./audio-assembler.js";
import { BibleManager } from "../bible/bible-manager.js";
import { generateValidMockMp3, generateValidMockMp4 } from "../assets/mock-media-generator.js";

describe("Phase 1 Verification: Script Normalizer CÚ MÁY, MasterTimeline & Container Compliance", () => {
  let bible: BibleManager;

  beforeEach(() => {
    bible = new BibleManager(":memory:");
    bible.upsertSeriesMetadata({
      id: "cyber-saigon",
      title: "Sài Gòn 2088",
      genre: "Cyberpunk",
      visual_style: "Cinematic 35mm, neon lights, rainy Saigon alleys",
      aspect_ratio: "9:16",
      fps: 30,
      created_at: new Date().toISOString(),
    });

    bible.upsertCharacter({
      id: "char_minh",
      name: "Minh",
      role: "protagonist",
      visual_summary: "Thám tử tư lạnh lùng",
      personality_traits: ["thận trọng"],
      voice_profile_id: "elevenlabs:voice_minh_123",
      status: "alive",
      face_reference_image: "assets/characters/minh_face.jpg",
      distinguishing_marks: "Vết sẹo ngang lông mày",
    });

    bible.upsertCharacter({
      id: "char_an",
      name: "An",
      role: "supporting",
      visual_summary: "Hacker trẻ tuổi",
      personality_traits: ["nhanh nhẹn"],
      voice_profile_id: "lucylab:voice_an_456",
      status: "alive",
      face_reference_image: "assets/characters/an_face.jpg",
    });
  });

  describe("1. Vietnamese CÚ MÁY & Shot Metadata Normalization", () => {
    it("parses episode title, number, logline, and multi-line CÚ MÁY shots accurately", () => {
      const rawScript = `
TẬP 1: BẢN HỢP ĐỒNG BÓNG ĐÊM
Logline: Thám tử Minh bí mật bàn giao Con Chip Lượng Tử cho hacker An.

CẢNH 1: QUÁN BAR HẺM 9 - ĐÊM
Nhân vật: Minh, An

CÚ MÁY 1 (establishing, 4s): Khung cảnh hẻm tối Sài Gòn 2088 ngập tràn ánh đèn neon đỏ.
CÚ MÁY 2 (medium, 4s): Minh ngồi trong góc khuất của quán Bar Hẻm 9.
MINH: Cầm lấy con chip này. Bọn chúng đã lần theo tín hiệu đến tận đây rồi.
CÚ MÁY 3 (close_up, 4s): An mở chiếc hộp nhỏ, ánh sáng xanh ngọc phản chiếu vào mắt.
AN: "Chip mã hóa 5 lớp... Tôi sẽ cần ít nhất 3 giờ để giải mã toàn bộ dữ liệu."
CÚ MÁY 4 (action, 3s): Đột nhiên tiếng bước chân dồn dập vang lên từ cầu thang.
SFX: footstep_heavy
MINH: Cửa sau! Đi mau!
`.trim();

      const parsed = parseRawScreenplay(rawScript);
      expect(parsed.episodeNumber).toBe(1);
      expect(parsed.title).toBe("BẢN HỢP ĐỒNG BÓNG ĐÊM");
      expect(parsed.logline).toContain("Thám tử Minh bí mật bàn giao");

      expect(parsed.scenes.length).toBe(1);
      const scene1 = parsed.scenes[0];
      expect(scene1.shots.length).toBe(4);

      // Shot 1: Non-dialogue establishing shot (4s)
      expect(scene1.shots[0].shotId).toBe("sc01_sh01");
      expect(scene1.shots[0].shotType).toBe("establishing");
      expect(scene1.shots[0].durationSec).toBe(4.0);
      expect(scene1.shots[0].visualPrompt).toContain("Khung cảnh hẻm tối Sài Gòn 2088");
      expect(scene1.shots[0].dialogue).toBeUndefined();

      // Shot 2: Medium shot (4s) with Minh dialogue
      expect(scene1.shots[1].shotId).toBe("sc01_sh02");
      expect(scene1.shots[1].shotType).toBe("medium");
      expect(scene1.shots[1].durationSec).toBe(4.0);
      expect(scene1.shots[1].dialogue?.speaker).toBe("MINH");
      expect(scene1.shots[1].dialogue?.text).toBe("Cầm lấy con chip này. Bọn chúng đã lần theo tín hiệu đến tận đây rồi.");

      // Shot 3: Close up shot (4s) with An dialogue (quotes stripped)
      expect(scene1.shots[2].shotId).toBe("sc01_sh03");
      expect(scene1.shots[2].shotType).toBe("close_up");
      expect(scene1.shots[2].durationSec).toBe(4.0);
      expect(scene1.shots[2].dialogue?.speaker).toBe("AN");
      expect(scene1.shots[2].dialogue?.text).toBe("Chip mã hóa 5 lớp... Tôi sẽ cần ít nhất 3 giờ để giải mã toàn bộ dữ liệu.");

      // Shot 4: Action shot (3s) with SFX and Minh dialogue
      expect(scene1.shots[3].shotId).toBe("sc01_sh04");
      expect(scene1.shots[3].shotType).toBe("action");
      expect(scene1.shots[3].durationSec).toBe(3.0);
      expect(scene1.shots[3].sfxCue?.name).toBe("footstep_heavy");
      expect(scene1.shots[3].dialogue?.speaker).toBe("MINH");
      expect(scene1.shots[3].dialogue?.text).toBe("Cửa sau! Đi mau!");
    });
  });

  describe("2. MasterTimeline Timecode Locking & Zero-Drift Synchronization", () => {
    it("locks each dialogue and SFX cue to its exact visual shot start time", () => {
      const rawScript = `
TẬP 1: BẢN HỢP ĐỒNG BÓNG ĐÊM
Logline: Test episode

CẢNH 1: QUÁN BAR HẺM 9 - ĐÊM
Nhân vật: Minh, An

CÚ MÁY 1 (establishing, 4s): Khung cảnh hẻm tối.
CÚ MÁY 2 (medium, 4s): Minh ngồi trong góc khuất.
MINH: Cầm lấy con chip này.
CÚ MÁY 3 (close_up, 5s): An mở chiếc hộp nhỏ.
AN: Chip mã hóa 5 lớp.
CÚ MÁY 4 (action, 3s): Đột nhiên tiếng bước chân.
SFX: gun_cock
MINH: Đi mau!
`.trim();

      const intermediate = parseRawScreenplay(rawScript);
      const enriched = enrichWithBibleContext(intermediate, bible);
      const timeline = buildMasterTimeline(enriched, 30);

      // Total duration = 4s + 4s + 5s + 3s = 16s
      expect(timeline.totalDurationSec).toBe(16.0);
      expect(timeline.videoTrack.length).toBe(4);

      // Shot 1: 0.0s -> 4.0s
      expect(timeline.videoTrack[0].startSec).toBe(0.0);
      expect(timeline.videoTrack[0].endSec).toBe(4.0);
      expect(timeline.videoTrack[0].durationSec).toBe(4.0);

      // Shot 2: 4.0s -> 8.0s
      expect(timeline.videoTrack[1].startSec).toBe(4.0);
      expect(timeline.videoTrack[1].endSec).toBe(8.0);
      expect(timeline.videoTrack[1].durationSec).toBe(4.0);

      // Shot 3: 8.0s -> 13.0s
      expect(timeline.videoTrack[2].startSec).toBe(8.0);
      expect(timeline.videoTrack[2].endSec).toBe(13.0);
      expect(timeline.videoTrack[2].durationSec).toBe(5.0);

      // Shot 4: 13.0s -> 16.0s
      expect(timeline.videoTrack[3].startSec).toBe(13.0);
      expect(timeline.videoTrack[3].endSec).toBe(16.0);
      expect(timeline.videoTrack[3].durationSec).toBe(3.0);

      // Dialogue track must strictly match corresponding shot start times!
      expect(timeline.dialogueTrack.length).toBe(3);

      // Minh's dialogue in Shot 2 MUST start at exactly 4.0s (not 0s!)
      expect(timeline.dialogueTrack[0].shotId).toBe("sc01_sh02");
      expect(timeline.dialogueTrack[0].startSec).toBe(4.0);
      expect(timeline.dialogueTrack[0].speakerName).toBe("Minh");

      // An's dialogue in Shot 3 MUST start at exactly 8.0s
      expect(timeline.dialogueTrack[1].shotId).toBe("sc01_sh03");
      expect(timeline.dialogueTrack[1].startSec).toBe(8.0);
      expect(timeline.dialogueTrack[1].speakerName).toBe("An");

      // Minh's dialogue in Shot 4 MUST start at exactly 13.0s
      expect(timeline.dialogueTrack[2].shotId).toBe("sc01_sh04");
      expect(timeline.dialogueTrack[2].startSec).toBe(13.0);
      expect(timeline.dialogueTrack[2].speakerName).toBe("Minh");

      // SFX cue in Shot 4 MUST start at 13.0s
      expect(timeline.sfxTrack.length).toBe(1);
      expect(timeline.sfxTrack[0].name).toBe("gun_cock");
      expect(timeline.sfxTrack[0].startSec).toBe(13.0);
    });

    it("assembles mock episode audio with exact timeline duration match", async () => {
      const rawScript = `
TẬP 1: BẢN HỢP ĐỒNG BÓNG ĐÊM
Logline: Test episode

CẢNH 1: QUÁN BAR HẺM 9 - ĐÊM
Nhân vật: Minh, An

CÚ MÁY 1 (establishing, 4s): Khung cảnh hẻm tối.
CÚ MÁY 2 (medium, 4s): Minh ngồi trong góc khuất.
MINH: Cầm lấy con chip này.
CÚ MÁY 3 (action, 3s): Tiếng bước chân.
MINH: Đi mau!
`.trim();

      const intermediate = parseRawScreenplay(rawScript);
      const enriched = enrichWithBibleContext(intermediate, bible);
      const assembler = new AudioAssembler();

      const audioResult = await assembler.assembleEpisodeAudio({
        script: enriched,
        bible,
        outputDir: "output/test-phase1-audio",
        mockTts: true,
      });

      // Expected total duration: 4s + 4s + 3s = 11s
      expect(audioResult.totalDurationSec).toBe(11.0);
      expect(audioResult.timeline.totalDurationSec).toBe(11.0);
      expect(audioResult.dialogueTracks.length).toBe(2);
      expect(audioResult.dialogueTracks[0].shotId).toBe("sc01_sh02");
      expect(audioResult.dialogueTracks[1].shotId).toBe("sc01_sh03");
    });
  });

  describe("3. Container & Codec Compliant Mock Media", () => {
    it("generates MP3 buffers with valid MPEG audio headers rather than plain ASCII strings", () => {
      const mp3 = generateValidMockMp3(2.5);
      expect(Buffer.isBuffer(mp3)).toBe(true);
      expect(mp3.length).toBeGreaterThan(0);
      // Valid MPEG sync word
      expect(mp3[0]).toBe(0xff);
      expect(mp3[1]).toBe(0xfb);
      // Ensure it is NOT a plain ASCII mock string
      expect(mp3.toString("ascii")).not.toContain("MOCK_AUDIO");
    });

    it("generates MP4 buffers with valid ISO BMFF container boxes rather than plain ASCII strings", () => {
      const mp4 = generateValidMockMp4(4.0, 720, 1280);
      expect(Buffer.isBuffer(mp4)).toBe(true);
      expect(mp4.length).toBeGreaterThan(0);
      // Contains valid ftyp and moov atoms
      expect(mp4.toString("ascii")).toContain("ftyp");
      expect(mp4.toString("ascii")).toContain("isom");
      expect(mp4.toString("ascii")).toContain("moov");
      // Ensure it is NOT a plain ASCII mock string
      expect(mp4.toString("ascii")).not.toContain("MOCK_VIDEO");
    });
  });
});
