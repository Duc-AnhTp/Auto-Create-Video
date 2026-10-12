import type {SceneHarmonizationResult} from '../../../src/contracts/media-features.js';
import React, { useState, useEffect } from "react";

export interface SceneLightingMatcherViewProps {
  seriesId: string;
  episodeNumber: number;
  api: <T = unknown>(path: string, body?: unknown) => Promise<T>;
  onNotice?: (msg: string) => void;
  onError?: (msg: string) => void;
}

export function SceneLightingMatcherView({
  seriesId,
  episodeNumber,
  api,
  onNotice,
  onError,
}: SceneLightingMatcherViewProps) {
  const [sceneId, setSceneId] = useState("scene_01");
  const [preset, setPreset] = useState<
    "golden_hour" | "daylight_overcast" | "cyberpunk_night" | "interior_candle"
  >("golden_hour");
  const [azimuthDeg, setAzimuthDeg] = useState(45);
  const [elevationDeg, setElevationDeg] = useState(25);
  const [intensity, setIntensity] = useState(1.25);
  const [enableRimLight, setEnableRimLight] = useState(true);
  const [rimIntensity, setRimIntensity] = useState(0.85);

  const [isLoading, setIsLoading] = useState(false);
  const [harmonizationResult, setHarmonizationResult] = useState<SceneHarmonizationResult|null>(null);
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);

  const handleHarmonize = async () => {
    if (!seriesId) return;
    setIsLoading(true);
    try {
      const res = await api<{success:boolean;result:SceneHarmonizationResult}>(
        `/api/v1/series/${seriesId}/scenes/${sceneId}/lighting/harmonize`,
        {
          episodeNumber,
          targetEnvironmentPreset: preset,
          keyLightAzimuthDeg: azimuthDeg,
          keyLightElevationDeg: elevationDeg,
        }
      );

      if (res.success && res.result) {
        setHarmonizationResult(res.result);
        if (res.result.profiles?.length > 0 && !selectedShotId) {
          setSelectedShotId(res.result.profiles[0].shotId);
        }
        onNotice?.(
          `✓ Đã tính cấu hình ánh sáng cho Cảnh [${sceneId}] theo patch đầu vào. Độ đồng nhất ước tính: ${(
            res.result.sceneConsistencyScore * 100
          ).toFixed(1)}%`
        );
      }
    } catch (err: unknown) {
      onError?.((err instanceof Error ? err.message : String(err)) || "Lỗi khi đồng nhất ánh sáng phân cảnh.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void handleHarmonize();
  }, [seriesId, episodeNumber, sceneId, preset]);

  const selectedProfile = harmonizationResult?.profiles?.find(
    (p) => p.shotId === selectedShotId
  );

  return (
    <div className="scene-lighting-container" style={{ padding: "16px", color: "#e2e8f0" }}>
      {/* ── Header ── */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: "1.3rem", color: "#f59e0b" }}>
            💡 Đồng Nhất Ánh Sáng &amp; Color Match Đa Phân Cảnh (Scene Lighting &amp; Style Transfer)
          </h2>
          <small style={{ color: "#94a3b8" }}>
            Series: <strong>{seriesId || "Chưa chọn"}</strong> · Tập{" "}
            <strong>{episodeNumber}</strong> · Chuẩn ASC CDL &amp; Depth Ambient Relighting
          </small>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <label style={{ fontSize: "0.85rem", color: "#94a3b8" }}>
            Mã Cảnh:
            <input
              type="text"
              value={sceneId}
              onChange={(e) => setSceneId(e.target.value)}
              style={{
                marginLeft: "6px",
                background: "#0f172a",
                border: "1px solid #334155",
                color: "#f59e0b",
                padding: "4px 8px",
                borderRadius: "4px",
                width: "90px",
                fontWeight: "bold",
              }}
            />
          </label>

          <button
            onClick={() => void handleHarmonize()}
            disabled={isLoading || !seriesId}
            style={{
              background: "linear-gradient(135deg, #d97706, #b45309)",
              border: "none",
              color: "#fff",
              padding: "6px 14px",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: "bold",
              boxShadow: "0 2px 8px rgba(217, 119, 6, 0.3)",
            }}
          >
            {isLoading ? "Đang xử lý..." : "⚡ Đồng Bộ Ánh Sáng"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        {/* ── 1. 3D Light Gizmo & Environment Controls ── */}
        <div
          style={{
            background: "#1e293b",
            padding: "16px",
            borderRadius: "8px",
            border: "1px solid #334155",
          }}
        >
          <h3 style={{ margin: "0 0 12px 0", fontSize: "1.05rem", color: "#38bdf8" }}>
            🧭 1. Thiết Lập Nguồn Sáng 3D &amp; Môi Trường Cảnh
          </h3>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
            <div>
              <label style={{ fontSize: "0.8rem", color: "#94a3b8", display: "block", marginBottom: "4px" }}>
                Bầu Không Khí Ánh Sáng:
              </label>
              <select
                value={preset}
                onChange={(e) => setPreset(e.target.value as typeof preset)}
                style={{
                  width: "100%",
                  background: "#0f172a",
                  color: "#fff",
                  border: "1px solid #334155",
                  padding: "6px",
                  borderRadius: "4px",
                  fontSize: "0.85rem",
                }}
              >
                <option value="golden_hour">🌅 Giờ Vàng (Golden Hour - 4200K)</option>
                <option value="daylight_overcast">☁️ Ban Ngày Dịu (Daylight - 5600K)</option>
                <option value="cyberpunk_night">🌃 Đêm Cyberpunk (Neon Cool - 7800K)</option>
                <option value="interior_candle">🕯️ Nội Thất Ấm (Candle/Tungsten - 2800K)</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: "0.8rem", color: "#94a3b8", display: "block", marginBottom: "4px" }}>
                Cường Độ Sáng ({intensity.toFixed(2)}x):
              </label>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.05"
                value={intensity}
                onChange={(e) => setIntensity(parseFloat(e.target.value))}
                style={{ width: "100%" }}
              />
            </div>
          </div>

          {/* Azimuth Angle Slider */}
          <div style={{ marginBottom: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
              <span style={{ color: "#94a3b8" }}>Góc Phương Vị Key Light (Azimuth):</span>
              <strong style={{ color: "#fbbf24" }}>
                {azimuthDeg}° {azimuthDeg < -30 ? "(Trái Máy)" : azimuthDeg > 30 ? "(Phải Máy)" : "(Chính Diện)"}
              </strong>
            </div>
            <input
              type="range"
              min="-180"
              max="180"
              step="5"
              value={azimuthDeg}
              onChange={(e) => setAzimuthDeg(parseInt(e.target.value, 10))}
              style={{ width: "100%" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", color: "#64748b" }}>
              <span>-180° Sau Lưng</span>
              <span>-90° Trái</span>
              <span>0° Chính Diện</span>
              <span>+90° Phải</span>
              <span>+180° Viền Sau</span>
            </div>
          </div>

          {/* Elevation Angle Slider */}
          <div style={{ marginBottom: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
              <span style={{ color: "#94a3b8" }}>Độ Cao Nguồn Sáng (Elevation):</span>
              <strong style={{ color: "#38bdf8" }}>
                {elevationDeg}° {elevationDeg > 40 ? "(Chiếu Cao)" : elevationDeg < 0 ? "(Hắt Dưới)" : "(Ngang Tầm Mắt)"}
              </strong>
            </div>
            <input
              type="range"
              min="-30"
              max="80"
              step="5"
              value={elevationDeg}
              onChange={(e) => setElevationDeg(parseInt(e.target.value, 10))}
              style={{ width: "100%" }}
            />
          </div>

          {/* Rim Light / Backlight Toggle & Intensity */}
          <div
            style={{
              background: "#0f172a",
              padding: "10px",
              borderRadius: "6px",
              border: "1px solid #334155",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.85rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={enableRimLight}
                  onChange={(e) => setEnableRimLight(e.target.checked)}
                />
                <span>Tách Viền Tóc / Rim Light (Fresnel Separation)</span>
              </label>
              <span style={{ fontSize: "0.75rem", color: enableRimLight ? "#4ade80" : "#64748b", fontWeight: "bold" }}>
                {enableRimLight ? "BẬT" : "TẮT"}
              </span>
            </div>
            {enableRimLight && (
              <div style={{ marginTop: "8px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "#94a3b8" }}>
                  <span>Cường độ viền ({rimIntensity.toFixed(2)}):</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1.5"
                  step="0.05"
                  value={rimIntensity}
                  onChange={(e) => setRimIntensity(parseFloat(e.target.value))}
                  style={{ width: "100%", marginTop: "4px" }}
                />
              </div>
            )}
          </div>
        </div>

        {/* ── 2. Scene Lighting Consistency Stats ── */}
        <div
          style={{
            background: "#1e293b",
            padding: "16px",
            borderRadius: "8px",
            border: "1px solid #334155",
          }}
        >
          <h3 style={{ margin: "0 0 12px 0", fontSize: "1.05rem", color: "#4ade80" }}>
            📊 2. Chỉ Số Đạt Chuẩn Đồng Bộ Cảnh
          </h3>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
            <div style={{ background: "#0f172a", padding: "10px", borderRadius: "6px", border: "1px solid #334155" }}>
              <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>Độ Đồng Nhất Toàn Cảnh</div>
              <div style={{ fontSize: "1.4rem", fontWeight: "bold", color: "#4ade80" }}>
                {harmonizationResult
                  ? `${(harmonizationResult.sceneConsistencyScore * 100).toFixed(1)}%`
                  : "Đang tính..."}
              </div>
            </div>

            <div style={{ background: "#0f172a", padding: "10px", borderRadius: "6px", border: "1px solid #334155" }}>
              <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>Nhiệt Độ Màu Master Shot</div>
              <div style={{ fontSize: "1.4rem", fontWeight: "bold", color: "#f59e0b" }}>
                {harmonizationResult?.masterCct?.cctKelvin || 4200}K
              </div>
            </div>
          </div>

          {/* ComfyUI AI Prompt Directives */}
          {selectedProfile && (
            <div style={{ background: "#0f172a", padding: "12px", borderRadius: "6px", border: "1px solid #334155" }}>
              <div style={{ fontSize: "0.75rem", color: "#38bdf8", fontWeight: "bold", marginBottom: "6px" }}>
                🤖 Chỉ Lệnh Ánh Sáng Cho AI Model (ComfyUI / Wan 2.1 / Kling):
              </div>
              <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "0.75rem", color: "#cbd5e1" }}>
                {selectedProfile.comfyUiDirectives?.promptModifiers?.map((m: string, idx: number) => (
                  <li key={idx}><code>"{m}"</code></li>
                ))}
              </ul>
              <div style={{ marginTop: "6px", fontSize: "0.7rem", color: "#94a3b8" }}>
                • Hướng dẫn: {selectedProfile.comfyUiDirectives?.relightingGuidance}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── 3. Multi-Shot Coverage Harmonization Table ── */}
      <div style={{ marginTop: "16px", background: "#1e293b", padding: "16px", borderRadius: "8px", border: "1px solid #334155" }}>
        <h4 style={{ margin: "0 0 12px 0", color: "#f59e0b", fontSize: "1rem" }}>
          🎬 3. Bảng Phân Tích &amp; So Khớp Từng Cú Máy Trong Cảnh
        </h4>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
            <thead>
              <tr style={{ background: "#0f172a", borderBottom: "1px solid #334155", color: "#94a3b8" }}>
                <th style={{ padding: "8px", textAlign: "left" }}>Shot ID</th>
                <th style={{ padding: "8px", textAlign: "left" }}>Loại Cú Máy</th>
                <th style={{ padding: "8px", textAlign: "center" }}>Vai Trò</th>
                <th style={{ padding: "8px", textAlign: "center" }}>Nhiệt Độ Màu Gốc</th>
                <th style={{ padding: "8px", textAlign: "center" }}>Sau So Khớp</th>
                <th style={{ padding: "8px", textAlign: "center" }}>Bù Lệch CCT</th>
                <th style={{ padding: "8px", textAlign: "center" }}>ASC CDL (Slope / Offset)</th>
                <th style={{ padding: "8px", textAlign: "center" }}>Độ Tin Cậy</th>
              </tr>
            </thead>
            <tbody>
              {harmonizationResult?.profiles?.map((p: any) => {
                const isSelected = p.shotId === selectedShotId;
                return (
                  <tr
                    key={p.shotId}
                    onClick={() => setSelectedShotId(p.shotId)}
                    style={{
                      borderBottom: "1px solid #334155",
                      background: isSelected ? "#1e3a8a" : "transparent",
                      cursor: "pointer",
                    }}
                  >
                    <td style={{ padding: "8px", fontWeight: "bold", color: "#38bdf8" }}>{p.shotId}</td>
                    <td style={{ padding: "8px", color: "#cbd5e1" }}>{p.shotType}</td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      {p.isSceneMaster ? (
                        <span style={{ background: "#d97706", color: "#fff", padding: "2px 6px", borderRadius: "4px", fontSize: "0.7rem", fontWeight: "bold" }}>
                          MASTER CHUẨN
                        </span>
                      ) : p.shotType === "ots_b_a" ? (
                        <span style={{ background: "#7c3aed", color: "#fff", padding: "2px 6px", borderRadius: "4px", fontSize: "0.7rem" }}>
                          ĐẢO GÓC SÁNG
                        </span>
                      ) : p.shotType === "close_up" ? (
                        <span style={{ background: "#059669", color: "#fff", padding: "2px 6px", borderRadius: "4px", fontSize: "0.7rem" }}>
                          NÂNG DA MẶT
                        </span>
                      ) : (
                        <span style={{ color: "#94a3b8" }}>Phối thuộc</span>
                      )}
                    </td>
                    <td style={{ padding: "8px", textAlign: "center", color: "#94a3b8" }}>
                      {p.sourceCct?.cctKelvin}K
                    </td>
                    <td style={{ padding: "8px", textAlign: "center", color: "#4ade80", fontWeight: "bold" }}>
                      {p.targetCct?.cctKelvin}K
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      <span style={{ color: p.cctDeltaKelvin > 0 ? "#f87171" : p.cctDeltaKelvin < 0 ? "#60a5fa" : "#94a3b8" }}>
                        {p.cctDeltaKelvin > 0 ? `+${p.cctDeltaKelvin}K` : `${p.cctDeltaKelvin}K`}
                      </span>
                    </td>
                    <td style={{ padding: "8px", textAlign: "center", fontSize: "0.75rem" }}>
                      <code>
                        S:[{p.cdlCorrection?.slope?.map((v: number) => v.toFixed(2)).join(",")}]
                      </code>
                    </td>
                    <td style={{ padding: "8px", textAlign: "center", color: "#4ade80", fontWeight: "bold" }}>
                      {(p.confidenceScore * 100).toFixed(0)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* FFmpeg Filter Graph Preview for Selected Shot */}
        {selectedProfile && (
          <div style={{ marginTop: "12px" }}>
            <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginBottom: "4px" }}>
              FFmpeg Filtergraph Cho <code>{selectedProfile.shotId}</code>:
            </div>
            <pre
              style={{
                background: "#0f172a",
                color: "#38bdf8",
                padding: "8px 12px",
                borderRadius: "4px",
                fontSize: "0.7rem",
                overflowX: "auto",
                margin: 0,
              }}
            >
              {selectedProfile.ffmpegFilterGraph}
            </pre>
          </div>
        )}
      </div>

      {/* ── 4. DaVinci Resolve CDL Manifest ── */}
      {harmonizationResult?.davinciCdlManifestXml && (
        <div style={{ marginTop: "16px", background: "#0f172a", padding: "16px", borderRadius: "8px", border: "1px solid #334155" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <h4 style={{ margin: 0, color: "#38bdf8", fontSize: "0.95rem" }}>
              📄 Tệp ASC CDL XML Dành Cho DaVinci Resolve Color Page
            </h4>
            <button
              onClick={() => {
                navigator.clipboard.writeText(harmonizationResult.davinciCdlManifestXml);
                onNotice?.("✓ Đã sao chép ASC CDL XML vào clipboard!");
              }}
              style={{
                background: "#1e293b",
                border: "1px solid #334155",
                color: "#38bdf8",
                padding: "4px 10px",
                borderRadius: "4px",
                fontSize: "0.75rem",
                cursor: "pointer",
              }}
            >
              📋 Sao chép XML
            </button>
          </div>
          <pre
            style={{
              background: "#020617",
              color: "#94a3b8",
              padding: "10px",
              borderRadius: "6px",
              fontSize: "0.7rem",
              maxHeight: "180px",
              overflowY: "auto",
              margin: 0,
            }}
          >
            {harmonizationResult.davinciCdlManifestXml}
          </pre>
        </div>
      )}
    </div>
  );
}
