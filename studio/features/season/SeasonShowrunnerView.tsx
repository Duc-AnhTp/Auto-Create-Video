import type {SeasonBudgetPlan,EpisodePacingProfile,CrossEpisodeStateSnapshot} from '../../../src/contracts/media-features.js';
type EpisodeRow={episodeNumber:number;title?:string;status?:string;act?:string;pacingAct?:string;allocatedBudgetUsd?:number;allocatedUsd?:number;actualSpentUsd?:number;spentUsd?:number;final4kDeliveryPath?:string};
type SeasonManifestResponse={success?:boolean;totalEpisodes:number;completedEpisodes:number;seasonBudget:Partial<Omit<SeasonBudgetPlan,'episodes'>>&{episodes?:EpisodeRow[]};pacingProfiles?:EpisodePacingProfile[];episodes?:EpisodeRow[];costLedger?:StudioJob['result'] extends infer R?R extends {costLedger?:infer C}?C:never:never};
import type { StudioJob } from "../../../src/contracts/studio.js";
import React, { useState, useEffect } from "react";

export interface SeasonShowrunnerViewProps {
  seriesId: string;
  api: <T = unknown>(path: string, body?: unknown) => Promise<T>;
  onNotice?: (msg: string) => void;
  onError?: (msg: string) => void;
}

