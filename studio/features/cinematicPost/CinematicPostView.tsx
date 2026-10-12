import {PostprocessViewSchema,type PostprocessView} from '../../../src/contracts/postprocess-view.js';
import React, { useState, useEffect } from "react";
import type {StudioJob} from "../../../src/contracts/studio.js";

interface ColorPatch {
  name: string;
  originalRgb: number[];
  transformedRgb: number[];
}

export interface CinematicPostViewProps {
  seriesId: string;
  episodeNumber: number;
  api: <T = unknown>(path: string, body?: unknown) => Promise<T>;
  onNotice?: (msg: string) => void;
  onError?: (msg: string) => void;
  jobs?:StudioJob[];
}

export function CinematicPostView({
  seriesId,
  episodeNumber,
  api,
  onNotice,
  onError,
  jobs=[],
}: CinematicPostViewProps) {
  // ── 4K Super-Resolution State ──
  const [enable4k, setEnable4k] = useState(true);
  const [resolutionStandard, setResolutionStandard] = useState<"4k" | "1080p">("4k");
  const [filmGrain, setFilmGrain] = useState(0.15);
  const [unsharpStrength, setUnsharpStrength] = useState(0.8);

  // ── ASC CDL Color Grading State ──
  const [enableCdl, setEnableCdl] = useState(true);
  const [cdlPreset, setCdlPreset] = useState("kodak_2383");
  const [slope, setSlope] = useState<[number, number, number]>([1.06, 0.98, 0.91]);
  const [offset, setOffset] = useState<[number, number, number]>([-0.02, 0.0, 0.04]);
  const [power, setPower] = useState<[number, number, number]>([1.12, 1.08, 0.98]);
  const [saturation, setSaturation] = useState(1.15);
  const [colorSwatches, setColorSwatches] = useState<ColorPatch[]>([]);

  // ── Spatial Action Foley State ──
  const [enableFoley, setEnableFoley] = useState(false);
  const [foleyCues, setFoleyCues] = useState<Array<{id:string;actionPrompt:string;sourceX:number;distance:"medium"|"wide"|"close_up";offsetSec:number;durationSec:number}>>([
    {
      id: "cue_01",
      actionPrompt: "Bước chân dồn dập trên thềm đá",
      sourceX: -0.6,
      distance: "medium",
      offsetSec: 0.5,
      durationSec: 3.0,
    },
    {
      id: "cue_02",
      actionPrompt: "Mở then cửa sắt nặng nề",
      sourceX: 0.75,
      distance: "close_up",
      offsetSec: 2.2,
      durationSec: 2.0,
    },
    {
      id: "cue_03",
      actionPrompt: "Tiếng vọng và đổ vỡ xa xăm",
      sourceX: 0.1,
      distance: "wide",
      offsetSec: 4.0,
      durationSec: 2.5,
    },
  ]);

  // ── Broadcast QC & Conformance State ──
  const [enableConformance, setEnableConformance] = useState(true);
  const [deliveryStandard, setDeliveryStandard] = useState<"broadcast_ebu_r128" | "streaming_youtube_tiktok">("broadcast_ebu_r128");
  const [clampLegal, setClampLegal] = useState(true);

  // ── Processing & Result State ──
  const [isProcessing, setIsProcessing] = useState(false);
  const [postResult, setPostResult] = useState<PostprocessView|null>(null);
  const [jobId,setJobId]=useState("");
  const currentJob=jobs.find(job=>job.id===jobId);
  useEffect(()=>{if(currentJob?.result?.postprocess)setPostResult(PostprocessViewSchema.parse(currentJob.result.postprocess));},[currentJob?.updatedAt]);

  // Load preview color swatches on CDL changes
  const updateLutPreview = async (preset: string, s = slope, o = offset, p = power, sat = saturation) => {
    if (!seriesId) return;
    try {
      const res = await api<{preview:ColorPatch[]}>(`/api/v1/series/${seriesId}/cinematic-post/lut-preview`, {
        preset,
        customCdl: { slope: s, offset: o, power: p, saturation: sat },
      });
      if (res.preview) {
        setColorSwatches(res.preview);
      }
    } catch {
      // Fallback
    }
  };

  useEffect(() => {
    void updateLutPreview(cdlPreset);
  }, [seriesId, cdlPreset]);

  const handlePresetSelect = (presetKey: string) => {
    setCdlPreset(presetKey);
    // Preset defaults
    if (presetKey === "kodak_2383") {
      setSlope([1.06, 0.98, 0.91]);
      setOffset([-0.02, 0.0, 0.04]);
      setPower([1.12, 1.08, 0.98]);
      setSaturation(1.15);
      setFilmGrain(0.18);
    } else if (presetKey === "fuji_eterna") {
      setSlope([0.94, 1.02, 1.04]);
      setOffset([0.03, 0.02, 0.01]);
      setPower([0.95, 0.98, 1.02]);
      setSaturation(0.92);
      setFilmGrain(0.12);
    } else if (presetKey === "teal_orange") {
      setSlope([1.16, 1.0, 0.84]);
      setOffset([-0.04, 0.01, 0.06]);
      setPower([1.12, 1.02, 0.9]);
      setSaturation(1.25);
      setFilmGrain(0.14);
    } else if (presetKey === "cyberpunk_neon") {
      setSlope([0.88, 1.06, 1.24]);
      setOffset([0.05, -0.02, 0.08]);
      setPower([1.15, 0.95, 1.2]);
      setSaturation(1.35);
      setFilmGrain(0.16);
    } else if (presetKey === "bleach_bypass") {
      setSlope([1.25, 1.25, 1.25]);
      setOffset([-0.08, -0.08, -0.08]);
      setPower([1.32, 1.32, 1.32]);
      setSaturation(0.45);
      setFilmGrain(0.25);
    } else if (presetKey === "monochrome_noir") {
      setSlope([1.1, 1.1, 1.1]);
      setOffset([-0.03, -0.03, -0.03]);
      setPower([1.15, 1.15, 1.15]);
      setSaturation(0.0);
      setFilmGrain(0.22);
    } else {
      setSlope([1.0, 1.0, 1.0]);
      setOffset([0.0, 0.0, 0.0]);
      setPower([1.0, 1.0, 1.0]);
      setSaturation(1.0);
      setFilmGrain(0.08);
    }
  };

  const handleRunPostProcessing = async () => {
    if (!seriesId) {
      onError?.("Vui lòng chọn series.");
      return;
    }

    setIsProcessing(true);
    setPostResult(null);
    try {
      const res = await api<{jobId:string}>(`/api/v1/series/${seriesId}/cinematic-post/process`, {
        episodeNumber,
        enableSuperResolution: enable4k,
        resolutionStandard,
        filmGrainIntensity: filmGrain,
        unsharpStrength,
        enableCdlGrading: enableCdl,
        cdlPreset,
        customCdl: { slope, offset, power, saturation },
        enableSpatialFoley: enableFoley,
        foleyCues,
        enableBroadcastConformance: enableConformance,
        deliveryStandard,
        clampLegalRange: clampLegal,
      });

      setJobId(res.jobId);onNotice?.(`Đã xếp hàng hậu kỳ cho Tập ${episodeNumber}. Theo dõi tiến độ trong hàng đợi.`);
    } catch (err: unknown) {
      onError?.((err instanceof Error ? err.message : String(err)) || "Lỗi khi chạy hậu kỳ điện ảnh.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="cinematic-post-container" style={{ padding: "16px", color: "#e2e8f0" }}>
      {currentJob&&<p role="status">Hậu kỳ: {currentJob.status} · {currentJob.progress?.message} {currentJob.error?.message}</p>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.3rem", color: "#60a5fa" }}>
            🎨 Hậu Kỳ Điện Ảnh, 4K Super-Resolution & Chuẩn Hóa Phát Thanh
          </h2>
          <small style={{ color: "#94a3b8" }}>
            Series: <strong>{seriesId || "Chưa chọn"}</strong> · Tập {episodeNumber} · Hollywood-grade Post Suite
          </small>
        </div>
        <button
          onClick={handleRunPostProcessing}
          disabled={Boolean(currentJob&&["queued","running","paused"].includes(currentJob.status))||isProcessing || !seriesId}
          style={{
            background: isProcessing ? "#475569" : "linear-gradient(135deg, #2563eb, #7c3aed)",
            color: "#fff",
            padding: "10px 22px",
            borderRadius: "6px",
            fontWeight: "bold",
            cursor: isProcessing ? "not-allowed" : "pointer",
            border: "none",
            boxShadow: "0 4px 12px rgba(37, 99, 235, 0.3)",
          }}
        >
          {isProcessing ? "⏳ Đang xử lý Hậu Kỳ..." : "🚀 Thực Thi Hậu Kỳ Toàn Diện"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
        {/* ── Pillar 1: 4K Super-Resolution & Film Grain ── */}
        <div style={{ background: "#1e293b", padding: "16px", borderRadius: "8px", border: "1px solid #334155" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: "1.1rem", color: "#38bdf8" }}>
              🔍 1. 4K Super-Resolution & Film Grain
            </h3>
            <label style={{ fontSize: "0.85rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={enable4k}
                onChange={(e) => setEnable4k(e.target.checked)}
                style={{ marginRight: "6px" }}
              />
              Kích hoạt
            </label>
          </div>

          <div style={{ marginTop: "14px", opacity: enable4k ? 1 : 0.4 }}>
            <label style={{ display: "block", marginBottom: "8px", fontSize: "0.9rem" }}>
              Độ phân giải đích:
              <select
                value={resolutionStandard}
                onChange={(e) => setResolutionStandard(e.target.value as typeof resolutionStandard)}
                style={{ width: "100%", marginTop: "4px", padding: "6px", background: "#0f172a", color: "#fff", border: "1px solid #475569", borderRadius: "4px" }}
              >
                <option value="4k">4K UHD (3840x2160 / 2160x3840) · 10-bit Rec.709</option>
                <option value="1080p">1080p Full HD (1920x1080 / 1080x1920) · 8-bit</option>
              </select>
            </label>

            <div style={{ marginTop: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem" }}>
                <span>Độ sắc nét biên (Unsharp):</span>
                <strong>{unsharpStrength.toFixed(2)}</strong>
              </div>
              <input
                type="range"
                min="0.0"
                max="1.5"
                step="0.05"
                value={unsharpStrength}
                onChange={(e) => setUnsharpStrength(parseFloat(e.target.value))}
                style={{ width: "100%" }}
              />
            </div>

            <div style={{ marginTop: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem" }}>
                <span>Organic Film Grain (35mm):</span>
                <strong>{(filmGrain * 100).toFixed(0)}%</strong>
              </div>
              <input
                type="range"
                min="0.0"
                max="0.5"
                step="0.01"
                value={filmGrain}
                onChange={(e) => setFilmGrain(parseFloat(e.target.value))}
                style={{ width: "100%" }}
              />
              <small style={{ color: "#94a3b8", fontSize: "0.75rem" }}>
                Hạt phim hữu cơ triệt tiêu độ bóng giả của video AI & chống hiện tượng banding chuyển sắc.
              </small>
            </div>
          </div>
        </div>

        {/* ── Pillar 2: ASC CDL Color Grading & 3D LUT ── */}
        <div style={{ background: "#1e293b", padding: "16px", borderRadius: "8px", border: "1px solid #334155" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: "1.1rem", color: "#f59e0b" }}>
              🎬 2. ASC CDL Chỉnh Màu & 3D LUT (.cube)
            </h3>
            <label style={{ fontSize: "0.85rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={enableCdl}
                onChange={(e) => setEnableCdl(e.target.checked)}
                style={{ marginRight: "6px" }}
              />
              Kích hoạt
            </label>
          </div>

          <div style={{ marginTop: "14px", opacity: enableCdl ? 1 : 0.4 }}>
            <label style={{ display: "block", marginBottom: "8px", fontSize: "0.9rem" }}>
              Cinematic Look Preset:
              <select
                value={cdlPreset}
                onChange={(e) => handlePresetSelect(e.target.value)}
                style={{ width: "100%", marginTop: "4px", padding: "6px", background: "#0f172a", color: "#fff", border: "1px solid #475569", borderRadius: "4px" }}
              >
                <option value="kodak_2383">Kodak Vision 2383 (Hollywood Classic)</option>
                <option value="fuji_eterna">Fujifilm Eterna 500T (Pastel / Dịu dàng)</option>
                <option value="teal_orange">Blockbuster Teal & Orange (Hành động kịch tính)</option>
                <option value="cyberpunk_neon">Cyberpunk Neo-Noir (Huyền ảo Neon)</option>
                <option value="bleach_bypass">Bleach Bypass (Gai góc / Khắc nghiệt)</option>
                <option value="monochrome_noir">35mm Film Noir (Trắng đen kinh điển)</option>
                <option value="natural_balance">Natural Rec.709 (Trung tính)</option>
              </select>
            </label>

            {/* Color Swatch Previews */}
            <div style={{ marginTop: "10px" }}>
              <small style={{ color: "#94a3b8", display: "block", marginBottom: "6px" }}>
                Mô phỏng màu sắc quang phổ (Test Swatches):
              </small>
              <div style={{ display: "flex", gap: "8px" }}>
                {colorSwatches.map((s, idx) => {
                  const [r, g, b] = s.transformedRgb;
                  const bg = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
                  return (
                    <div
                      key={idx}
                      title={`${s.name}\nRGB: [${r}, ${g}, ${b}]`}
                      style={{
                        flex: 1,
                        height: "28px",
                        backgroundColor: bg,
                        borderRadius: "4px",
                        border: "1px solid rgba(255,255,255,0.2)",
                      }}
                    />
                  );
                })}
              </div>
            </div>

            <div style={{ marginTop: "10px", display: "flex", gap: "10px", fontSize: "0.8rem", color: "#94a3b8" }}>
              <span>Slope: [{slope.join(", ")}]</span>
              <span>Power: [{power.join(", ")}]</span>
              <span>Sat: {saturation.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* ── Pillar 3: Action Foley V2A & Spatial Panning ── */}
        <div style={{ background: "#1e293b", padding: "16px", borderRadius: "8px", border: "1px solid #334155" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: "1.1rem", color: "#a855f7" }}>
              🎧 3. Foley V2A & Định Vị Không Gian (Spatial Pan)
            </h3>
            <label style={{ fontSize: "0.85rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={enableFoley}
                onChange={(e) => setEnableFoley(e.target.checked)}
                style={{ marginRight: "6px" }}
              />
              Kích hoạt
            </label>
          </div>

          <div style={{ marginTop: "14px", opacity: enableFoley ? 1 : 0.4 }}>
            <small style={{ color: "#94a3b8", display: "block", marginBottom: "8px" }}>
              Định luật Constant-Power Panning (Bảo toàn công suất âm học L²+R²=1.0):
            </small>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {foleyCues.map((cue, idx) => {
                const posXPercent = ((cue.sourceX + 1.0) / 2.0) * 100;
                return (
                  <div
                    key={cue.id || idx}
                    style={{
                      background: "#0f172a",
                      padding: "8px",
                      borderRadius: "4px",
                      border: "1px solid #334155",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
                      <span><strong>{cue.actionPrompt}</strong></span>
                      <span style={{ color: "#c084fc" }}>
                        {cue.distance === "close_up" ? "Gần (0dB)" : cue.distance === "medium" ? "Vừa (-2.5dB)" : "Xa (-6dB)"}
                      </span>
                    </div>

                    {/* Spatial Pan Bar */}
                    <div
                      style={{
                        position: "relative",
                        height: "12px",
                        background: "#1e293b",
                        borderRadius: "6px",
                        marginTop: "6px",
                      }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          left: "50%",
                          top: 0,
                          bottom: 0,
                          width: "2px",
                          background: "#475569",
                        }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          left: `calc(${posXPercent}% - 6px)`,
                          top: 0,
                          width: "12px",
                          height: "12px",
                          borderRadius: "50%",
                          background: "#c084fc",
                          boxShadow: "0 0 6px #a855f7",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Pillar 4: Broadcast QC & Conformance ── */}
        <div style={{ background: "#1e293b", padding: "16px", borderRadius: "8px", border: "1px solid #334155" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: "1.1rem", color: "#10b981" }}>
              📡 4. Chuẩn Hóa Phát Thanh & EBU R128 QC
            </h3>
            <label style={{ fontSize: "0.85rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={enableConformance}
                onChange={(e) => setEnableConformance(e.target.checked)}
                style={{ marginRight: "6px" }}
              />
              Kích hoạt
            </label>
          </div>

          <div style={{ marginTop: "14px", opacity: enableConformance ? 1 : 0.4 }}>
            <label style={{ display: "block", marginBottom: "10px", fontSize: "0.9rem" }}>
              Tiêu chuẩn phân phối:
              <select
                value={deliveryStandard}
                onChange={(e) => setDeliveryStandard(e.target.value as typeof deliveryStandard)}
                style={{ width: "100%", marginTop: "4px", padding: "6px", background: "#0f172a", color: "#fff", border: "1px solid #475569", borderRadius: "4px" }}
              >
                <option value="broadcast_ebu_r128">Truyền hình EBU R128 (-23.0 LUFS ±0.5, TP ≤ -1.0 dBTP)</option>
                <option value="streaming_youtube_tiktok">Mạng xã hội / Streaming (-14.0 LUFS, TP ≤ -1.0 dBTP)</option>
              </select>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.85rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={clampLegal}
                onChange={(e) => setClampLegal(e.target.checked)}
              />
              Khóa dải sáng Studio Legal Range (16-235 YUV) chống cháy sáng / clip gam màu
            </label>

            <div style={{ marginTop: "14px", padding: "8px", background: "#0f172a", borderRadius: "4px", fontSize: "0.8rem", color: "#94a3b8" }}>
              <div>• 2-Pass Loudness Conformance: Khử hiện tượng pumping âm thanh.</div>
              <div>• Chứng chỉ QC tự động: Kiểm tra chuẩn hóa broadcast / streaming.</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Deliverables & Results Manifest ── */}
      {postResult && (
        <div style={{ marginTop: "24px", background: "#0f172a", padding: "16px", borderRadius: "8px", border: "1px solid #22c55e" }}>
          <h3 style={{ margin: "0 0 12px 0", color: "#4ade80", fontSize: "1.1rem" }}>
            ✓ Hồ Sơ Xuất Bản Hậu Kỳ Điện Ảnh Đã Hoàn Tất
          </h3>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", fontSize: "0.85rem" }}>
            <div>
              <strong>Các giai đoạn hoàn thành:</strong>
              <ul style={{ margin: "4px 0", paddingLeft: "20px", color: "#cbd5e1" }}>
                {postResult.stagesCompleted?.map((s: string) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>

            <div>
              <strong>Tệp tư liệu xuất xưởng (Deliverables):</strong>
              <div style={{ marginTop: "4px", display: "flex", flexDirection: "column", gap: "4px", color: "#60a5fa" }}>
                {postResult.artifacts?.finalDeliveryMasterPath && (
                  <div>🎬 <strong>Bản Master Hoàn Chỉnh:</strong> {postResult.artifacts.finalDeliveryMasterPath}</div>
                )}
                {postResult.artifacts?.lutCubePath && (
                  <div>🎨 <strong>3D LUT (.cube):</strong> {postResult.artifacts.lutCubePath}</div>
                )}
                {postResult.artifacts?.cdlXmlPath && (
                  <div>📑 <strong>DaVinci Resolve CDL:</strong> {postResult.artifacts.cdlXmlPath}</div>
                )}
                {postResult.artifacts?.spatialFoleyStemPath && (
                  <div>🎧 <strong>Stem Foley Spatial:</strong> {postResult.artifacts.spatialFoleyStemPath}</div>
                )}
                {postResult.artifacts?.qcReportPath && (
                  <div>📊 <strong>Báo Cáo QC Phát Thanh:</strong> {postResult.artifacts.qcReportPath}</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
