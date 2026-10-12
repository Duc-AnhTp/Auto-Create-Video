import { describe, it, expect } from "vitest";
import { MicroScriptRepairer, type SurgicalRepairTarget } from "./micro-script-repairer.js";

describe("MicroScriptRepairer", () => {
  const sampleScript = `
TẬP 1: CHIẾN BINH THỜI GIAN
Logline: Nam và Mai lên đường tìm kiếm bảo thạch thời gian.

CẢNH 1: HANG ĐÁ CỔ - ĐÊM
Nhân vật: Nam, Mai
CÚ MÁY 1 (establishing, 4s): Toàn cảnh hang đá tối tăm, thạch nhũ lấp lánh ánh xanh.
CÚ MÁY 2 (medium, 4s): Mai cẩn thận nhặt lấy thanh kiếm cổ nằm trên bệ đá.
MAI: [thì thầm] Nam, thanh kiếm này có khắc ấn chú thời gian. Tôi sẽ giữ nó.
NAM: Được, hãy cẩn thận.

CẢNH 2: HẺM NÚI GIÓ HÚ - ĐÊM
Nhân vật: Nam, Mai
CÚ MÁY 1 (wide, 4s): Gió rít dữ dội qua vách đá hẹp.
CÚ MÁY 2 (medium, 4s): Đột nhiên quái vật đá xuất hiện chặn lối đi.
NAM: [rút thanh kiếm cổ ra chém] Lùi lại Mai! Để tôi xử lý nó!
MAI: [hoảng hốt] Coi chừng nó đánh lén!

CẢNH 3: BỜ SUỐI PHÙ THỦY - BÌNH MINH
Nhân vật: Nam, Mai
CÚ MÁY 1 (establishing, 4s): Ánh nắng bình minh rọi sáng dòng suối vàng óng.
CÚ MÁY 2 (medium, 4s): Nam và Mai ngồi nghỉ bên bờ suối.
NAM: Chúng ta đã thoát khỏi hẻm núi an toàn.
  `.trim();

  it("extracts individual scene blocks cleanly into AST with numbers and headers", () => {
    const blocks = MicroScriptRepairer.extractSceneBlocks(sampleScript);
    expect(blocks.length).toBe(3);

    expect(blocks[0].sceneNumber).toBe(1);
    expect(blocks[0].slugline).toContain("HANG ĐÁ CỔ - ĐÊM");
    expect(blocks[0].rawContent).toContain("Mai cẩn thận nhặt lấy thanh kiếm cổ");

    expect(blocks[1].sceneNumber).toBe(2);
    expect(blocks[1].slugline).toContain("HẺM NÚI GIÓ HÚ - ĐÊM");
    expect(blocks[1].rawContent).toContain("NAM: [rút thanh kiếm cổ ra chém]");

    expect(blocks[2].sceneNumber).toBe(3);
    expect(blocks[2].slugline).toContain("BỜ SUỐI PHÙ THỦY - BÌNH MINH");
    expect(blocks[2].rawContent).toContain("BỜ SUỐI PHÙ THỦY");
  });

  it("builds a concise surgical repair prompt with local context and strict isolation", () => {
    const blocks = MicroScriptRepairer.extractSceneBlocks(sampleScript);
    const target: SurgicalRepairTarget = {
      sceneNumber: 2,
      violationType: "canon_prop_state",
      violationMessage: "Nam không thể rút thanh kiếm cổ ra chém vì Mai đang giữ thanh kiếm ở Cảnh 1!",
      fixInstruction: "Mai ném kiếm cho Nam hoặc Nam dùng phép thuật gió để chặn quái vật.",
    };

    const repairPack = MicroScriptRepairer.buildSurgicalRepairPrompt(blocks, target);

    expect(repairPack.systemPrompt).toContain("SURGICAL SCENE REPAIRER");
    expect(repairPack.prompt).toContain("CẢNH 2");
    expect(repairPack.prompt).toContain("Nam không thể rút thanh kiếm cổ ra chém");
    expect(repairPack.prompt).toContain("Mai ném kiếm cho Nam");
    // Verify context of Scene 1 is provided for continuity
    expect(repairPack.prompt).toContain("Mạch nối trước đó");
    // Must NOT contain full script to avoid token bloat
    expect(repairPack.prompt.length).toBeLessThan(sampleScript.length * 2);
  });

  it("splices the repaired scene back into the original script without touching other scenes", () => {
    const repairedSceneContent = `
CẢNH 2: HẺM NÚI GIÓ HÚ - ĐÊM
Nhân vật: Nam, Mai
CÚ MÁY 1 (wide, 4s): Gió rít dữ dội qua vách đá hẹp.
CÚ MÁY 2 (medium, 4s): Đột nhiên quái vật đá xuất hiện chặn lối đi.
MAI: [nhanh chóng ném thanh kiếm cổ sang] Nam! Nhận lấy thanh kiếm thời gian!
NAM: [bắt lấy thanh kiếm, vung một nhát chém ánh sáng] Cảm ơn Mai! Lùi lại phía sau!
    `.trim();

    const spliced = MicroScriptRepairer.spliceRepairedScene(sampleScript, 2, repairedSceneContent);

    // Verify Scene 1 is preserved verbatim
    expect(spliced).toContain("CẢNH 1: HANG ĐÁ CỔ - ĐÊM");
    expect(spliced).toContain("Mai cẩn thận nhặt lấy thanh kiếm cổ nằm trên bệ đá.");

    // Verify Scene 2 is replaced with the repaired content
    expect(spliced).toContain("MAI: [nhanh chóng ném thanh kiếm cổ sang]");
    expect(spliced).not.toContain("NAM: [rút thanh kiếm cổ ra chém] Lùi lại Mai!");

    // Verify Scene 3 is preserved verbatim
    expect(spliced).toContain("CẢNH 3: BỜ SUỐI PHÙ THỦY - BÌNH MINH");
    expect(spliced).toContain("Chúng ta đã thoát khỏi hẻm núi an toàn.");
  });

  it("executes end-to-end surgical repair and records token savings >= 60%", async () => {
    const target: SurgicalRepairTarget = {
      sceneNumber: 2,
      violationType: "canon_prop_state",
      violationMessage: "Nam không có kiếm trong tay.",
      fixInstruction: "Mai chuyền kiếm cho Nam.",
    };

    const mockInvoker = async (prompt: string, systemPrompt: string) => {
      expect(systemPrompt).toContain("Screenplay Script Doctor");
      expect(prompt).toContain("CẢNH 2");
      return `
CẢNH 2: HẺM NÚI GIÓ HÚ - ĐÊM
Nhân vật: Nam, Mai
CÚ MÁY 1 (wide, 4s): Gió rít dữ dội qua vách đá.
MAI: [ném kiếm] Nam, đỡ lấy kiếm!
NAM: [đón kiếm] Để tôi lo!
      `.trim();
    };

    const result = await MicroScriptRepairer.executeSurgicalRepair(sampleScript, target, mockInvoker);

    expect(result.success).toBe(true);
    expect(result.repairedScript).toContain("MAI: [ném kiếm] Nam, đỡ lấy kiếm!");
    expect(result.estimatedTokensSaved).toBeGreaterThan(50);
    expect(result.savingsPercentage).toBeGreaterThanOrEqual(60);
  });

  it("robustly strips markdown code fences including language tags and whitespace", async () => {
    const target: SurgicalRepairTarget = {
      sceneNumber: 2,
      violationType: "canon_prop_state",
      violationMessage: "Nam không có kiếm trong tay.",
      fixInstruction: "Mai ném kiếm cho Nam.",
    };

    const mockInvokerWithFence = async () => {
      return `
   \`\`\`screenplay
CẢNH 2: HẺM NÚI GIÓ HÚ - ĐÊM
Nhân vật: Nam, Mai
CÚ MÁY 1 (wide, 4s): Gió rít dữ dội qua vách đá.
MAI: [ném kiếm] Nam, đỡ lấy kiếm!
   \`\`\`
      `;
    };

    const result = await MicroScriptRepairer.executeSurgicalRepair(sampleScript, target, mockInvokerWithFence);

    expect(result.success).toBe(true);
    expect(result.repairedSceneText).not.toContain("```");
    expect(result.repairedScript).not.toContain("```");
    expect(result.repairedScript).toContain("MAI: [ném kiếm] Nam, đỡ lấy kiếm!");
  });
});