export function SeasonShowrunnerView({
  seriesId,
  api,
  onNotice,
  onError,
}: SeasonShowrunnerViewProps) {
  const [mode, setMode] = useState<"mock" | "production">("mock");
  const [provider, setProvider] = useState("local_comfyui");
  const [hedgeEnabled,setHedgeEnabled]=useState(false),[hedgeProvider,setHedgeProvider]=useState("api_runway");
  const [activeJob, setActiveJob] = useState<StudioJob | null>(null);
  const [totalEpisodes, setTotalEpisodes] = useState(5);
  const [seasonBudget, setSeasonBudget] = useState(100.0);
  const [enable4k, setEnable4k] = useState(true);
  const [enableAutoBridge, setEnableAutoBridge] = useState(true);
  const [selectedEp, setSelectedEp] = useState(1);

  const [loading, setLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [manifestData, setManifestData] = useState<SeasonManifestResponse|null>(null);
  const [continuityData, setContinuityData] = useState<CrossEpisodeStateSnapshot|null>(null);

  const loadSeasonManifest = async () => {
    if (!seriesId) return;
    setLoading(true);
    try {
      const res = await api<SeasonManifestResponse>(`/api/v1/series/${seriesId}/season/manifest`);
      if (res.success) {
        setManifestData(res);
        if (res.seasonBudget?.totalSeasonBudgetUsd) {
          setSeasonBudget(res.seasonBudget.totalSeasonBudgetUsd);
        }
      }
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  };

  const loadContinuity = async (epNum: number) => {
    if (!seriesId) return;
    try {
      const res = await api<{success:boolean;continuity:CrossEpisodeStateSnapshot}>(`/api/v1/series/${seriesId}/season/continuity?episodeNumber=${epNum}`);
      if (res.success && res.continuity) {
        setContinuityData(res.continuity);
      }
    } catch {}
  };

  useEffect(() => {
    void loadSeasonManifest();
    void loadContinuity(selectedEp);
  }, [seriesId]);

  useEffect(() => {
    void loadContinuity(selectedEp);
  }, [selectedEp]);

  const handleRunSeason = async () => {
    if (!seriesId) {
      onError?.("Vui lòng chọn dự án.");
      return;
    }

    setIsRunning(true);
    try {
      const res = await api<{ job: StudioJob }>(`/api/v1/series/${seriesId}/season/run`, {
        totalEpisodes, seasonBudgetUsd: seasonBudget, mode,
        provider: mode === "mock" ? "mock" : provider, approvalPolicy: "auto_qa",
        hedge:{enabled:mode==="production"&&hedgeEnabled,fallbackProvider:hedgeProvider,delayMs:45_000},
      });
      setActiveJob(res.job);
      onNotice?.("Đã đưa mùa phim vào hàng đợi. Theo dõi tiến độ bên dưới.");
    } catch (err: unknown) {
      onError?.((err instanceof Error ? err.message : String(err)) || "Lỗi khi chạy sản xuất mùa phim.");
    } finally {
      setIsRunning(false);
    }
  };

  useEffect(() => {
    if (!activeJob || !["queued", "running", "paused"].includes(activeJob.status)) return;
    const events = new EventSource("/api/v1/events");
    const update = (event: MessageEvent) => {
      const job = JSON.parse(event.data) as StudioJob;
      if (job.id !== activeJob.id) return;
      setActiveJob(job);
      if (job.result?.season) setManifestData({ ...job.result.season.progress, seasonBudget: { totalSeasonBudgetUsd: job.request.budgetCapUsd ?? seasonBudget, totalSpentUsd: job.result.costLedger?.confirmed ?? 0 }, costLedger: job.result.costLedger });
    };
    events.addEventListener("job", update);
    const snapshot = (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { jobs: StudioJob[] };
      const job = data.jobs.find(j => j.id === activeJob.id);
      if (job) update({ data: JSON.stringify(job) } as MessageEvent);
    };
    events.addEventListener("snapshot", snapshot);
    return () => events.close();
  }, [activeJob?.id, activeJob?.status]);

  const episodesList = manifestData?.episodes || manifestData?.seasonBudget?.episodes || [];
  const pacingList = manifestData?.pacingProfiles || [];

  return (
    <div className="season-showrunner-container" style={{ padding: "16px", color: "#e2e8f0" }}>
      {/* Header & Primary Controls */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.3rem", color: "#38bdf8" }}>
            🎬 Bộ Điều Phối Mùa Phim (Season Showrunner Engine)
          </h2>
          <small style={{ color: "#94a3b8" }}>
            Series: <strong>{seriesId || "Chưa chọn"}</strong> · Sản xuất chuỗi 5-10 tập liên tục · Kế thừa trạng thái xuyên tập
          </small>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <label style={{ fontSize: "0.85rem" }}>
            Số tập:{" "}
            <select
              value={totalEpisodes}
              onChange={(e) => setTotalEpisodes(Number(e.target.value))}
              style={{ background: "#0f172a", color: "#fff", border: "1px solid #334155", padding: "4px 8px", borderRadius: "4px" }}
            >
              <option value={3}>3 tập (Mini-Arc)</option>
              <option value={5}>5 tập (Chuẩn Season 1)</option>
              <option value={8}>8 tập (Mở rộng)</option>
              <option value={10}>10 tập (Full Season)</option>
            </select>
          </label>

          <label style={{ fontSize: "0.85rem" }}>
            Ngân sách mùa:{" "}
            <input
              type="number"
              min="10"
              max="1000"
              step="5"
              value={seasonBudget}
              onChange={(e) => setSeasonBudget(Number(e.target.value))}
              style={{ width: "70px", background: "#0f172a", color: "#fff", border: "1px solid #334155", padding: "4px 6px", borderRadius: "4px" }}
            />{" "}
            USD
          </label>

          <button
            onClick={handleRunSeason}
            disabled={isRunning || !seriesId || Boolean(activeJob && ["queued", "running", "paused"].includes(activeJob.status))}
            style={{
              background: isRunning ? "#475569" : "linear-gradient(135deg, #059669, #2563eb)",
              color: "#fff",
              padding: "8px 18px",
              borderRadius: "6px",
              fontWeight: "bold",
              cursor: isRunning ? "not-allowed" : "pointer",
              border: "none",
              boxShadow: "0 4px 12px rgba(5, 150, 105, 0.3)",
            }}
          >
            {isRunning ? "⏳ Đang Chạy Season..." : "🚀 Chạy Sản Xuất Toàn Mùa"}
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label>Chế độ <select value={mode} onChange={e => setMode(e.target.value as "mock" | "production")}><option value="mock">Mô phỏng — không tính phí</option><option value="production">Sản xuất thật — tự duyệt khi QA đạt</option></select></label>
        {mode === "production" && <label> Nhà cung cấp <select value={provider} onChange={e => setProvider(e.target.value)}>{["local_comfyui", "api_kling", "api_runway", "api_veo", "api_seedance"].map(p => <option key={p} value={p}>{p}</option>)}</select></label>}
        {mode==="production"&&<label><input type="checkbox" checked={hedgeEnabled} onChange={event=>setHedgeEnabled(event.target.checked)}/>Hedge sau 45 giây <select aria-label="Provider hedge season" value={hedgeProvider} onChange={event=>setHedgeProvider(event.target.value)}>{["api_kling","api_runway","api_veo","api_seedance"].filter(value=>value!==provider).map(value=><option key={value}>{value}</option>)}</select></label>}
        <p>Cần kế hoạch chuyển thể đã duyệt. Lip-sync và trailer hiện là tính năng mô phỏng.</p>
        {activeJob && <p role="status">{activeJob.request.mode === "mock" ? "Mô phỏng" : "Sản xuất thật"}: {activeJob.status} · {activeJob.progress?.message} {activeJob.error?.message}</p>}
      </div>
      {/* ── 1. 3-Act Season Narrative Arc & Tension Curve ── */}
      <div style={{ background: "#1e293b", padding: "16px", borderRadius: "8px", border: "1px solid #334155", marginBottom: "20px" }}>
        <h3 style={{ margin: "0 0 10px 0", fontSize: "1.1rem", color: "#f59e0b" }}>
          📈 Cấu Trúc 3 Hồi & Đường Cong Kịch Tính Toàn Mùa (Season Tension Curve)
        </h3>
        <p style={{ margin: "0 0 14px 0", fontSize: "0.85rem", color: "#94a3b8" }}>
          Mô hình nhịp điệu Hollywood: Khởi đầu (Act 1) ➔ Nút thắt điểm giữa (Midpoint Reversal) ➔ Cao trào đỉnh điểm (Act 3 Climax) ➔ Cliffhanger kết mùa.
        </p>

        {/* Visual Tension Bar Graph */}
        <div style={{ display: "flex", gap: "8px", alignItems: "flex-end", height: "130px", background: "#0f172a", padding: "12px", borderRadius: "6px" }}>
          {Array.from({ length: totalEpisodes }, (_, i) => i + 1).map((ep) => {
            const progress = (ep - 0.5) / totalEpisodes;
            // Simulated tension curve
            let tension = 0.35 + progress * 0.4;
            if (progress >= 0.45 && progress <= 0.55) tension = 0.85; // Midpoint
            if (progress >= 0.75 && progress <= 0.90) tension = 1.0; // Climax
            if (progress > 0.90) tension = 0.60;

            const isSelected = selectedEp === ep;
            const barHeight = Math.round(tension * 100);
            const isMidpoint = tension >= 0.85 && tension < 0.95;
            const isClimax = tension >= 0.95;

            const barColor = isClimax
              ? "linear-gradient(to top, #dc2626, #f97316)"
              : isMidpoint
              ? "linear-gradient(to top, #d97706, #fbbf24)"
              : "linear-gradient(to top, #1e40af, #38bdf8)";

            return (
              <div
                key={ep}
                onClick={() => setSelectedEp(ep)}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  cursor: "pointer",
                  height: "100%",
                  justifyContent: "flex-end",
                }}
              >
                <div style={{ fontSize: "0.75rem", marginBottom: "4px", color: isSelected ? "#38bdf8" : "#94a3b8" }}>
                  {tension.toFixed(2)}
                </div>
                <div
                  style={{
                    width: "100%",
                    height: `${barHeight}%`,
                    background: barColor,
                    borderRadius: "4px 4px 0 0",
                    border: isSelected ? "2px solid #fff" : "none",
                    boxShadow: isClimax ? "0 0 10px rgba(239, 68, 68, 0.5)" : "none",
                    transition: "all 0.2s",
                  }}
                />
                <div style={{ marginTop: "6px", fontSize: "0.8rem", fontWeight: isSelected ? "bold" : "normal", color: isSelected ? "#38bdf8" : "#cbd5e1" }}>
                  Tập {ep}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
        {/* ── 2. Multi-Episode Production Matrix ── */}
        <div style={{ background: "#1e293b", padding: "16px", borderRadius: "8px", border: "1px solid #334155" }}>
          <h3 style={{ margin: "0 0 12px 0", fontSize: "1.1rem", color: "#38bdf8" }}>
            🎞️ Ma Trận Sản Xuất Mùa Phim ({episodesList.length} tập)
          </h3>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "320px", overflowY: "auto" }}>
            {episodesList.map((ep) => {
              const isSelected = selectedEp === ep.episodeNumber;
              const isDone = ep.status === "SUCCESS";
              const isWarn = ep.status === "WARN";

              return (
                <div
                  key={ep.episodeNumber}
                  onClick={() => setSelectedEp(ep.episodeNumber)}
                  style={{
                    background: isSelected ? "#1e3a8a" : "#0f172a",
                    padding: "10px",
                    borderRadius: "6px",
                    border: isSelected ? "1px solid #60a5fa" : "1px solid #334155",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: "bold", fontSize: "0.9rem" }}>
                      Tập {ep.episodeNumber}: {ep.title || `Hồi [${ep.act || ep.pacingAct || "Act"}]`}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: "2px" }}>
                      Hạn mức: ${ep.allocatedBudgetUsd || ep.allocatedUsd || 10} USD · Đã chi: ${ep.actualSpentUsd || ep.spentUsd || 0} USD
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    {ep.final4kDeliveryPath && (
                      <span style={{ fontSize: "0.7rem", padding: "2px 6px", background: "#7c3aed", borderRadius: "3px", color: "#fff" }}>
                        4K
                      </span>
                    )}
                    <span
                      style={{
                        fontSize: "0.75rem",
                        padding: "3px 8px",
                        borderRadius: "4px",
                        fontWeight: "bold",
                        background: isDone ? "#059669" : isWarn ? "#d97706" : "#475569",
                        color: "#fff",
                      }}
                    >
                      {isDone ? "✓ Xong" : isWarn ? "⚠ Cảnh báo" : "Chờ dựng"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── 3. Cross-Episode Character Continuity & State Transfer ── */}
        <div style={{ background: "#1e293b", padding: "16px", borderRadius: "8px", border: "1px solid #334155" }}>
          <h3 style={{ margin: "0 0 12px 0", fontSize: "1.1rem", color: "#a855f7" }}>
            🧬 Kế Thừa Trạng Thái Xuyên Tập (Tập {selectedEp})
          </h3>

          {continuityData ? (
            <div style={{ fontSize: "0.85rem" }}>
              <div style={{ marginBottom: "12px", padding: "8px", background: "#0f172a", borderRadius: "4px", border: "1px solid #334155" }}>
                <span style={{ color: "#c084fc", fontWeight: "bold" }}>Trạng thái chuyển tiếp: </span>
                <span>Từ Tập {continuityData.fromEpisode} sang Tập {continuityData.toEpisode}</span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {(continuityData.characters || []).map((c) => (
                  <div key={c.characterId} style={{ background: "#0f172a", padding: "10px", borderRadius: "6px", border: "1px solid #334155" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                      <strong style={{ color: "#38bdf8" }}>{c.characterName}</strong>
                      <span style={{ fontSize: "0.75rem", color: c.wardrobeDamage === "torn" ? "#f87171" : "#4ade80" }}>
                        Trang phục: {c.wardrobeDamage}
                      </span>
                    </div>

                    <div style={{ color: "#cbd5e1", fontSize: "0.8rem" }}>
                      <div>• Tâm lý/Cảm xúc: <em>{c.psychologicalDisposition}</em></div>
                      <div>
                        • Vết thương chiến trận:{" "}
                        {c.wounds.length > 0 ? (
                          <span style={{ color: "#f87171" }}>{c.wounds.join(", ")}</span>
                        ) : (
                          <span style={{ color: "#94a3b8" }}>Không có</span>
                        )}
                      </div>
                      <div>
                        • Đạo cụ đang giữ:{" "}
                        {c.heldProps.length > 0 ? (
                          <span style={{ color: "#fbbf24" }}>{c.heldProps.join(", ")}</span>
                        ) : (
                          <span style={{ color: "#94a3b8" }}>Không có</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {/* Chekhov's Guns */}
                {continuityData.activeChekhovGuns?.length > 0 && (
                  <div style={{ marginTop: "6px", background: "#0f172a", padding: "8px", borderRadius: "4px", border: "1px solid #f59e0b" }}>
                    <strong style={{ color: "#fbbf24", fontSize: "0.8rem" }}>Súng Chekhov cần giải quyết:</strong>
                    <ul style={{ margin: "4px 0", paddingLeft: "18px", fontSize: "0.75rem", color: "#cbd5e1" }}>
                      {continuityData.activeChekhovGuns.map((g) => (
                        <li key={g.id}>
                          {g.description} {g.isDueForPayoff ? <span style={{ color: "#f87171" }}>[ĐẾN HẠN GIẢI QUYẾT]</span> : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "30px", color: "#94a3b8" }}>
              Đang tải dữ liệu liên tục trạng thái...
            </div>
          )}
        </div>
      </div>

      {/* ── 4. Seasonal Budget Burn-Down Summary ── */}
      {manifestData?.seasonBudget && (
        <div style={{ marginTop: "20px", background: "#0f172a", padding: "14px", borderRadius: "8px", border: "1px solid #334155" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <strong style={{ color: "#4ade80" }}>Tổng kết Ngân sách Mùa:</strong>{" "}
              <span>Đã chi: <strong>${manifestData.seasonBudget.totalSpentUsd}</strong> / ${manifestData.seasonBudget.totalSeasonBudgetUsd} USD</span>
            </div>
            <div style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
              Số dư thặng dư tái phân bổ: <strong>${manifestData.seasonBudget.seasonSurplusUsd || 0} USD</strong>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
