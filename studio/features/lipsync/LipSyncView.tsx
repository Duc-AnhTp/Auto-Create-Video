import type {EmotionalVoiceSettings,VisemeAlignmentResult,LipSyncResult} from '../../../src/contracts/media-features.js';
import React, { useState, useEffect } from "react";

export interface LipSyncViewProps {
  seriesId: string;
  episodeNumber: number;
  api: <T = unknown>(path: string, body?: unknown) => Promise<T>;
  onNotice?: (msg: string) => void;
  onError?: (msg: string) => void;
}

export function LipSyncView({
  seriesId,
  episodeNumber,
  api,
  onNotice,
  onError,
}: LipSyncViewProps) {
  const [dialogueText, setDialogueText] = useState("Chúng ta phải chiến đấu đến cùng! Không được lùi bước!");
  const [actingInstruction, setActingInstruction] = useState("Hét lớn đầy phẫn nộ và quyết tâm");
  const [tensionScore, setTensionScore] = useState(0.85);
  const [characterName, setCharacterName] = useState("Minh");

  const [provider, setProvider] = useState<"wav2lip" | "liveportrait" | "sadtalker" | "synclabs" | "mock">("mock");
  const [featherRadius, setFeatherRadius] = useState(14);
  const [audioOffsetMs, setAudioOffsetMs] = useState(0);

  const [emotionSettings, setEmotionSettings] = useState<EmotionalVoiceSettings|null>(null);
  const [visemeResult, setVisemeResult] = useState<VisemeAlignmentResult|null>(null);
  const [lipSyncResult, setLipSyncResult] = useState<LipSyncResult|null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedVisemeFrame, setSelectedVisemeFrame] = useState(0);

  const loadEmotionAndVisemes = async () => {
    if (!seriesId) return;
    try {
      const emRes = await api<{success:boolean;settings:EmotionalVoiceSettings}>(
        `/api/v1/series/${seriesId}/episodes/${episodeNumber}/lip-sync/emotion?tension=${tensionScore}&actingInstruction=${encodeURIComponent(actingInstruction)}`,
        { text: dialogueText, characterName }
      );
      if (emRes.success && emRes.settings) {
        setEmotionSettings(emRes.settings);
      }

      const visRes = await api<{success:boolean;visemes:VisemeAlignmentResult}>(
        `/api/v1/series/${seriesId}/episodes/${episodeNumber}/lip-sync/visemes?durationSec=3.5&fps=24`,
        { text: dialogueText }
      );
      if (visRes.success && visRes.visemes) {
        setVisemeResult(visRes.visemes);
      }
    } catch {
      // Fallback
    }
  };

  useEffect(() => {
    void loadEmotionAndVisemes();
  }, [seriesId, episodeNumber, dialogueText, tensionScore, actingInstruction]);

  const handleRunLipSync = async () => {
    if (!seriesId) {
      onError?.("Vui lòng chọn dự án.");
      return;
    }

    setIsProcessing(true);
    try {
      const res = await api<{success:boolean;result:LipSyncResult}>(`/api/v1/series/${seriesId}/episodes/${episodeNumber}/lip-sync/process`, {
        shotId: "shot_hero_dialogue",
        dialogueText,
        actingInstruction,
        provider,
        audioOffsetMs,
      });

      if (res.success && res.result) {
        setLipSyncResult(res.result);
        onNotice?.(
          `👄 Khớp khẩu hình thành công! Độ lệch: ${res.result.avSyncOffsetMs}ms (Độ tin cậy: ${(res.result.syncConfidenceScore * 100).toFixed(1)}%)`
        );
      }
    } catch (err: unknown) {
      onError?.((err instanceof Error ? err.message : String(err)) || "Lỗi khi chạy khớp khẩu hình.");
    } finally {
      setIsProcessing(false);
    }
  };

  const applyPreset = (preset: { text: string; instruction: string; tension: number }) => {
    setDialogueText(preset.text);
    setActingInstruction(preset.instruction);
    setTensionScore(preset.tension);
  };

  const currentFrameData = visemeResult?.frames?.[selectedVisemeFrame] || visemeResult?.frames?.[0];

  return (
    <div className="lip-sync-container" style={{ padding: "16px", color: "#e2e8f0" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.3rem", color: "#ec4899" }}>
            👄 Diễn Xuất Cảm Xúc & Khớp Khẩu Hình (Neural Emotional Dialogue & Lip-Sync)
          </h2>
          <small style={{ color: "#94a3b8" }}>
            Series: <strong>{seriesId || "Chưa chọn"}</strong> · Tập <strong>{episodeNumber}</strong> · Đồng bộ chuẩn Viseme MPEG-4 & SSML Prosody
          </small>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <label style={{ fontSize: "0.85rem" }}>
            Động cơ Lip-Sync:{" "}
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as typeof provider)}
              style={{ background: "#0f172a", color: "#fff", border: "1px solid #334155", padding: "4px 8px", borderRadius: "4px" }}
            >
              <option value="mock">Mô Phỏng Nhanh (Mock AI)</option>
              <option value="wav2lip">Wav2Lip (Local ComfyUI / PyTorch)</option>
              <option value="liveportrait">LivePortrait (High Fidelity)</option>
              <option value="sadtalker">SadTalker (Expressive)</option>
              <option value="synclabs">SyncLabs (Cloud API)</option>
            </select>
          </label>

          <button
            onClick={handleRunLipSync}
            disabled={isProcessing || !seriesId}
            style={{
              background: isProcessing ? "#475569" : "linear-gradient(135deg, #ec4899, #8b5cf6)",
              color: "#fff",
              padding: "8px 18px",
              borderRadius: "6px",
              fontWeight: "bold",
              cursor: isProcessing ? "not-allowed" : "pointer",
              border: "none",
              boxShadow: "0 4px 12px rgba(236, 72, 153, 0.3)",
            }}
          >
            {isProcessing ? "⏳ Đang Khớp Khẩu Hình..." : "👄 Khớp Khẩu Hình Cú Máy"}
          </button>
        </div>
      </div>

      {/* Preset Buttons */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
        <button
          onClick={() =>
            applyPreset({
              text: "Suỵt... cẩn thận, chúng ta không được để chúng phát hiện.",
              instruction: "Thì thầm rất nhỏ, đầy hơi thở cảnh giác",
              tension: 0.4,
            })
          }
          style={{ background: "#1e293b", border: "1px solid #475569", color: "#94a3b8", padding: "4px 10px", borderRadius: "4px", fontSize: "0.8rem", cursor: "pointer" }}
        >
          🤫 Thì thầm (Whisper / Act 1)
        </button>

        <button
          onClick={() =>
            applyPreset({
              text: "Đừng lại gần! Không thể nào... tất cả đã bị phá hủy rồi sao?!",
              instruction: "Giọng run rẩy sợ hãi tột cùng, thở dốc",
              tension: 0.85,
            })
          }
          style={{ background: "#1e293b", border: "1px solid #475569", color: "#fbbf24", padding: "4px 10px", borderRadius: "4px", fontSize: "0.8rem", cursor: "pointer" }}
        >
          😱 Sợ hãi hoảng loạn (Terrified / Midpoint)
        </button>

        <button
          onClick={() =>
            applyPreset({
              text: "TẤT CẢ TẤN CÔNG! CHÚNG TA KHÔNG BAO GIỜ ĐẦU HÀNG!",
              instruction: "Hét vang uy lực gầm thét chiến đấu",
              tension: 1.0,
            })
          }
          style={{ background: "#1e293b", border: "1px solid #475569", color: "#f87171", padding: "4px 10px", borderRadius: "4px", fontSize: "0.8rem", cursor: "pointer" }}
        >
          🔥 Hét vang quyết liệt (Furious / Climax)
        </button>

        <button
          onClick={() =>
            applyPreset({
              text: "Ngươi tưởng có thể che giấu sự thật này mãi mãi sao?",
              instruction: "Giọng trầm, đanh thép, lạnh lùng đe dọa",
              tension: 0.7,
            })
          }
          style={{ background: "#1e293b", border: "1px solid #475569", color: "#38bdf8", padding: "4px 10px", borderRadius: "4px", fontSize: "0.8rem", cursor: "pointer" }}
        >
          ⚔️ Đối đầu đanh thép (Confrontation)
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "16px" }}>
        {/* ── 1. Emotional SSML Synthesizer Panel ── */}
        <div style={{ background: "#1e293b", padding: "16px", borderRadius: "8px", border: "1px solid #334155" }}>
          <h3 style={{ margin: "0 0 12px 0", fontSize: "1.1rem", color: "#ec4899" }}>
            🎭 Bộ Điều Khiển Cảm Xúc Giọng Nói (SSML & Acting)
          </h3>

          <div style={{ marginBottom: "12px" }}>
            <label style={{ display: "block", fontSize: "0.8rem", color: "#94a3b8", marginBottom: "4px" }}>
              Câu thoại diễn viên:
            </label>
            <textarea
              rows={2}
              value={dialogueText}
              onChange={(e) => setDialogueText(e.target.value)}
              style={{ width: "100%", background: "#0f172a", color: "#fff", border: "1px solid #334155", borderRadius: "6px", padding: "8px", fontSize: "0.9rem" }}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", color: "#94a3b8", marginBottom: "4px" }}>
                Chỉ dẫn diễn xuất (Acting Instruction):
              </label>
              <input
                type="text"
                value={actingInstruction}
                onChange={(e) => setActingInstruction(e.target.value)}
                style={{ width: "100%", background: "#0f172a", color: "#fff", border: "1px solid #334155", borderRadius: "4px", padding: "6px", fontSize: "0.85rem" }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.8rem", color: "#94a3b8", marginBottom: "4px" }}>
                Điểm kịch tính phân cảnh: <strong>{tensionScore.toFixed(2)} / 1.0</strong>
              </label>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={tensionScore}
                onChange={(e) => setTensionScore(parseFloat(e.target.value))}
                style={{ width: "100%" }}
              />
            </div>
          </div>

          {/* Generated SSML Code Block */}
          {emotionSettings && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <span style={{ fontSize: "0.8rem", color: "#c084fc", fontWeight: "bold" }}>
                  Mã SSML 1.1 Tạo Tự Động (Emotion: {emotionSettings.emotion}):
                </span>
                <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                  Tốc độ: {emotionSettings.rate}x · Cao độ: {emotionSettings.pitch}st · Volume: {emotionSettings.volumeDb}dB
                </span>
              </div>
              <pre
                style={{
                  background: "#0f172a",
                  color: "#38bdf8",
                  padding: "10px",
                  borderRadius: "6px",
                  border: "1px solid #334155",
                  fontSize: "0.75rem",
                  margin: 0,
                  overflowX: "auto",
                  whiteSpace: "pre-wrap",
                }}
              >
                {emotionSettings.ssmlText}
              </pre>

              {/* Neural TTS Hyper-parameters */}
              <div style={{ marginTop: "10px", display: "flex", gap: "8px", fontSize: "0.75rem", color: "#cbd5e1" }}>
                <div style={{ background: "#0f172a", padding: "6px 10px", borderRadius: "4px", border: "1px solid #334155" }}>
                  ElevenLabs Style: <strong>{emotionSettings.elevenLabsSettings?.style}</strong>
                </div>
                <div style={{ background: "#0f172a", padding: "6px 10px", borderRadius: "4px", border: "1px solid #334155" }}>
                  Độ ổn định (Stability): <strong>{emotionSettings.elevenLabsSettings?.stability}</strong>
                </div>
                <div style={{ background: "#0f172a", padding: "6px 10px", borderRadius: "4px", border: "1px solid #334155" }}>
                  Hơi thở: <strong>{emotionSettings.breathiness}</strong>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── 2. Viseme Sequence & Facial Blendshape Morph HUD ── */}
        <div style={{ background: "#1e293b", padding: "16px", borderRadius: "8px", border: "1px solid #334155" }}>
          <h3 style={{ margin: "0 0 12px 0", fontSize: "1.1rem", color: "#38bdf8" }}>
            👄 Dải Viseme MPEG-4 & Hình Dáng Môi (Facial Blendshapes)
          </h3>

          {/* Viseme Keyframe Timeline */}
          {visemeResult && (
            <div>
              <div style={{ fontSize: "0.8rem", color: "#94a3b8", marginBottom: "6px" }}>
                Trình tự khẩu hình thời gian ({visemeResult.keyframes.length} keyframes · {visemeResult.fps} fps):
              </div>

              {/* Visual Viseme Strip */}
              <div
                style={{
                  display: "flex",
                  gap: "2px",
                  background: "#0f172a",
                  padding: "6px",
                  borderRadius: "6px",
                  border: "1px solid #334155",
                  overflowX: "auto",
                  marginBottom: "14px",
                }}
              >
                {visemeResult.keyframes.map((kf, idx) => {
                  const isVowel = ["aa", "E", "I", "O", "U"].includes(kf.viseme);
                  const isPlosive = ["PP", "FF"].includes(kf.viseme);
                  const bg = isVowel ? "#7c3aed" : isPlosive ? "#059669" : "#1e40af";

                  return (
                    <div
                      key={idx}
                      title={`Viseme: ${kf.viseme} (${kf.startSec.toFixed(2)}s - ${kf.endSec.toFixed(2)}s)`}
                      style={{
                        padding: "6px 8px",
                        background: bg,
                        color: "#fff",
                        borderRadius: "4px",
                        fontSize: "0.75rem",
                        fontWeight: "bold",
                        textAlign: "center",
                        minWidth: "32px",
                        cursor: "default",
                      }}
                    >
                      {kf.viseme}
                    </div>
                  );
                })}
              </div>

              {/* Frame Slider & Morph Target Gauges */}
              <div style={{ marginBottom: "10px" }}>
                <label style={{ display: "block", fontSize: "0.8rem", color: "#94a3b8", marginBottom: "4px" }}>
                  Khung hình chi tiết: <strong>Frame {selectedVisemeFrame} / {visemeResult.totalFrames}</strong> (Thời điểm: {(selectedVisemeFrame / visemeResult.fps).toFixed(2)}s)
                </label>
                <input
                  type="range"
                  min="0"
                  max={Math.max(0, visemeResult.totalFrames - 1)}
                  value={selectedVisemeFrame}
                  onChange={(e) => setSelectedVisemeFrame(parseInt(e.target.value, 10))}
                  style={{ width: "100%" }}
                />
              </div>

              {/* Blendshape Morph Meters */}
              {currentFrameData && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", background: "#0f172a", padding: "12px", borderRadius: "6px", border: "1px solid #334155" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.8rem" }}>
                    <span>Khẩu hình hiện tại (Viseme):</span>
                    <strong style={{ color: "#ec4899", fontSize: "1rem" }}>{currentFrameData.primaryViseme}</strong>
                  </div>

                  {/* Morph Bars */}
                  {([
                    ["Độ mở hàm (Jaw Open)", currentFrameData.jawOpen, "#38bdf8"],
                    ["Mím / Đóng môi (Mouth Close)", currentFrameData.mouthClose, "#f59e0b"],
                    ["Chu môi (Mouth Pucker)", currentFrameData.mouthPucker, "#ec4899"],
                    ["Cười giãn mép (Mouth Smile)", currentFrameData.mouthSmile, "#4ade80"],
                    ["Phễu âm (Mouth Funnel)", currentFrameData.mouthFunnel, "#a855f7"],
                  ] as const).map(([label, val, col]) => (
                    <div key={label} style={{ fontSize: "0.75rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                        <span style={{ color: "#94a3b8" }}>{label}</span>
                        <span>{(val * 100).toFixed(0)}%</span>
                      </div>
                      <div style={{ width: "100%", height: "6px", background: "#334155", borderRadius: "3px", overflow: "hidden" }}>
                        <div style={{ width: `${Math.round(val * 100)}%`, height: "100%", background: col, transition: "width 0.1s" }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── 3. Lip-Sync Execution Artifacts & A/V Sync Quality HUD ── */}
      {lipSyncResult && (
        <div style={{ marginTop: "16px", background: "#0f172a", padding: "14px", borderRadius: "8px", border: "1px solid #059669" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <h4 style={{ margin: 0, color: "#4ade80", fontSize: "0.95rem" }}>
              ✓ Kết Quả Khớp Khẩu Hình Cú Máy (A/V Synchronization QC)
            </h4>
            <span style={{ fontSize: "0.75rem", padding: "2px 8px", background: "#059669", borderRadius: "4px", color: "#fff", fontWeight: "bold" }}>
              ĐÃ KHỚP HOÀN HẢO
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", fontSize: "0.8rem", color: "#cbd5e1" }}>
            <div>
              • Độ lệch thời gian A/V:{" "}
              <strong style={{ color: Math.abs(lipSyncResult.avSyncOffsetMs) <= 40 ? "#4ade80" : "#f87171" }}>
                {lipSyncResult.avSyncOffsetMs} ms
              </strong>{" "}
              <small style={{ color: "#94a3b8" }}>(Chuẩn phát sóng: ±40ms)</small>
            </div>
            <div>
              • Điểm tin cậy đồng bộ (Sync Score):{" "}
              <strong style={{ color: "#38bdf8" }}>{(lipSyncResult.syncConfidenceScore * 100).toFixed(1)}%</strong>
            </div>
            <div>
              • Vùng khuôn mặt xử lý (ROI):{" "}
              <span>{lipSyncResult.mouthRoi.width * 100}% × {lipSyncResult.mouthRoi.height * 100}% (Làm mờ biên: {lipSyncResult.mouthRoi.featherRadiusPx}px)</span>
            </div>
          </div>

          <div style={{ marginTop: "6px", fontSize: "0.75rem", color: "#94a3b8" }}>
            Tệp video sau khớp: <code>{lipSyncResult.outputVideoPath}</code>
          </div>
        </div>
      )}
    </div>
  );
}
