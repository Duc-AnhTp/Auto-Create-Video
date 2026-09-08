import { describe, it, expect } from "vitest";
import {
  deriveAuditStatus,
  escapeXmlContent,
  buildAuditPrompt,
  parseAuditResponse,
  ContinuityAuditor,
  type ContradictionReport,
  type StoryBiblePayload,
} from "./continuity-auditor.js";

describe("Continuity Auditor Engine (Phân Hệ I - Anti-Narrative Drift)", () => {
  const mockBible: StoryBiblePayload = {
    characters: [
      {
        id: "char_nam",
        name: "Nam",
        role: "protagonist",
        visual_summary: "Nam, 32 tuổi, sẹo lông mày trái, áo khoác da màu nâu",
        personality_traits: ["quyết đoán", "ít nói"],
        status: "alive",
      },
      {
        id: "char_hung",
        name: "Hùng",
        role: "antagonist",
        visual_summary: "Hùng, 45 tuổi, đeo kính gọng vàng",
        personality_traits: ["nham hiểm"],
        status: "deceased",
      },
      {
        id: "char_lan",
        name: "Lan",
        role: "supporting",
        visual_summary: "Lan, 28 tuổi, tóc buộc đuôi ngựa",
        personality_traits: ["thông minh"],
        status: "injured",
      },
    ],
    character_knowledge: [
      {
        character_id: "char_nam",
        fact_key: "knows_secret_key",
        revealed_in_episode: 1,
      },
    ],
    world_state: {
      lab_station: "destroyed",
    },
    episode_summaries: [
      {
        episode_number: 1,
        title: "Khởi đầu đen tối",
        logline: "Hùng bị sát hại trong căn hầm bí mật.",
        major_events: ["Hùng bị sát hại", "Nam tìm thấy chìa khóa"],
        delta_changes: {},
        created_at: "2026-09-08T00:00:00Z",
      },
    ],
  };

  describe("deriveAuditStatus", () => {
    it("returns PASS when contradictions list is empty", () => {
      expect(deriveAuditStatus([])).toBe("PASS");
    });

    it("returns FAIL when at least one contradiction has critical severity", () => {
      const reports: ContradictionReport[] = [
        {
          severity: "critical",
          type: "character_status",
          description: "Nhân vật đã chết xuất hiện.",
          bible_reference: "characters.char_hung.status",
          script_location: { scene_number: 1, line_quote: "Hùng bước vào phòng." },
          recommended_fix: "Chuyển thành hồi tưởng.",
        },
      ];
      expect(deriveAuditStatus(reports)).toBe("FAIL");
    });

    it("returns WARN when only moderate or minor contradictions exist", () => {
      const reports: ContradictionReport[] = [
        {
          severity: "moderate",
          type: "item_continuity",
          description: "Vật phẩm xuất hiện không giải thích.",
          bible_reference: "world_state.key_items",
          script_location: { scene_number: 2, line_quote: "Cầm chìa khóa lên." },
          recommended_fix: "Thêm cảnh nhặt chìa khóa.",
        },
        {
          severity: "minor",
          type: "physical_description",
          description: "Màu áo khoác hơi khác biệt.",
          bible_reference: "characters.char_nam.visual_summary",
          script_location: { scene_number: 3, line_quote: "Nam mặc áo khoác xám." },
          recommended_fix: "Đồng bộ lại thành áo khoác nâu.",
        },
      ];
      expect(deriveAuditStatus(reports)).toBe("WARN");
    });
  });

  describe("escapeXmlContent & buildAuditPrompt", () => {
    it("properly escapes XML special characters", () => {
      const dirty = `<script alert="hello">&"bye"</script>`;
      const escaped = escapeXmlContent(dirty);
      expect(escaped).not.toContain("<script");
      expect(escaped).toContain("&lt;script");
      expect(escaped).toContain("&amp;");
    });

    it("wraps Bible and Draft Script in distinct XML boundaries", () => {
      const prompt = buildAuditPrompt(2, mockBible, "Scene 1: Nam gặp Lan.");
      expect(prompt).toContain("<story_bible>");
      expect(prompt).toContain("</story_bible>");
      expect(prompt).toContain("<draft_script>");
      expect(prompt).toContain("Scene 1: Nam gặp Lan.");
      expect(prompt).toContain("</draft_script>");
      expect(prompt).toContain("<episode_number>\n2\n</episode_number>");
    });
  });

  describe("parseAuditResponse", () => {
    it("parses clean JSON and preserves PASS state", () => {
      const raw = JSON.stringify({
        episode_number: 2,
        thought_process: ["Đã kiểm tra nhân vật", "Đã kiểm tra kiến thức"],
        contradictions: [],
        audit_status: "PASS",
        summary: "Kịch bản sạch, không có mâu thuẫn.",
      });

      const res = parseAuditResponse(raw, 2);
      expect(res.audit_status).toBe("PASS");
      expect(res.contradictions.length).toBe(0);
      expect(res.thought_process.length).toBe(2);
    });

    it("strips markdown json fences and enforces FAIL if critical error exists", () => {
      const rawWithFences = `\`\`\`json
{
  "episode_number": 2,
  "thought_process": ["Phát hiện nhân vật chết xuất hiện"],
  "contradictions": [
    {
      "severity": "critical",
      "type": "character_status",
      "description": "Hùng đã chết ở tập 1 nhưng vẫn xuất hiện bình thường.",
      "bible_reference": "characters.char_hung.status",
      "script_location": {
        "scene_number": 1,
        "line_quote": "Hùng: Chào Nam, lâu rồi không gặp."
      },
      "recommended_fix": "Xóa Hùng hoặc đổi thành flashback."
    }
  ],
  "audit_status": "PASS",
  "summary": "Kịch bản có mâu thuẫn."
}
\`\`\``;

      // Notice: Even though the hallucinated LLM JSON said "audit_status": "PASS",
      // the engine must deterministically enforce "FAIL" because of the critical contradiction!
      const res = parseAuditResponse(rawWithFences, 2);
      expect(res.audit_status).toBe("FAIL");
      expect(res.contradictions[0].severity).toBe("critical");
      expect(res.contradictions[0].type).toBe("character_status");
    });
  });

  describe("ContinuityAuditor Execution (Rule-Based & LLM Invoker)", () => {
    const auditor = new ContinuityAuditor();

    it("passes cleanly on consistent script without deceased characters", async () => {
      const script = `
        CẢNH 1: PHÒNG LÀM VIỆC - NGÀY
        Nam ngồi quan sát bản đồ. Nam suy ngẫm về chìa khóa bí mật đã tìm thấy ở tập trước.
      `;

      const result = await auditor.auditScript(2, mockBible, script);
      expect(result.audit_status).toBe("PASS");
      expect(result.contradictions.length).toBe(0);
    });

    it("flags critical contradiction when a deceased character appears without flashback", async () => {
      const script = `
        CẢNH 1: QUÁN CÀ PHÊ - ĐÊM
        Hùng bước vào quán, tiến lại gần bàn của Nam.
        Hùng: Chào Nam, tôi vẫn còn sống đây.
      `;

      const result = await auditor.auditScript(2, mockBible, script);
      expect(result.audit_status).toBe("FAIL");
      expect(result.contradictions.length).toBeGreaterThanOrEqual(1);

      const charStatusError = result.contradictions.find(
        (c) => c.type === "character_status" && c.bible_reference.includes("char_hung")
      );
      expect(charStatusError).toBeDefined();
      expect(charStatusError?.severity).toBe("critical");
    });

    it("allows deceased character appearance when clearly marked as flashback", async () => {
      const script = `
        CẢNH 1: [HỒI TƯỞNG] CĂN BIỆT THỰ - QUÁ KHỨ
        Nam nhớ lại lúc Hùng còn sống và nói chuyện với mình.
      `;

      const result = await auditor.auditScript(2, mockBible, script);
      expect(result.audit_status).toBe("PASS");
    });

    it("flags critical contradiction when an injured character performs intense physical action", async () => {
      const script = `
        CẢNH 2: CON HẺM - ĐÊM
        Lan chạy thục mạng qua các con phố, vượt qua bức tường cao để thoát thân.
      `;

      const result = await auditor.auditScript(2, mockBible, script);
      expect(result.audit_status).toBe("FAIL");

      const injuredError = result.contradictions.find(
        (c) => c.type === "character_status" && c.bible_reference.includes("char_lan")
      );
      expect(injuredError).toBeDefined();
      expect(injuredError?.severity).toBe("critical");
    });

    it("flags critical contradiction when an unearned secret is leaked", async () => {
      const script = `
        CẢNH 1: PHÒNG ĐIỀU TRA
        Nam khẳng định trước mọi người: Kẻ sát nhân chính là gã bác sĩ trưởng khoa!
      `;

      const result = await auditor.auditScript(2, mockBible, script);
      expect(result.audit_status).toBe("FAIL");

      const secretError = result.contradictions.find((c) => c.type === "knowledge_state");
      expect(secretError).toBeDefined();
      expect(secretError?.severity).toBe("critical");
    });

    it("delegates to custom LLM invoker when provided", async () => {
      const mockInvoker = async (_prompt: string) => {
        return JSON.stringify({
          episode_number: 2,
          thought_process: ["Custom LLM invoker ran successfully"],
          contradictions: [],
          audit_status: "PASS",
          summary: "Custom LLM pass",
        });
      };

      const customAuditor = new ContinuityAuditor({ llmInvoker: mockInvoker });
      const result = await customAuditor.auditScript(2, mockBible, "Any script");

      expect(result.audit_status).toBe("PASS");
      expect(result.thought_process).toContain("Custom LLM invoker ran successfully");
    });

    it("matches Vietnamese character names with initial diacritics like 'Đ'", async () => {
      const vnBible: StoryBiblePayload = {
        characters: [
          {
            id: "char_duc_anh",
            name: "Đức Anh",
            role: "supporting",
            visual_summary: "Đức Anh, 30 tuổi",
            personality_traits: ["thật thà"],
            status: "deceased",
          },
        ],
        character_knowledge: [],
        world_state: {},
        episode_summaries: [],
      };

      const script = "CẢNH 1: Hôm nay Đức Anh bất ngờ xuất hiện giữa quảng trường.";
      const result = await auditor.auditScript(2, vnBible, script);
      expect(result.audit_status).toBe("FAIL");
      expect(result.contradictions.some((c) => c.description.includes("Đức Anh"))).toBe(true);
    });

    it("handles character names with regex metacharacters like parentheses without crashing", async () => {
      const specialBible: StoryBiblePayload = {
        characters: [
          {
            id: "char_special",
            name: "Dr. Strange (Earth-616)",
            role: "supporting",
            visual_summary: "Phù thủy tối thượng",
            personality_traits: ["quyền năng"],
            status: "deceased",
          },
        ],
        character_knowledge: [],
        world_state: {},
        episode_summaries: [],
      };

      const script = "CẢNH 1: Dr. Strange (Earth-616) mở cổng không gian bước ra.";
      const result = await auditor.auditScript(2, specialBible, script);
      expect(result.audit_status).toBe("FAIL");
      expect(result.contradictions.some((c) => c.description.includes("Dr. Strange (Earth-616)"))).toBe(true);
    });
  });
});
