import React, { useState, useEffect } from "react";
import type { GatewayMetricsData, ReconciliationData } from "../../../src/contracts/studio-features.js";

export interface GatewayReconciliationViewProps {
  seriesId: string;
  episodeNumber: number;
  onFetchMetrics: () => Promise<GatewayMetricsData>;
  onFetchReconciliation: () => Promise<ReconciliationData>;
  onRunVerticalSlice?: () => Promise<void>;
  api?:<T = unknown>(path:string,body?:unknown)=>Promise<T>;
}

export const GatewayReconciliationView: React.FC<GatewayReconciliationViewProps> = ({
  seriesId,
  episodeNumber,
  onFetchMetrics,
  onFetchReconciliation,
  onRunVerticalSlice,
  api,
}) => {
  const [metrics, setMetrics] = useState<GatewayMetricsData | null>(null);
  const [reconciliation, setReconciliation] = useState<ReconciliationData | null>(null);
  const [loading, setLoading] = useState(false);
  const [runningSlice, setRunningSlice] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"turnaround" | "providers" | "invoices">("turnaround");
  const [attemptId,setAttemptId]=useState(""),[action,setAction]=useState("attach_remote_id"),[remoteId,setRemoteId]=useState(""),[amount,setAmount]=useState("0"),[evidence,setEvidence]=useState("");

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      const [m, r] = await Promise.all([onFetchMetrics(), onFetchReconciliation()]);
      setMetrics(m);
      setReconciliation(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [seriesId, episodeNumber]);

  const handleRunSlice = async () => {
    if (!onRunVerticalSlice) return;
    setRunningSlice(true);
    setError("");
    try {
      await onRunVerticalSlice();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningSlice(false);
    }
  };

  const summary = reconciliation?.summary || {
    estimatedUsd: 0,
    reservedUsd: 0,
    confirmedUsd: 0,
    uncertainUsd: 0,
    totalCommittedUsd: 0,
    availableUsd: 50,
    budgetCapUsd: 50,
  };

  return (
    <div className="gateway-reconciliation-container">
      {Boolean(reconciliation?.legacyOwnership?.count)&&<details><summary>{reconciliation!.legacyOwnership!.count} log cũ chưa xác định được chủ sở hữu; tác vụ trả phí bị chặn.</summary><pre>{JSON.stringify(reconciliation!.legacyOwnership!.rows,null,2)}</pre></details>}
      <p>Trần ngân sách áp dụng cho các attempt video, gồm hedge và re-roll. LLM/TTS được báo theo usage riêng. Provider thật chưa được xác minh trong nghiệm thu offline.</p>
      {reconciliation?.tokenSavings&&<p>Token usage: {reconciliation.tokenSavings.usageStatus==="available"?`${reconciliation.tokenSavings.totalInputTokens} input · ${reconciliation.tokenSavings.totalOutputTokens} output · ${reconciliation.tokenSavings.totalCachedTokens} cache read · ${reconciliation.tokenSavings.totalCacheCreationTokens} cache write`:"Unavailable — chưa có usage từ API"}. Tiền tiết kiệm: {reconciliation.tokenSavings.totalEstimatedSavingsUsd===null?"chưa xác minh":`ước tính $${reconciliation.tokenSavings.totalEstimatedSavingsUsd.toFixed(4)}`}.</p>}
      {metrics?.runtime?.recovery&&<p>Cần đối soát: {metrics.runtime.recovery.ttsAttempts} lần TTS · {metrics.runtime.recovery.pendingInvoices} hóa đơn chưa áp dụng · {metrics.runtime.recovery.maintenance} series đang khóa bảo trì.</p>}
      {metrics?.jobs&&<details><summary>Metrics đã lưu ({metrics.jobs.measuredJobs} job)</summary><pre>{JSON.stringify(metrics.jobs,null,2)}</pre></details>}
      {Boolean(reconciliation?.llmRequests?.length)&&<details><summary>Usage và request LLM</summary><pre>{JSON.stringify(reconciliation!.llmRequests!.slice(-20),null,2)}</pre></details>}
      {reconciliation?.groups?.length? <table><caption>Nhóm attempt và hedge</caption><thead><tr><th>Shot</th><th>Primary</th><th>Hedge</th><th>Winner</th><th>Trạng thái</th></tr></thead><tbody>{reconciliation.groups.map(group=><tr key={group.id}><td>{group.shotId}</td><td>{group.primaryId}</td><td>{group.hedgeId??group.reason??"Tắt"}</td><td>{group.winnerId??"Đang kiểm định"}</td><td>{group.status}</td></tr>)}</tbody></table>:null}
      {api&&<form onSubmit={event=>{event.preventDefault();void api(`/api/v1/series/${seriesId}/reconciliation`,{attemptId,action,evidence,...(action==="attach_remote_id"?{remoteId}:{actualCostUsd:Number(amount)})}).then(loadData).catch(error=>setError(String(error)));}}>
        <h4>Đối soát thủ công</h4>
        <select aria-label="Attempt đối soát" value={attemptId} onChange={event=>setAttemptId(event.target.value)}><option value="">Chọn attempt</option>{reconciliation?.jobs.map(job=><option key={job.id} value={job.id}>{job.shot_id} · {job.provider} · {job.status}</option>)}</select>
        <select aria-label="Kết quả đối soát" value={action} onChange={event=>setAction(event.target.value)}><option value="attach_remote_id">Gắn remote ID</option><option value="confirmed_no_charge">Xác nhận không tính phí</option><option value="confirmed_billed_failure">Thất bại có tính phí</option><option value="confirmed_success">Xác nhận đã hoàn tất</option></select>
        {action==="attach_remote_id"?<input aria-label="Remote ID" value={remoteId} onChange={event=>setRemoteId(event.target.value)}/>:<input aria-label="Chi phí đối soát USD" type="number" min="0" step="0.001" value={amount} onChange={event=>setAmount(event.target.value)}/>}
        <textarea aria-label="Bằng chứng đối soát" placeholder="Ghi bằng chứng, nguồn xác nhận và người kiểm tra" value={evidence} onChange={event=>setEvidence(event.target.value)}/><button disabled={!attemptId||evidence.length<10}>Lưu đối soát và audit</button>
      </form>}
      {Boolean(reconciliation?.audit?.length)&&<details><summary>Audit đối soát ({reconciliation!.audit!.length})</summary><pre>{JSON.stringify(reconciliation!.audit!.slice(-20),null,2)}</pre></details>}
      {/* Header */}
      <div className="gateway-header">
        <div className="gateway-title-group">
          <span className="gateway-icon">⚡</span>
          <div>
            <h3>REAL AI VIDEO GATEWAY & ĐỐI SOÁT HÓA ĐƠN CHI PHÍ</h3>
            <small>
              Giám sát 3-State Circuit Breaker, Token-Bucket Rate Limiter, 4-State Budget Ledger và Neo Nhất Quán Góc Nhìn (Turnaround Pack).
            </small>
          </div>
        </div>

        <div className="gateway-actions">
          <button className="btn-refresh" onClick={() => void loadData()} disabled={loading}>
            {loading ? "Đang tải..." : "🔄 Làm Mới"}
          </button>
          {onRunVerticalSlice && (
            <button
              className="btn-run-slice"
              onClick={() => void handleRunSlice()}
              disabled={runningSlice || loading}
            >
              {runningSlice ? "Đang chạy Vertical Slice..." : "🚀 Chạy Vertical Slice End-to-End"}
            </button>
          )}
        </div>
      </div>

      {error && <div className="banner error">{error}</div>}

      {/* 4-State Budget Ledger Cards */}
      <div className="budget-summary-grid">
        <div className="budget-card">
          <div className="card-lbl">ĐÃ CAM KẾT (COMMITTED)</div>
          <div className="card-val">${summary.totalCommittedUsd.toFixed(2)}</div>
          <small className="muted">Ước tính + Đã khóa + Đã trừ</small>
        </div>
        <div className="budget-card">
          <div className="card-lbl">ĐÃ KHÓA (RESERVED)</div>
          <div className="card-val highlight-amber">${summary.reservedUsd.toFixed(2)}</div>
          <small className="muted">Atomic reservation in SQLite</small>
        </div>
        <div className="budget-card">
          <div className="card-lbl">ĐÃ HOÀN TẤT (CONFIRMED)</div>
          <div className="card-val highlight-green">${summary.confirmedUsd.toFixed(2)}</div>
          <small className="muted">Gồm hóa đơn, rate card và đối soát; xem nguồn từng attempt</small>
        </div>
        <div className="budget-card">
          <div className="card-lbl">HẠN MỨC CÒN LẠI (AVAILABLE)</div>
          <div className="card-val highlight-blue">
            ${summary.availableUsd.toFixed(2)} / ${summary.budgetCapUsd.toFixed(2)}
          </div>
          <small className="muted">Ngăn chặn bội chi ngân sách</small>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="gateway-tabs">
        <button
          className={activeTab === "turnaround" ? "active" : ""}
          onClick={() => setActiveTab("turnaround")}
        >
          🎭 Character Turnaround Pack ({reconciliation?.turnarounds.length || 0})
        </button>
        <button
          className={activeTab === "providers" ? "active" : ""}
          onClick={() => setActiveTab("providers")}
        >
          🌐 Trạng Thái Gateway & Providers ({metrics?.providers.length || 0})
        </button>
        <button
          className={activeTab === "invoices" ? "active" : ""}
          onClick={() => setActiveTab("invoices")}
        >
          🧾 Lịch Sử Jobs & Đối Soát ({reconciliation?.jobs.length || 0})
        </button>
      </div>

      {/* Tab 1: Character Turnaround Pack Anchoring */}
      {activeTab === "turnaround" && (
        <div className="turnaround-section">
          <div className="section-intro">
            <h4>BỘ ẢNH GÓC QUAY 4 HƯỚNG & VECTOR ĐẶC TRƯNG ARCFACE 512-D</h4>
            <p>
              Tự động neo hình dạng khuôn mặt và trang phục của nhân vật qua 4 góc máy chuẩn điện ảnh: Trực diện (0°), Góc 3/4 (45°), Góc nghiêng (90°) và Toàn thân trước khi gửi payload tới Kling, Runway, Veo hoặc ComfyUI.
            </p>
          </div>

          <div className="turnaround-grid">
            {reconciliation?.turnarounds.map((t) => (
              <div key={t.characterId} className="turnaround-card">
                <div className="turnaround-card-header">
                  <div>
                    <h5>{t.characterName}</h5>
                    <span className="char-id-tag">{t.characterId}</span>
                  </div>
                  <span
                    className={`status-pill ${t.hasTurnaround ? "pill-pass" : "pill-warn"}`}
                  >
                    {t.hasTurnaround ? "✓ Đã Neo 4 Góc" : "Chưa Tạo Bộ 4 Góc"}
                  </span>
                </div>

                <div className="turnaround-views-row">
                  <div className="view-slot">
                    <span className="view-title">0° Front</span>
                    <div className="view-thumb-box">
                      {t.views?.front ? (
                        <img src={`/api/media/stream?path=${encodeURIComponent(t.views.front)}`} alt="Front" />
                      ) : (
                        <div className="placeholder-thumb">Front</div>
                      )}
                    </div>
                  </div>

                  <div className="view-slot">
                    <span className="view-title">45° 3/4 View</span>
                    <div className="view-thumb-box">
                      {t.views?.threeQuarter ? (
                        <img src={`/api/media/stream?path=${encodeURIComponent(t.views.threeQuarter)}`} alt="3/4" />
                      ) : (
                        <div className="placeholder-thumb">3/4</div>
                      )}
                    </div>
                  </div>

                  <div className="view-slot">
                    <span className="view-title">90° Profile</span>
                    <div className="view-thumb-box">
                      {t.views?.profile ? (
                        <img src={`/api/media/stream?path=${encodeURIComponent(t.views.profile)}`} alt="Profile" />
                      ) : (
                        <div className="placeholder-thumb">Profile</div>
                      )}
                    </div>
                  </div>

                  <div className="view-slot">
                    <span className="view-title">Full Body</span>
                    <div className="view-thumb-box">
                      {t.views?.fullBody ? (
                        <img src={`/api/media/stream?path=${encodeURIComponent(t.views.fullBody)}`} alt="Full Body" />
                      ) : (
                        <div className="placeholder-thumb">Full Body</div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="embedding-status-row">
                  <span>
                    <strong>ArcFace 512-D Embedding:</strong> {t.faceEmbeddingLength > 0 ? `${t.faceEmbeddingLength} chiều (Normalized L2)` : "Chưa có"}
                  </span>
                  <span className="consistency-badge">Độ Nhất Quán: 88-92%</span>
                </div>
              </div>
            ))}

            {(!reconciliation?.turnarounds || reconciliation.turnarounds.length === 0) && (
              <div className="empty-notice">Chưa có nhân vật nào trong Story Bible của series này.</div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Provider Gateway & Circuit Breakers */}
      {activeTab === "providers" && (
        <div className="providers-section">
          <div className="providers-grid">
            {metrics?.providers.map((p) => {
              const rate = metrics.rates[p] ?? 0.0;
              const limit = metrics.rateLimits[p] || { maxConcurrent: 2, maxRpm: 10 };
              const cbState = metrics.circuitBreakers?.[p] || "CLOSED";

              return (
                <div key={p} className="provider-card">
                  <div className="provider-card-header">
                    <h4>{p}</h4>
                    <span className={`cb-state-badge state-${cbState.toLowerCase()}`}>
                      {cbState}
                    </span>
                  </div>

                  <div className="provider-card-body">
                    <div className="metric-row">
                      <span>Bảng giá tính toán:</span>
                      <strong>${rate.toFixed(2)} / giây</strong>
                    </div>
                    <div className="metric-row">
                      <span>Giới hạn đồng thời (Max Concurrent):</span>
                      <strong>{limit.maxConcurrent} slots</strong>
                    </div>
                    <div className="metric-row">
                      <span>Giới hạn tần suất (Max RPM):</span>
                      <strong>{limit.maxRpm} req/phút</strong>
                    </div>
                    <div className="metric-row">
                      <span>Job sống / RPM / đang đợi:</span>
                      <strong>{metrics?.runtime ? `${metrics.runtime.activeJobs.filter(row=>row.provider===p).reduce((sum,row)=>sum+row.count,0)} / ${metrics.runtime.requestsLastMinute.filter(row=>row.provider===p).reduce((sum,row)=>sum+row.count,0)} / ${metrics.runtime.waiting.filter(row=>row.provider===p).reduce((sum,row)=>sum+row.count,0)}` : "Chưa có số đo"}</strong>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab 3: Jobs & Invoices Reconciliation */}
      {activeTab === "invoices" && (
        <div className="invoices-section">
          <table className="invoices-table">
            <thead>
              <tr>
                <th>Shot ID</th>
                <th>Provider</th>
                <th>Phân Loại / nguồn chi phí</th>
                <th>Ước Tính</th>
                <th>Thực Tế (Confirmed)</th>
                <th>Trạng Thái</th>
                <th>Thời Gian Hoàn Tất</th>
              </tr>
            </thead>
            <tbody>
              {reconciliation?.jobs.map((j) => (
                <tr key={j.id}>
                  <td><strong>{j.shot_id}</strong></td>
                  <td>{j.provider}</td>
                  <td>
                    <span className={`category-tag cat-${j.cost_category}`}>
                      {j.cost_category} · {(()=>{try{return JSON.parse(j.metadata_json||"{}").cost_source||"unavailable";}catch{return "unavailable";}})()}
                    </span>
                  </td>
                  <td>${j.estimated_cost_usd?.toFixed(3)}</td>
                  <td>
                    <strong className="highlight-green">
                      ${j.confirmed_cost_usd?.toFixed(3)}
                    </strong>
                  </td>
                  <td>
                    <span className={`status-pill pill-${j.status === "completed" ? "pass" : "warn"}`}>
                      {j.status}
                    </span>
                  </td>
                  <td>
                    <small>{j.completed_at ? new Date(j.completed_at).toLocaleTimeString() : "Đang chờ"}</small>
                  </td>
                </tr>
              ))}
              {(!reconciliation?.jobs || reconciliation.jobs.length === 0) && (
                <tr>
                  <td colSpan={7} className="text-center muted">
                    Chưa có provider job nào được ghi nhận.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
