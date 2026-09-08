import { describe, it, expect, beforeEach } from "vitest";
import { BibleManager } from "./bible-manager.js";

describe("BibleManager (Phân Hệ I: Story Bible Engine)", () => {
  let manager: BibleManager;

  beforeEach(() => {
    // In-memory or isolated DB
    manager = new BibleManager(":memory:");
  });

  it("manages character profiles and status updates", () => {
    manager.upsertCharacter({
      id: "char_nam_chinh",
      name: "Thám tử Minh",
      role: "protagonist",
      visual_summary: "32 tuổi, tóc đen ngắn, áo khoác da nâu sờn, vết sẹo mờ ở đuôi lông mày trái",
      personality_traits: ["trầm tĩnh", "quan sát tỉ mỉ", "hoài nghi"],
      voice_profile_id: "voice_minh_v1",
      status: "alive",
    });

    const char = manager.getCharacter("char_nam_chinh");
    expect(char).not.toBeNull();
    expect(char?.name).toBe("Thám tử Minh");
    expect(char?.personality_traits).toContain("quan sát tỉ mỉ");

    manager.updateCharacterStatus("char_nam_chinh", "injured");
    const updated = manager.getCharacter("char_nam_chinh");
    expect(updated?.status).toBe("injured");
  });

  it("tracks character knowledge chronologically across episodes", () => {
    manager.addKnowledge("char_nam_chinh", "found_strange_key", 1, "Tìm thấy chìa khóa dưới sàn nhà");
    manager.addKnowledge("char_nam_chinh", "knows_killer_identity", 3, "Phát hiện vết bớt trên tay nghi phạm");

    // In episode 2, character only knows facts from episode 1 or earlier
    const ep2Knowledge = manager.getCharacterKnowledge("char_nam_chinh", 2);
    expect(ep2Knowledge.length).toBe(1);
    expect(ep2Knowledge[0].fact_key).toBe("found_strange_key");

    // In episode 3, character knows both
    const ep3Knowledge = manager.getCharacterKnowledge("char_nam_chinh", 3);
    expect(ep3Knowledge.length).toBe(2);
  });

  it("stores and updates world state", () => {
    manager.setWorldState("quantum_drive_location", "lab_station_safe", 1);
    expect(manager.getWorldState("quantum_drive_location")).toBe("lab_station_safe");

    manager.setWorldState("quantum_drive_location", "stolen_by_shadows", 2);
    expect(manager.getWorldState("quantum_drive_location")).toBe("stolen_by_shadows");

    const all = manager.getAllWorldState();
    expect(all["quantum_drive_location"]).toBe("stolen_by_shadows");
  });

  it("applies narrative deltas correctly after episode review", () => {
    manager.upsertCharacter({
      id: "char_villain",
      name: "Bóng Ma",
      role: "antagonist",
      visual_summary: "Mặt nạ bạc, áo choàng đen",
      personality_traits: ["tàn nhẫn"],
      status: "alive",
    });

    manager.applyNarrativeDelta(2, {
      character_status_updates: [{ id: "char_villain", status: "injured" }],
      new_knowledge: [{ character_id: "char_villain", fact_key: "knows_detective_location" }],
      world_state_updates: { lab_station: "destroyed" },
    });

    expect(manager.getCharacter("char_villain")?.status).toBe("injured");
    expect(manager.getWorldState("lab_station")).toBe("destroyed");
    const k = manager.getCharacterKnowledge("char_villain", 2);
    expect(k[0].fact_key).toBe("knows_detective_location");
  });

  it("generates strict negative constraints for deceased characters", () => {
    manager.upsertCharacter({
      id: "char_mentor",
      name: "Giáo sư Hưng",
      role: "supporting",
      visual_summary: "60 tuổi, râu bạc",
      personality_traits: ["uyên bác"],
      status: "deceased",
    });

    const constraints = manager.getNegativeConstraints(2);
    expect(constraints.some((c) => c.includes("Giáo sư Hưng") && c.includes("đã chết"))).toBe(true);
    // Non-mystery context should not include killer identity constraints
    expect(constraints.some((c) => c.includes("kẻ sát nhân"))).toBe(false);

    const prompt = manager.generateContextPrompt(2);
    expect(prompt).toContain("STORY BIBLE CONTEXT (Tập 2)");
    expect(prompt).toContain("RÀNG BUỘC CỐT TRUYỆN PHỦ ĐỊNH");
  });

  it("generates secret constraints only when secret facts are declared in the bible", () => {
    manager.upsertCharacter({
      id: "char_thanh",
      name: "Thành",
      role: "supporting",
      visual_summary: "Thành, 25 tuổi",
      personality_traits: ["tò mò"],
      status: "alive",
    });

    // Before any secret facts exist
    expect(manager.getNegativeConstraints(2).length).toBe(0);

    // After a secret fact is declared in episode 3
    manager.addKnowledge("char_thanh", "knows_killer_identity", 3, "Biết hung thủ ở tập 3");
    // At episode 2, Thành should have a constraint that they do not know it yet
    const cEp2 = manager.getNegativeConstraints(2);
    expect(cEp2.some((c) => c.includes("Thành") && c.includes("danh tính kẻ sát nhân"))).toBe(true);

    // At episode 4, Thành knows it, so constraint is removed
    const cEp4 = manager.getNegativeConstraints(4);
    expect(cEp4.some((c) => c.includes("Thành") && c.includes("danh tính kẻ sát nhân"))).toBe(false);
  });

  it("logs API usage and computes cumulative episode cost", () => {
    manager.logApiUsage({
      episode_number: 1,
      shot_id: "ep01_sh01",
      provider: "api_wan",
      type: "video",
      units: 5.0,
      cost_usd: 0.50,
      timestamp: new Date().toISOString(),
    });
    manager.logApiUsage({
      episode_number: 1,
      shot_id: "ep01_sh02",
      provider: "api_wan",
      type: "video",
      units: 5.0,
      cost_usd: 0.50,
      timestamp: new Date().toISOString(),
    });

    const total = manager.getEpisodeCost(1);
    expect(total).toBeCloseTo(1.00);
  });

  it("exports consolidated bible payload and audits draft scripts directly", async () => {
    const manager = new BibleManager();
    manager.upsertCharacter({
      id: "char_a",
      name: "Alice",
      role: "protagonist",
      visual_summary: "Alice, tóc vàng",
      personality_traits: ["dũng cảm"],
      status: "deceased",
    });

    const payload = manager.exportBiblePayload(2);
    expect(payload.characters.length).toBe(1);
    expect(payload.characters[0].name).toBe("Alice");

    // Script with deceased Alice appearing without flashback
    const badScript = "Scene 1: Alice walks into the room and speaks to Bob.";
    const auditRes = await manager.auditDraftScript(2, badScript);
    expect(auditRes.audit_status).toBe("FAIL");
    expect(auditRes.contradictions.length).toBeGreaterThanOrEqual(1);
  });

  it("persists and retrieves series metadata (art style, ratio)", () => {
    manager.upsertSeriesMetadata({
      id: "cyber_saigon",
      title: "Cyber Saigon 2088",
      genre: "Cyberpunk Drama",
      visual_style: "Cinematic 35mm, gritty cyber-noir, neon reflections, rainy atmosphere",
      aspect_ratio: "9:16",
      fps: 30,
      created_at: new Date().toISOString(),
    });

    const series = manager.getSeriesMetadata("cyber_saigon");
    expect(series).not.toBeNull();
    expect(series?.title).toBe("Cyber Saigon 2088");
    expect(series?.visual_style).toContain("Cinematic 35mm");
    expect(series?.aspect_ratio).toBe("9:16");
  });

  it("manages locations and settings consistency", () => {
    manager.upsertLocation({
      id: "loc_bar_hem_9",
      name: "Quán Bar Hẻm 9",
      visual_summary: "Quầy bar gỗ cũ kỹ, đèn neon hỏng nhấp nháy chữ B, ẩm ướt",
      atmospheric_rules: "Mưa rơi liên tục ngoài cửa kính",
      reference_image_path: "assets/locations/bar_hem_9.jpg",
      lighting_mood: "dark neon cyan and red",
    });

    const loc = manager.getLocation("loc_bar_hem_9");
    expect(loc?.name).toBe("Quán Bar Hẻm 9");
    expect(loc?.atmospheric_rules).toContain("Mưa rơi");

    const list = manager.listLocations();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe("loc_bar_hem_9");
  });

  it("tracks character wardrobes and outfit changes", () => {
    manager.upsertCharacter({
      id: "char_minh",
      name: "Minh",
      role: "protagonist",
      visual_summary: "30 tuổi, thám tử",
      personality_traits: ["lạnh lùng"],
      status: "alive",
      distinguishing_marks: "Vết sẹo ở lông mày trái",
    });

    manager.upsertWardrobe({
      id: "wardrobe_minh_coat",
      character_id: "char_minh",
      outfit_name: "Áo măng tô da",
      visual_description: "Áo măng tô da nâu sờn vai, sơ mi trắng mở cúc",
      is_default: true,
    });

    manager.upsertWardrobe({
      id: "wardrobe_minh_tuxedo",
      character_id: "char_minh",
      outfit_name: "Bộ vest dạ tiệc",
      visual_description: "Áo tuxedo đen thắt nơ lụa sang trọng",
      is_default: false,
    });

    const wardrobes = manager.listWardrobesForCharacter("char_minh");
    expect(wardrobes.length).toBe(2);

    manager.setCharacterActiveWardrobe("char_minh", "wardrobe_minh_tuxedo");
    const char = manager.getCharacter("char_minh");
    expect(char?.current_wardrobe_id).toBe("wardrobe_minh_tuxedo");
    expect(char?.distinguishing_marks).toBe("Vết sẹo ở lông mày trái");
  });

  it("manages key props, ownership transfers, and destroyed constraints", () => {
    manager.upsertKeyProp({
      id: "prop_chip",
      name: "Con Chip Lượng Tử",
      visual_summary: "Con chip titan phủ vàng có khắc ký hiệu tam giác phát sáng",
      current_holder_id: "char_minh",
      status: "intact",
    });

    const prop = manager.getKeyProp("prop_chip");
    expect(prop?.name).toBe("Con Chip Lượng Tử");
    expect(prop?.current_holder_id).toBe("char_minh");

    // Transfer prop to character An
    manager.transferKeyProp("prop_chip", "char_an");
    expect(manager.getKeyProp("prop_chip")?.current_holder_id).toBe("char_an");

    // Destroy prop -> triggers negative constraint
    manager.transferKeyProp("prop_chip", "char_an", "destroyed");
    const constraints = manager.getNegativeConstraints(2);
    expect(constraints.some((c) => c.includes("Con Chip Lượng Tử") && c.includes("đã bị phá hủy"))).toBe(true);
  });

  it("generates comprehensive context prompt including style, locations, wardrobes and props", () => {
    manager.upsertSeriesMetadata({
      id: "series_1",
      title: "Phim Trinh Thám",
      visual_style: "Phim điện ảnh 35mm phong cách Noir",
      aspect_ratio: "9:16",
      fps: 30,
      created_at: new Date().toISOString(),
    });

    manager.upsertCharacter({
      id: "char_hero",
      name: "Dũng",
      role: "protagonist",
      visual_summary: "Thanh niên trẻ",
      personality_traits: ["quyết đoán"],
      status: "alive",
      distinguishing_marks: "Hình xăm hoa hồng ở cổ",
      current_wardrobe_id: "w_combat",
    });

    manager.upsertWardrobe({
      id: "w_combat",
      character_id: "char_hero",
      outfit_name: "Đồ chiến thuật",
      visual_description: "Áo giáp Kevlar đen, quần rằn ri",
      is_default: true,
    });

    manager.upsertLocation({
      id: "loc_can_cu",
      name: "Căn Cứ Ngầm",
      visual_summary: "Hầm bê tông lạnh lẽo",
    });

    manager.upsertKeyProp({
      id: "prop_chia_khoa",
      name: "Chìa Khóa Cổ",
      visual_summary: "Chìa khóa đồng gỉ sét",
      current_holder_id: "char_hero",
      status: "intact",
    });

    const prompt = manager.generateContextPrompt(1);
    expect(prompt).toContain("Phim điện ảnh 35mm phong cách Noir");
    expect(prompt).toContain("Dũng");
    expect(prompt).toContain("Hình xăm hoa hồng ở cổ");
    expect(prompt).toContain("Đồ chiến thuật");
    expect(prompt).toContain("Căn Cứ Ngầm");
    expect(prompt).toContain("Chìa Khóa Cổ");
  });
});
