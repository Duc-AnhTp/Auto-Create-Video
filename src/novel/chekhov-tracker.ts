import type { BibleManager, ChekhovGunRecord } from "../bible/bible-manager.js";

export interface ChekhovEvaluationReport {
  currentEpisode: number;
  totalActiveGuns: number;
  dormantWarningGuns: ChekhovGunRecord[];
  allActiveGuns: ChekhovGunRecord[];
}

/**
 * Evaluates active narrative plants and flags dormant Chekhov's Guns
 * that have gone unresolved for multiple consecutive episodes.
 */
export function evaluateChekhovGuns(
  bible: BibleManager,
  seriesId: string,
  currentEpisode: number,
  warningThresholdEpisodes: number = 2
): ChekhovEvaluationReport {
  const allActiveGuns = bible.listActiveChekhovGuns(seriesId, currentEpisode);

  // Filter guns that have been dormant for at least the warning threshold
  const dormantWarningGuns = allActiveGuns.filter(
    (gun) => (gun.dormant_episodes_count ?? 0) >= warningThresholdEpisodes
  );

  return {
    currentEpisode,
    totalActiveGuns: allActiveGuns.length,
    dormantWarningGuns,
    allActiveGuns,
  };
}

/**
 * Formats a clear, actionable LLM context injection prompt instructing
 * the screenplay or story generator to address dormant narrative setups.
 */
export function generateChekhovWarningsPrompt(report: ChekhovEvaluationReport): string {
  if (report.dormantWarningGuns.length === 0) {
    return "";
  }

  const lines: string[] = [
    "─────────────────────────────────────────────────────────────────",
    "⚠️ [CẢNH BÁO NARRATIVE PAYOFF - CHEKHOV'S GUN BỊ LÃNG QUÊN]",
    `Các chi tiết/đạo cụ/bí mật sau đây đã được gài từ các tập trước nhưng bị bỏ quên ≥ 2 tập:`,
  ];

  for (const gun of report.dormantWarningGuns) {
    lines.push(
      `- [${gun.type.toUpperCase()}] '${gun.name}': Đã gài từ Tập ${gun.planted_at_episode} (bỏ quên ${gun.dormant_episodes_count} tập).`
    );
    lines.push(`  Mô tả: ${gun.description}`);
    lines.push(`  👉 Chỉ thị: Hãy tạo tình huống giải quyết (payoff), nhắc lại hoặc đưa chi tiết này trở lại tâm điểm hành động trong tập hiện tại!`);
  }

  lines.push("─────────────────────────────────────────────────────────────────");
  return lines.join("\n");
}
