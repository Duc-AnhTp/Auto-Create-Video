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

    const prompt = manager.generateContextPrompt(2);
    expect(prompt).toContain("STORY BIBLE CONTEXT (Tập 2)");
    expect(prompt).toContain("RÀNG BUỘC CỐT TRUYỆN PHỦ ĐỊNH");
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
});
