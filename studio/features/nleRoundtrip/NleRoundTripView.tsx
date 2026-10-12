import type {ConformedTimelineResult} from '../../../src/contracts/media-features.js';
type NleExportResponse={success:boolean;xmlContent:string;edlContent:string;exportResult:{fcp7XmlPath:string;cmx3600EdlPath:string;otioJsonPath:string}};
type NleConformResponse=ConformedTimelineResult&{success:boolean};
import React, { useState, useEffect } from "react";

export interface NleRoundTripViewProps {
  seriesId: string;
  episodeNumber: number;
  api: <T = unknown>(path: string, body?: unknown) => Promise<T>;
  onNotice?: (msg: string) => void;
  onError?: (msg: string) => void;
}

export function NleRoundTripView({
  seriesId,
  episodeNumber,
  api,
  onNotice,
  onError,
}: NleRoundTripViewProps) {
  const [exportData, setExportData] = useState<NleExportResponse|null>(null);
  const [activePreviewFormat, setActivePreviewFormat] = useState<"xml" | "edl">("xml");
  const [importXmlText, setImportXmlText] = useState("");
  const [conformResult, setConformResult] = useState<NleConformResponse|null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isConforming, setIsConforming] = useState(false);

  const loadExport = async () => {
    if (!seriesId) return;
    setIsExporting(true);
    try {
      const res = await api<NleExportResponse>(`/api/v1/series/${seriesId}/episodes/${episodeNumber}/nle/export`);
      if (res.success) {
        setExportData(res);
        if (!importXmlText && res.xmlContent) {
          // Pre-populate with current XML so user can easily simulate an edit
          setImportXmlText(res.xmlContent);
        }
      }
    } catch (err: unknown) {
      onError?.((err instanceof Error ? err.message : String(err)) || "Lỗi khi xuất timeline NLE.");
    } finally {
      setIsExporting(false);
    }
  };

  useEffect(() => {
    void loadExport();
  }, [seriesId, episodeNumber]);

  const handleConform = async (apply = false) => {
    if (!importXmlText.trim()) {
      onError?.("Vui lòng dán hoặc tải nội dung XML từ DaVinci Resolve / Premiere.");
      return;
    }

    setIsConforming(true);
    try {
      const res = await api<NleConformResponse>(`/api/v1/series/${seriesId}/episodes/${episodeNumber}/nle/conform`, {
        xmlContent: importXmlText,
        apply,
      });

      if (res.success) {
        setConformResult(res);
        if (apply) {
          onNotice?.("✓ Đã áp dụng thành công các thay đổi từ DaVinci vào Master Timeline!");
        } else {
          onNotice?.(
            `Phát hiện: ${res.diffReport?.trimmedShots?.length || 0} cú máy cắt gọt, ${res.diffReport?.swappedTakes?.length || 0} take thay thế.`
          );
        }
      }
    } catch (err: unknown) {
      onError?.((err instanceof Error ? err.message : String(err)) || "Lỗi khi so khớp timeline NLE.");
    } finally {
      setIsConforming(false);
    }
  };

  return (
    <div className="nle-roundtrip-container" style={{ padding: "16px", color: "#e2e8f0" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.3rem", color: "#38bdf8" }}>
            🔄 Đồng Bộ 2 Chiều NLE (DaVinci Resolve & Premiere Pro Two-Way Round-Trip)
          </h2>
          <small style={{ color: "#94a3b8" }}>
            Series: <strong>{seriesId || "Chưa chọn"}</strong> · Tập <strong>{episodeNumber}</strong> · Chuẩn FCP7 XML, CMX 3600 EDL & OpenTimelineIO
          </small>
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
          <button
            onClick={() => void loadExport()}
            disabled={isExporting || !seriesId}
            style={{
              background: "#1e293b",
              border: "1px solid #334155",
              color: "#38bdf8",
              padding: "6px 14px",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            {isExporting ? "Đang xuất..." : "🔄 Làm mới Xuất"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        {/* ── 1. NLE Project Export Panel ── */}
        <div style={{ background: "#1e293b", padding: "16px", borderRadius: "8px", border: "1px solid #334155" }}>
          <h3 style={{ margin: "0 0 12px 0", fontSize: "1.1rem", color: "#4ade80" }}>
            📤 1. Xuất Dự Án Sang DaVinci Resolve / Premiere Pro
          </h3>

          <p style={{ margin: "0 0 12px 0", fontSize: "0.85rem", color: "#94a3b8" }}>
            Bao gồm 4 Track Audio tách biệt (A1 Thoại, A2 Foley, A3 SFX, A4 BGM), siêu dữ liệu chỉnh màu ASC CDL, và Marker ghi chú kịch bản.
          </p>

          {/* Format Tabs */}
          <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
            <button
              onClick={() => setActivePreviewFormat("xml")}
              style={{
                background: activePreviewFormat === "xml" ? "#0284c7" : "#0f172a",
                color: "#fff",
                border: "1px solid #334155",
                padding: "4px 12px",
                borderRadius: "4px",
                fontSize: "0.8rem",
                cursor: "pointer",
              }}
            >
              FCP7 XML (DaVinci/Premiere)
            </button>
            <button
              onClick={() => setActivePreviewFormat("edl")}
              style={{
                background: activePreviewFormat === "edl" ? "#0284c7" : "#0f172a",
                color: "#fff",
                border: "1px solid #334155",
                padding: "4px 12px",
                borderRadius: "4px",
                fontSize: "0.8rem",
                cursor: "pointer",
              }}
            >
              CMX 3600 EDL (Color Conform)
            </button>
          </div>

          {/* Export Code Preview */}
          <pre
            style={{
              background: "#0f172a",
              color: "#38bdf8",
              padding: "12px",
              borderRadius: "6px",
              border: "1px solid #334155",
              fontSize: "0.75rem",
              height: "240px",
              overflowY: "auto",
              margin: 0,
              whiteSpace: "pre-wrap",
            }}
          >
            {activePreviewFormat === "xml"
              ? exportData?.xmlContent || "Đang tải FCP7 XML..."
              : exportData?.edlContent || "Đang tải CMX 3600 EDL..."}
          </pre>

          {/* File Paths */}
          {exportData?.exportResult && (
            <div style={{ marginTop: "12px", fontSize: "0.75rem", color: "#94a3b8" }}>
              <div>• FCP7 XML: <code>{exportData.exportResult.fcp7XmlPath}</code></div>
              <div>• CMX EDL: <code>{exportData.exportResult.cmx3600EdlPath}</code></div>
              <div>• OTIO JSON: <code>{exportData.exportResult.otioJsonPath}</code></div>
            </div>
          )}
        </div>

        {/* ── 2. NLE Ingest & Conformance Panel ── */}
        <div style={{ background: "#1e293b", padding: "16px", borderRadius: "8px", border: "1px solid #334155" }}>
          <h3 style={{ margin: "0 0 12px 0", fontSize: "1.1rem", color: "#f59e0b" }}>
            📥 2. Nhận Bản Dựng Từ DaVinci & So Khớp (Conform)
          </h3>

          <p style={{ margin: "0 0 12px 0", fontSize: "0.85rem", color: "#94a3b8" }}>
            Dán nội dung tệp XML đã chỉnh sửa từ DaVinci Resolve / Premiere để tự động đồng bộ lại cắt gọt và đổi take.
          </p>

          <textarea
            rows={10}
            value={importXmlText}
            onChange={(e) => setImportXmlText(e.target.value)}
            placeholder="Dán nội dung tệp XML từ DaVinci Resolve vào đây..."
            style={{
              width: "100%",
              background: "#0f172a",
              color: "#fff",
              border: "1px solid #334155",
              borderRadius: "6px",
              padding: "10px",
              fontSize: "0.75rem",
              fontFamily: "monospace",
              height: "240px",
            }}
          />

          <div style={{ display: "flex", gap: "10px", marginTop: "12px" }}>
            <button
              onClick={() => void handleConform(false)}
              disabled={isConforming}
              style={{
                flex: 1,
                background: "#0f172a",
                border: "1px solid #f59e0b",
                color: "#fbbf24",
                padding: "8px",
                borderRadius: "6px",
                fontWeight: "bold",
                cursor: "pointer",
              }}
            >
              {isConforming ? "Đang so khớp..." : "🔍 So Khớp & Xem Thay Đổi"}
            </button>

            <button
              onClick={() => void handleConform(true)}
              disabled={isConforming}
              style={{
                flex: 1,
                background: "linear-gradient(135deg, #059669, #0284c7)",
                border: "none",
                color: "#fff",
                padding: "8px",
                borderRadius: "6px",
                fontWeight: "bold",
                cursor: "pointer",
                boxShadow: "0 4px 12px rgba(5, 150, 105, 0.3)",
              }}
            >
              ✅ Áp Dụng Lên Master Timeline
            </button>
          </div>
        </div>
      </div>

      {/* ── 3. Diffs & Audio Re-Alignment Inspection Report ── */}
      {conformResult?.diffReport && (
        <div style={{ marginTop: "16px", background: "#0f172a", padding: "16px", borderRadius: "8px", border: "1px solid #334155" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <h4 style={{ margin: 0, color: "#38bdf8", fontSize: "1rem" }}>
              📊 Báo Cáo So Khớp Biến Động NLE (Round-Trip Diff Report)
            </h4>
            <div style={{ display: "flex", gap: "8px" }}>
              <span style={{ fontSize: "0.75rem", padding: "3px 8px", background: "#1e3a8a", borderRadius: "4px", color: "#60a5fa" }}>
                Tái căn chỉnh thoại: {conformResult.realignedDialogueCount} cue
              </span>
              <span style={{ fontSize: "0.75rem", padding: "3px 8px", background: "#065f46", borderRadius: "4px", color: "#34d399" }}>
                Tái căn chỉnh SFX: {conformResult.realignedSfxCount} cue
              </span>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", fontSize: "0.8rem" }}>
            {/* Trimmed Shots */}
            <div style={{ background: "#1e293b", padding: "10px", borderRadius: "6px", border: "1px solid #334155" }}>
              <strong style={{ color: "#fbbf24" }}>
                Cắt gọt thời lượng ({conformResult.diffReport.trimmedShots?.length || 0} cú máy):
              </strong>
              {conformResult.diffReport.trimmedShots?.length > 0 ? (
                <ul style={{ margin: "6px 0", paddingLeft: "18px", color: "#cbd5e1" }}>
                  {conformResult.diffReport.trimmedShots.map((t) => (
                    <li key={t.shotId}>
                      <code>{t.shotId}</code>: {t.originalDurationSec}s ➔ {t.editedDurationSec}s{" "}
                      <strong style={{ color: t.deltaSec < 0 ? "#f87171" : "#4ade80" }}>
                        ({t.deltaSec > 0 ? `+${t.deltaSec}` : t.deltaSec}s)
                      </strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ margin: "6px 0", color: "#94a3b8" }}>Không có cú máy nào bị cắt gọt.</p>
              )}
            </div>

            {/* Swapped Takes */}
            <div style={{ background: "#1e293b", padding: "10px", borderRadius: "6px", border: "1px solid #334155" }}>
              <strong style={{ color: "#a855f7" }}>
                Thay đổi Take ({conformResult.diffReport.swappedTakes?.length || 0} cú máy):
              </strong>
              {conformResult.diffReport.swappedTakes?.length > 0 ? (
                <ul style={{ margin: "6px 0", paddingLeft: "18px", color: "#cbd5e1" }}>
                  {conformResult.diffReport.swappedTakes.map((s) => (
                    <li key={s.shotId}>
                      <code>{s.shotId}</code>: Chuyển sang Take #{s.newTakeNumber}
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ margin: "6px 0", color: "#94a3b8" }}>Giữ nguyên các Take đã chọn.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
