import { describe, it, expect, vi } from "vitest";
import { AnalysisReviewQueue } from "./analysis-review-queue.js";
import type { BibleManager } from "../bible/bible-manager.js";

describe("AnalysisReviewQueue", () => {
  it("enqueues items and allows approval", () => {
    const queue = new AnalysisReviewQueue();
    const item = queue.enqueue(
      "character",
      "series_1",
      { id: "char_minh", name: "Minh", role: "protagonist" },
      {
        confidenceScore: 0.95,
        reasons: ["Main character"],
        autoApproveThreshold: 0.99,
      }
    );

    expect(item.id).toBeDefined();
    expect(queue.getPendingCount()).toBe(1);

    const approved = queue.approve(item.id, "Looks good");
    expect(approved).toBe(true);
    expect(queue.getPendingCount()).toBe(0);

    const approvedChars = queue.getApprovedData("character", "series_1");
    expect(approvedChars.length).toBe(1);
    expect((approvedChars[0] as any).id).toBe("char_minh");
  });

  it("persists approved props and chekhov guns to Domain Story Bible", () => {
    const mockBible = {
      enqueueReviewItem: vi.fn(),
      approveReviewItem: vi.fn().mockReturnValue(true),
      getReviewItem: vi.fn(),
      upsertCharacter: vi.fn(),
      upsertStoryBeat: vi.fn(),
      upsertStoryThread: vi.fn(),
      upsertKeyProp: vi.fn(),
      plantChekhovGun: vi.fn(),
    } as unknown as BibleManager;

    const queue = new AnalysisReviewQueue(mockBible);

    // Enqueue and approve prop
    const propItem = queue.enqueue(
      "prop",
      "series_1",
      {
        id: "prop_keycard",
        name: "Thẻ truy cập khu VIP",
        visual_summary: "Thẻ từ màu đen có viền vàng",
        current_holder_id: "char_minh",
        status: "intact",
      },
      {
        confidenceScore: 0.9,
        reasons: ["Important key prop"],
        autoApproveThreshold: 0.95,
      }
    );

    queue.approve(propItem.id);
    expect(mockBible.upsertKeyProp).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "prop_keycard",
        name: "Thẻ truy cập khu VIP",
        current_holder_id: "char_minh",
      })
    );

    // Enqueue and approve chekhov gun
    const gunItem = queue.enqueue(
      "chekhov_gun",
      "series_1",
      {
        id: "gun_poison_vial",
        name: "Lọ độc dược",
        type: "clue",
        description: "Lọ thủy tinh màu xanh giấu trong ngăn kéo",
        planted_at_episode: 1,
        payoff_episode: 3,
      },
      {
        confidenceScore: 0.88,
        reasons: ["Foreshadowed clue"],
        autoApproveThreshold: 0.95,
      }
    );

    queue.approve(gunItem.id);
    expect(mockBible.plantChekhovGun).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "gun_poison_vial",
        name: "Lọ độc dược",
        planted_at_episode: 1,
        payoff_episode: 3,
      })
    );
  });
});
