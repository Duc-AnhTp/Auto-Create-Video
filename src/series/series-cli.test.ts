import { describe, it, expect, vi, beforeEach } from "vitest";
import { runSeriesCli } from "./series-cli.js";
import { BibleManager } from "../bible/bible-manager.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { rm } from "node:fs/promises";

describe("Series CLI Subcommands (series:*)", () => {
  const testDbPath = join("output", "test-series-cli", "story_bible.db");

  beforeEach(async () => {
    if (existsSync(join("output", "test-series-cli"))) {
      try {
        await rm(join("output", "test-series-cli"), { recursive: true, force: true });
      } catch {}
    }
  });

  it("handles series:init, series:character, series:location, series:prop, and series:status end-to-end", async () => {
    // 1. series:init
    await runSeriesCli([
      "series:init",
      "--bible",
      testDbPath,
      "--series",
      "test-series",
      "--title",
      "Test Series Title",
      "--style",
      "Cinematic 35mm cyberpunk",
      "--ratio",
      "9:16",
    ]);

    const bible = new BibleManager(testDbPath);
    const meta = bible.getSeriesMetadata();
    expect(meta?.title).toBe("Test Series Title");
    expect(meta?.visual_style).toBe("Cinematic 35mm cyberpunk");

    // 2. series:character
    await runSeriesCli([
      "series:character",
      "--bible",
      testDbPath,
      "--id",
      "char_minh",
      "--name",
      "Minh",
      "--role",
      "protagonist",
      "--face",
      "assets/minh_face.jpg",
      "--voice",
      "elevenlabs:voice_123",
      "--wardrobe",
      "Áo khoác da đen",
      "--marks",
      "Vết sẹo ở cằm",
    ]);

    const char = bible.getCharacter("char_minh");
    expect(char?.name).toBe("Minh");
    expect(char?.distinguishing_marks).toBe("Vết sẹo ở cằm");
    const wardrobe = bible.getCharacterWardrobe("char_minh");
    expect(wardrobe?.visual_description).toBe("Áo khoác da đen");

    // 3. series:location
    await runSeriesCli([
      "series:location",
      "--bible",
      testDbPath,
      "--id",
      "loc_bar",
      "--name",
      "Bar Hẻm 9",
      "--summary",
      "Quán bar ngầm ngập khói thuốc",
      "--lighting",
      "neon red and blue",
    ]);

    const loc = bible.getLocation("loc_bar");
    expect(loc?.name).toBe("Bar Hẻm 9");

    // 4. series:prop
    await runSeriesCli([
      "series:prop",
      "--bible",
      testDbPath,
      "--id",
      "prop_usb",
      "--name",
      "USB Tuyệt Mật",
      "--summary",
      "USB vỏ titan",
      "--holder",
      "char_minh",
      "--status",
      "intact",
    ]);

    const prop = bible.getKeyProp("prop_usb");
    expect(prop?.name).toBe("USB Tuyệt Mật");
    expect(prop?.current_holder_id).toBe("char_minh");

    // 5. series:status
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await runSeriesCli(["series:status", "--bible", testDbPath]);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("produces an episode from raw script text via series:episode --dry-run", async () => {
    // Initialize DB
    await runSeriesCli([
      "series:init",
      "--bible",
      testDbPath,
      "--series",
      "test-cli-ep",
      "--title",
      "Test Series",
      "--style",
      "Cinematic 35mm",
    ]);

    const rawScript = `
TẬP 1: BẢN HỢP ĐỒNG
Logline: Tập thử nghiệm qua CLI

CẢNH 1: ĐƯỜNG PHỐ - ĐÊM
CÚ MÁY 1 (establishing, 3s): Đường phố Sài Gòn vắng lặng dưới mưa.
MINH: Chúng ta không còn nhiều thời gian.
    `.trim();

    await runSeriesCli([
      "series:episode",
      "--bible",
      testDbPath,
      "--series",
      "test-cli-ep",
      "--script",
      rawScript,
      "--dry-run",
      "--skip-render",
    ]);

    const bible = new BibleManager(testDbPath);
    const history = bible.getCanonHistory();
    expect(history.length).toBe(1);
    expect(history[0].title).toBe("BẢN HỢP ĐỒNG");
  });
});
