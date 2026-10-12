import type {TrailerAutoCutResult} from '../../../src/contracts/media-features.js';
import React, { useState, useEffect } from "react";

export interface SeasonTrailerWorkspaceViewProps {
  seriesId: string;
  api: <T = unknown>(path: string, body?: unknown) => Promise<T>;
  onNotice?: (msg: string) => void;
  onError?: (msg: string) => void;
}

export function SeasonTrailerWorkspaceView({
  seriesId,
  api,
  onNotice,
  onError,
}: SeasonTrailerWorkspaceViewProps) {
  const [targetDuration, setTargetDuration] = useState<30 | 60 | 90>(60);
  const [tagline, setTagline] = useState("Định Mệnh Đã Được Định Đoạt");
  const [musicStyle, setMusicStyle] = useState<"epic_orchestral" | "cyberpunk_synthwave" | "dark_thriller_drone">("epic_orchestral");
  const [isLoadingTrailer, setIsLoadingTrailer] = useState(false);
  const [isRunningSeason, setIsRunningSeason] = useState(false);
  const [trailerData, setTrailerData] = useState<TrailerAutoCutResult|null>(null);
  const [selectedCutIndex, setSelectedCutIndex] = useState<number>(1);

  const fetchExistingTrailer = async () => {
    if (!seriesId) return;
    try {
      const res = await api<{success:boolean;trailer?:TrailerAutoCutResult;manifest?:{trailerResult?:TrailerAutoCutResult}}>(`/api/v1/series/${seriesId}/season/trailer`);
      if (res.success && res.trailer) {
        setTrailerData(res.trailer);
      }
    } catch {
      // Ignored if no trailer created yet
    }
  };

  useEffect(() => {
    void fetchExistingTrailer();
  }, [seriesId]);

  const handleAutoCutTrailer = async () => {
    if (!seriesId) return;
    setIsLoadingTrailer(true);
    try {
      const res = await api<{success:boolean;trailer?:TrailerAutoCutResult;manifest?:{trailerResult?:TrailerAutoCutResult}}> (`/api/v1/series/${seriesId}/season/trailer/auto-cut`, {
        targetDurationSec: targetDuration,
        tagline,
        musicStyle,
      });

      if (res.success && res.trailer) {
        setTrailerData(res.trailer);
        onNotice?.(`✓ Đã tự động cắt Trailer ${targetDuration}s thành công với ${res.trailer.cutsCount} cú máy cao trào!`);
      }
    } catch (err: unknown) {
      onError?.((err instanceof Error ? err.message : String(err)) || "Lỗi khi tự động cắt Trailer mùa phim.");
    } finally {
      setIsLoadingTrailer(false);
    }
  };

  const handleRunFullSeason = async () => {
    if (!seriesId) return;
    setIsRunningSeason(true);
    try {
      onNotice?.("⏳ Đang chạy sản xuất liên tục trọn vẹn 5 tập Season 1... Vui lòng đợi trong giây lát.");
      const res = await api<{success:boolean;trailer?:TrailerAutoCutResult;manifest?:{trailerResult?:TrailerAutoCutResult}}> (`/api/v1/series/${seriesId}/season/run-production`, {
        totalEpisodes: 5,
        seasonBudgetUsd: 100.0,
        enable4kPost: true,
        enableLightingHarmonization: true,
        enableEmotionalVoice: true,
        enableLipSync: true,
        generateSeasonTrailer: true,
        trailerTargetDurationSec: targetDuration,
        trailerTagline: tagline,
      });

      if (res.success && res.manifest) {
        if (res.manifest.trailerResult) {
          setTrailerData(res.manifest.trailerResult);
        }
        onNotice?.(`🎉 Đã sản xuất thành công trọn vẹn Mùa Phim (5/5 tập) và hoàn tất Trailer Teaser 60s!`);
      }
    } catch (err: unknown) {
      onError?.((err instanceof Error ? err.message : String(err)) || "Lỗi khi chạy sản xuất toàn bộ Mùa Phim.");
    } finally {
      setIsRunningSeason(false);
    }
  };

  const selectedCut = trailerData?.cuts?.find((c) => c.cutIndex === selectedCutIndex) || trailerData?.cuts?.[0];

  return (
    <div className="season-trailer-workspace" style={{ padding: "16px", color: "#e2e8f0" }}>
      {/* ── Top Header ── */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
          background: "#0f172a",
          padding: "14px 18px",
          borderRadius: "8px",
          border: "1px solid #334155",
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: "1.3rem", color: "#f43f5e" }}>
            🎞️ Trình Cắt Ghép Trailer Mùa Phim Tự Động (Season Trailer Auto-Cut Engine)
          </h2>
          <small style={{ color: "#94a3b8" }}>
            Series: <strong>{seriesId || "Chưa chọn"}</strong> · Cấu trúc 4 Hồi Hollywood · DaVinci Resolve &amp; Premiere Pro EDL
          </small>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <select
            value={targetDuration}
            onChange={(e) => setTargetDuration(parseInt(e.target.value, 10) as typeof targetDuration)}
            style={{
              background: "#1e293b",
              color: "#fff",
              border: "1px solid #475569",
              padding: "6px 10px",
              borderRadius: "4px",
              fontSize: "0.85rem",
              fontWeight: "bold",
            }}
          >
            <option value={30}>⏱️ Teaser Ngắn 30 Giây</option>
            <option value={60}>🎬 Trailer Chính Thức 60 Giây (Chuẩn)</option>
            <option value={90}>🚀 Extended Promo 90 Giây</option>
          </select>

          <button
            onClick={() => void handleAutoCutTrailer()}
            disabled={isLoadingTrailer || isRunningSeason || !seriesId}
            style={{
              background: "linear-gradient(135deg, #e11d48, #be123c)",
              border: "none",
              color: "#fff",
              padding: "7px 16px",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: "bold",
              fontSize: "0.85rem",
              boxShadow: "0 2px 8px rgba(225, 29, 72, 0.4)",
            }}
          >
            {isLoadingTrailer ? "Đang Cắt Trailer..." : "⚡ Cắt Trailer Tự Động"}
          </button>

          <button
            onClick={() => void handleRunFullSeason()}
            disabled={isLoadingTrailer || isRunningSeason || !seriesId}
            style={{
              background: "linear-gradient(135deg, #6366f1, #4f46e5)",
              border: "none",
              color: "#fff",
              padding: "7px 16px",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: "bold",
              fontSize: "0.85rem",
              boxShadow: "0 2px 8px rgba(99, 102, 241, 0.4)",
            }}
          >
            {isRunningSeason ? "Đang Chạy Season..." : "🚀 Chạy Toàn Bộ Season 1 (5 Tập)"}
          </button>
        </div>
      </div>

      {/* ── Configuration & Pacing Overview ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "16px", marginBottom: "16px" }}>
        {/* Settings Box */}
        <div style={{ background: "#1e293b", padding: "16px", borderRadius: "8px", border: "1px solid #334155" }}>
          <h3 style={{ margin: "0 0 12px 0", fontSize: "1rem", color: "#38bdf8" }}>
            ⚙️ Thiết Lập Kịch Bản Trailer
          </h3>

          <div style={{ marginBottom: "10px" }}>
            <label style={{ fontSize: "0.8rem", color: "#94a3b8", display: "block", marginBottom: "4px" }}>
              Khẩu Hiệu Trailer (Tagline / Title Card):
            </label>
            <input
              type="text"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              style={{
                width: "100%",
                background: "#0f172a",
                color: "#f59e0b",
                border: "1px solid #334155",
                padding: "6px 10px",
                borderRadius: "4px",
                fontSize: "0.85rem",
                boxSizing: "border-box",
                fontWeight: "bold",
              }}
            />
          </div>

          <div style={{ marginBottom: "10px" }}>
            <label style={{ fontSize: "0.8rem", color: "#94a3b8", display: "block", marginBottom: "4px" }}>
              Phong Cách Nhạc Nền Trailer:
            </label>
            <select
              value={musicStyle}
              onChange={(e) => setMusicStyle(e.target.value as typeof musicStyle)}
              style={{
                width: "100%",
                background: "#0f172a",
                color: "#fff",
                border: "1px solid #334155",
                padding: "6px 10px",
                borderRadius: "4px",
                fontSize: "0.85rem",
              }}
            >
              <option value="epic_orchestral">🎻 Epic Orchestral (Dàn nhạc giao hưởng hùng tráng)</option>
              <option value="cyberpunk_synthwave">⚡ Cyberpunk Synthwave (Điện tử dồn dập)</option>
              <option value="dark_thriller_drone">🌫️ Dark Thriller Drone (Huyền bí, hồi hộp dâng cao)</option>
            </select>
          </div>

          <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "12px" }}>
            • Tự động chọn lọc cú máy từ 5 tập dựa trên điểm căng thẳng (Tension), thoại đắt giá, và độ tương phản góc quay.
          </div>
        </div>

        {/* 4-Act Pacing Visualizer */}
        <div style={{ background: "#1e293b", padding: "16px", borderRadius: "8px", border: "1px solid #334155" }}>
          <h3 style={{ margin: "0 0 12px 0", fontSize: "1rem", color: "#4ade80" }}>
            📊 Cấu Trúc Nhịp Điệu 4 Hồi Điện Ảnh (Hollywood 4-Act Pacing)
          </h3>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr 1fr 0.8fr", gap: "6px", marginBottom: "10px" }}>
            {/* Act 1 */}
            <div style={{ background: "#0369a1", padding: "10px", borderRadius: "6px", textAlign: "center" }}>
              <div style={{ fontSize: "0.7rem", color: "#bae6fd", fontWeight: "bold" }}>HỒI 1: THE HOOK</div>
              <div style={{ fontSize: "0.85rem", fontWeight: "bold", color: "#fff" }}>0s - 15s</div>
              <div style={{ fontSize: "0.65rem", color: "#e0f2fe", marginTop: "4px" }}>Thiết lập bí ẩn, drone nhẹ</div>
            </div>

            {/* Act 2 */}
            <div style={{ background: "#b45309", padding: "10px", borderRadius: "6px", textAlign: "center" }}>
              <div style={{ fontSize: "0.7rem", color: "#fde68a", fontWeight: "bold" }}>HỒI 2: ESCALATION</div>
              <div style={{ fontSize: "0.85rem", fontWeight: "bold", color: "#fff" }}>15s - 38s</div>
              <div style={{ fontSize: "0.65rem", color: "#fef3c7", marginTop: "4px" }}>Đối đầu kịch liệt, nhịp trống dồn</div>
            </div>

            {/* Act 3 */}
            <div style={{ background: "#be123c", padding: "10px", borderRadius: "6px", textAlign: "center" }}>
              <div style={{ fontSize: "0.7rem", color: "#fecdd3", fontWeight: "bold" }}>HỒI 3: ACTION CLIMAX</div>
              <div style={{ fontSize: "0.85rem", fontWeight: "bold", color: "#fff" }}>38s - 52s</div>
              <div style={{ fontSize: "0.65rem", color: "#ffe4e6", marginTop: "4px" }}>Montage tốc độ cao, braam sub-drop</div>
            </div>

            {/* Outro */}
            <div style={{ background: "#6d28d9", padding: "10px", borderRadius: "6px", textAlign: "center" }}>
              <div style={{ fontSize: "0.7rem", color: "#ddd6fe", fontWeight: "bold" }}>OUTRO</div>
              <div style={{ fontSize: "0.85rem", fontWeight: "bold", color: "#fff" }}>52s - 60s</div>
              <div style={{ fontSize: "0.65rem", color: "#ede9fe", marginTop: "4px" }}>Thoại thì thầm &amp; Logo Sting</div>
            </div>
          </div>

          {/* Interactive Timeline Bar */}
          <div style={{ position: "relative", height: "24px", background: "#0f172a", borderRadius: "4px", overflow: "hidden", border: "1px solid #334155" }}>
            <div style={{ position: "absolute", left: "0%", width: "25%", height: "100%", background: "#0284c7", opacity: 0.7 }} />
            <div style={{ position: "absolute", left: "25%", width: "38%", height: "100%", background: "#d97706", opacity: 0.7 }} />
            <div style={{ position: "absolute", left: "63%", width: "24%", height: "100%", background: "#e11d48", opacity: 0.7 }} />
            <div style={{ position: "absolute", left: "87%", width: "13%", height: "100%", background: "#7c3aed", opacity: 0.7 }} />

            {/* Render cut markers if available */}
            {trailerData?.cuts?.map((c: any) => {
              const leftPercent = (c.timelineStartSec / (trailerData.totalDurationSec || 60)) * 100;
              return (
                <div
                  key={c.cutIndex}
                  style={{
                    position: "absolute",
                    left: `${leftPercent}%`,
                    top: 0,
                    bottom: 0,
                    width: "2px",
                    background: "#fff",
                    boxShadow: "0 0 4px #fff",
                  }}
                  title={`Cut #${c.cutIndex} (${c.timelineStartSec}s)`}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Cuts Breakdown Table ── */}
      {trailerData && (
        <div style={{ background: "#1e293b", padding: "16px", borderRadius: "8px", border: "1px solid #334155", marginBottom: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <h4 style={{ margin: 0, color: "#f59e0b", fontSize: "1.05rem" }}>
              🎬 Danh Sách Cú Máy Cao Trào Đã Biên Tập ({trailerData.cutsCount} Cuts · Thời lượng: {trailerData.totalDurationSec}s)
            </h4>

            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(trailerData, null, 2));
                  onNotice?.("✓ Đã sao chép Trailer Manifest JSON vào clipboard!");
                }}
                style={{
                  background: "#0f172a",
                  border: "1px solid #334155",
                  color: "#38bdf8",
                  padding: "4px 10px",
                  borderRadius: "4px",
                  fontSize: "0.75rem",
                  cursor: "pointer",
                }}
              >
                📋 Sao Chép Manifest
              </button>
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
              <thead>
                <tr style={{ background: "#0f172a", borderBottom: "1px solid #334155", color: "#94a3b8" }}>
                  <th style={{ padding: "8px", textAlign: "center" }}>#</th>
                  <th style={{ padding: "8px", textAlign: "left" }}>Hồi</th>
                  <th style={{ padding: "8px", textAlign: "center" }}>Tập</th>
                  <th style={{ padding: "8px", textAlign: "left" }}>Shot ID</th>
                  <th style={{ padding: "8px", textAlign: "center" }}>Góc Máy</th>
                  <th style={{ padding: "8px", textAlign: "center" }}>Thời Gian</th>
                  <th style={{ padding: "8px", textAlign: "center" }}>Thời Lượng</th>
                  <th style={{ padding: "8px", textAlign: "left" }}>Câu Thoại Đắt Giá</th>
                  <th style={{ padding: "8px", textAlign: "center" }}>Audio Hit FX</th>
                </tr>
              </thead>
              <tbody>
                {trailerData.cuts?.map((c: any) => {
                  const isSelected = c.cutIndex === selectedCutIndex;
                  return (
                    <tr
                      key={c.cutIndex}
                      onClick={() => setSelectedCutIndex(c.cutIndex)}
                      style={{
                        borderBottom: "1px solid #334155",
                        background: isSelected ? "#1e3a8a" : "transparent",
                        cursor: "pointer",
                      }}
                    >
                      <td style={{ padding: "8px", textAlign: "center", fontWeight: "bold", color: "#f59e0b" }}>
                        {c.cutIndex}
                      </td>
                      <td style={{ padding: "8px" }}>
                        <span
                          style={{
                            background:
                              c.act === "act_1_hook"
                                ? "#0284c7"
                                : c.act === "act_2_escalation"
                                ? "#d97706"
                                : c.act === "act_3_climax"
                                ? "#e11d48"
                                : "#7c3aed",
                            color: "#fff",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontSize: "0.7rem",
                            fontWeight: "bold",
                          }}
                        >
                          {c.act.replace("act_", "Hồi ").replace("_", " ").toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: "8px", textAlign: "center", color: "#cbd5e1" }}>
                        Tập {c.episodeNumber}
                      </td>
                      <td style={{ padding: "8px", color: "#38bdf8", fontWeight: "bold" }}>
                        {c.shotId}
                      </td>
                      <td style={{ padding: "8px", textAlign: "center", color: "#94a3b8" }}>
                        {c.shotType}
                      </td>
                      <td style={{ padding: "8px", textAlign: "center", color: "#cbd5e1" }}>
                        {c.timelineStartSec}s - {c.timelineEndSec}s
                      </td>
                      <td style={{ padding: "8px", textAlign: "center", color: "#4ade80", fontWeight: "bold" }}>
                        {c.cutDurationSec}s
                      </td>
                      <td style={{ padding: "8px", color: "#fef08a", fontStyle: "italic" }}>
                        {c.dialogue ? `"${c.dialogue.text}" (${c.dialogue.speaker})` : "—"}
                      </td>
                      <td style={{ padding: "8px", textAlign: "center" }}>
                        {c.audioHit ? (
                          <span style={{ background: "#334155", color: "#f43f5e", padding: "2px 6px", borderRadius: "4px", fontSize: "0.7rem", fontWeight: "bold" }}>
                            💥 {c.audioHit}
                          </span>
                        ) : (
                          <span style={{ color: "#64748b" }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Export & Deliverables ── */}
      {trailerData && (
        <div style={{ background: "#0f172a", padding: "16px", borderRadius: "8px", border: "1px solid #334155" }}>
          <h4 style={{ margin: "0 0 10px 0", color: "#38bdf8", fontSize: "1rem" }}>
            📦 Bộ Tệp Bàn Giao Trailer Cho DaVinci Resolve &amp; Premiere Pro
          </h4>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
            <div style={{ background: "#1e293b", padding: "10px", borderRadius: "6px", border: "1px solid #334155" }}>
              <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>Video Master Trailer</div>
              <div style={{ fontSize: "0.85rem", color: "#4ade80", fontWeight: "bold", wordBreak: "break-all" }}>
                {trailerData.trailerVideoPath}
              </div>
            </div>

            <div style={{ background: "#1e293b", padding: "10px", borderRadius: "6px", border: "1px solid #334155" }}>
              <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>DaVinci / Premiere FCP7 XML</div>
              <div style={{ fontSize: "0.85rem", color: "#38bdf8", fontWeight: "bold", wordBreak: "break-all" }}>
                {trailerData.fcp7XmlPath}
              </div>
            </div>

            <div style={{ background: "#1e293b", padding: "10px", borderRadius: "6px", border: "1px solid #334155" }}>
              <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>CMX 3600 EDL Timeline</div>
              <div style={{ fontSize: "0.85rem", color: "#f59e0b", fontWeight: "bold", wordBreak: "break-all" }}>
                {trailerData.cmx3600EdlPath}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
