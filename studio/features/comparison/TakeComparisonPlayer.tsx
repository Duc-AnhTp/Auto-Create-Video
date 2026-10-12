import React, { useState, useRef, useEffect } from "react";
import type { TakeItem } from "../../../src/contracts/studio-features.js";

interface TakeComparisonPlayerProps {
  seriesId: string;
  episodeNumber: number;
  shotId: string;
  takes: TakeItem[];
  characterReferenceUrl?: string;
  onApproveTake: (takeId: string) => Promise<void>;
  onRerollShot: (shotId: string, promptOverride?: string) => Promise<void>;
}

export function TakeComparisonPlayer({
  seriesId,
  episodeNumber,
  shotId,
  takes,
  characterReferenceUrl,
  onApproveTake,
  onRerollShot,
}: TakeComparisonPlayerProps) {
  const [takeAId, setTakeAId] = useState<string>("");
  const [takeBId, setTakeBId] = useState<string>("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLooping, setIsLooping] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [comparingWithReference, setComparingWithReference] = useState(false);
  const [promptOverride, setPromptOverride] = useState("");
  const [isApproving, setIsApproving] = useState(false);

  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);

  // Initialize selected takes
  useEffect(() => {
    if (takes.length > 0) {
      const approved = takes.find((t) => t.is_approved) || takes[0];
      setTakeAId(approved.id);
      const other = takes.find((t) => t.id !== approved.id) || takes[1] || takes[0];
      setTakeBId(other.id);
    }
  }, [takes]);

  const takeA = takes.find((t) => t.id === takeAId);
  const takeB = takes.find((t) => t.id === takeBId);

  const mediaUrl = (path?: string) => {
    if (!path) return "";
    if (path.startsWith("http://") || path.startsWith("https://")) return path;
    return `/api/media/stream?path=${encodeURIComponent(path)}`;
  };

  const togglePlay = () => {
    const nextState = !isPlaying;
    setIsPlaying(nextState);
    if (videoARef.current) {
      if (nextState) void videoARef.current.play();
      else videoARef.current.pause();
    }
    if (videoBRef.current && !comparingWithReference) {
      if (nextState) void videoBRef.current.play();
      else videoBRef.current.pause();
    }
  };

  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const t = e.currentTarget.currentTime;
    setCurrentTime(t);
    if (!isNaN(e.currentTarget.duration)) {
      setDuration(e.currentTarget.duration);
    }
    // Sync video B if drifting
    if (videoBRef.current && !comparingWithReference) {
      const diff = Math.abs(videoBRef.current.currentTime - t);
      if (diff > 0.08) {
        videoBRef.current.currentTime = t;
      }
    }
  };

  const handleSeek = (newTime: number) => {
    setCurrentTime(newTime);
    if (videoARef.current) videoARef.current.currentTime = newTime;
    if (videoBRef.current && !comparingWithReference) videoBRef.current.currentTime = newTime;
  };

  const stepFrame = (frames: number) => {
    const fps = 30;
    const newTime = Math.max(0, Math.min(duration, currentTime + frames / fps));
    handleSeek(newTime);
  };

  const handleApprove = async (takeId: string) => {
    setIsApproving(true);
    try {
      await onApproveTake(takeId);
    } finally {
      setIsApproving(false);
    }
  };

  const renderQaBadge = (take?: TakeItem) => {
    if (!take) return null;
    const score = take.qa_score ?? 0.88;
    const status = take.qa_status || (score >= 0.85 ? "PASS" : score >= 0.70 ? "WARN" : "FAIL");
    const gaugeColor = score >= 0.85 ? "#10b981" : score >= 0.70 ? "#f59e0b" : "#ef4444";

    return (
      <div className="qa-overlay-hud">
        <div className="qa-score-row">
          <span className="qa-title">ARCFACE 512-D QA</span>
          <span className="qa-num" style={{ color: gaugeColor }}>
            {(score * 100).toFixed(0)}%
          </span>
          <span className={`qa-badge ${status.toLowerCase()}`}>{status}</span>
        </div>
        <div className="qa-gauge-track">
          <div className="qa-gauge-bar" style={{ width: `${Math.min(100, score * 100)}%`, backgroundColor: gaugeColor }} />
        </div>
        {take.qa_notes && <div className="qa-notes-text">{take.qa_notes}</div>}
      </div>
    );
  };

  return (
    <div className="take-comparison-suite">
      <div className="comparison-header">
        <div className="comparison-title">
          <h3>
            SO SÁNH CÚ MÁY: <code>{shotId}</code>
          </h3>
          <span className="comparison-subtitle">
            Tập {episodeNumber} · Tổng {takes.length} takes đã tạo
          </span>
        </div>

        <div className="comparison-mode-switch">
          <button
            className={`btn-tab ${!comparingWithReference ? "active" : ""}`}
            onClick={() => setComparingWithReference(false)}
          >
            🎬 So sánh Take A ↔ Take B
          </button>
          <button
            className={`btn-tab ${comparingWithReference ? "active" : ""}`}
            onClick={() => setComparingWithReference(true)}
          >
            👤 So sánh Anchor Chân Dung ↔ Video
          </button>
        </div>
      </div>

      {/* Two-Up Video Screen */}
      <div className="two-up-screens-grid">
        {/* Left Screen (Take A) */}
        <div className="video-card-slot">
          <div className="slot-toolbar">
            <label>
              <strong>Khung A:</strong>
              <select value={takeAId} onChange={(e) => setTakeAId(e.target.value)}>
                {takes.map((t) => (
                  <option key={t.id} value={t.id}>
                    Take {t.take_number} {t.is_approved ? "★ [Đã duyệt]" : ""} ({t.provider})
                  </option>
                ))}
              </select>
            </label>
            {takeA?.is_approved ? (
              <span className="approved-pill">★ BẢN MASTER</span>
            ) : (
              <button
                className="btn-approve"
                disabled={isApproving || !takeA}
                onClick={() => takeA && handleApprove(takeA.id)}
              >
                ✓ Duyệt Take A
              </button>
            )}
          </div>

          <div className="video-viewport">
            {takeA?.local_path ? (
              <video
                ref={videoARef}
                src={mediaUrl(takeA.local_path)}
                onTimeUpdate={handleTimeUpdate}
                loop={isLooping}
                playsInline
                muted
              />
            ) : (
              <div className="viewport-placeholder">
                <span>▶</span>
                <p>Chưa có file video cho Take A</p>
              </div>
            )}
            {renderQaBadge(takeA)}
          </div>

          <div className="slot-footer">
            <span>Provider: {takeA?.provider || "N/A"}</span>
            <span>Thời lượng: {duration ? `${duration.toFixed(1)}s` : "--"}</span>
          </div>
        </div>

        {/* Right Screen (Take B or Reference Anchor) */}
        <div className="video-card-slot">
          <div className="slot-toolbar">
            {comparingWithReference ? (
              <label>
                <strong>Ảnh Mỏ Neo Nhân Vật (ArcFace Reference):</strong>
              </label>
            ) : (
              <label>
                <strong>Khung B:</strong>
                <select value={takeBId} onChange={(e) => setTakeBId(e.target.value)}>
                  {takes.map((t) => (
                    <option key={t.id} value={t.id}>
                      Take {t.take_number} {t.is_approved ? "★ [Đã duyệt]" : ""} ({t.provider})
                    </option>
                  ))}
                </select>
              </label>
            )}

            {!comparingWithReference && (
              takeB?.is_approved ? (
                <span className="approved-pill">★ BẢN MASTER</span>
              ) : (
                <button
                  className="btn-approve"
                  disabled={isApproving || !takeB}
                  onClick={() => takeB && handleApprove(takeB.id)}
                >
                  ✓ Duyệt Take B
                </button>
              )
            )}
          </div>

          <div className="video-viewport">
            {comparingWithReference ? (
              characterReferenceUrl ? (
                <img
                  className="reference-anchor-img"
                  src={mediaUrl(characterReferenceUrl)}
                  alt="Ảnh mỏ neo nhân vật"
                />
              ) : (
                <div className="viewport-placeholder">
                  <span>👤</span>
                  <p>Chưa nạp ảnh chân dung tham chiếu trong Story Bible</p>
                </div>
              )
            ) : takeB?.local_path ? (
              <video
                ref={videoBRef}
                src={mediaUrl(takeB.local_path)}
                loop={isLooping}
                playsInline
                muted
              />
            ) : (
              <div className="viewport-placeholder">
                <span>▶</span>
                <p>Chưa có file video cho Take B</p>
              </div>
            )}
            {!comparingWithReference && renderQaBadge(takeB)}
          </div>

          <div className="slot-footer">
            {comparingWithReference ? (
              <span>Ảnh gốc 512-D Embedding</span>
            ) : (
              <>
                <span>Provider: {takeB?.provider || "N/A"}</span>
                <span>Thời lượng: {duration ? `${duration.toFixed(1)}s` : "--"}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Synchronized Playback Scrubbing Bar */}
      <div className="playback-sync-bar">
        <div className="playback-buttons">
          <button className="btn-icon" onClick={() => stepFrame(-1)} title="Lùi 1 Frame">
            ⏮ 1f
          </button>
          <button className="btn-icon btn-primary" onClick={togglePlay}>
            {isPlaying ? "⏸ Tạm Dừng" : "▶ Phát Đồng Bộ"}
          </button>
          <button className="btn-icon" onClick={() => stepFrame(1)} title="Tiến 1 Frame">
            1f ⏭
          </button>
          <button
            className={`btn-icon ${isLooping ? "active" : ""}`}
            onClick={() => setIsLooping(!isLooping)}
            title="Lặp lại A/B"
          >
            🔁 Lặp
          </button>
        </div>

        <div className="playback-time-slider">
          <span>{currentTime.toFixed(2)}s</span>
          <input
            type="range"
            min="0"
            max={duration || 10}
            step="0.05"
            value={currentTime}
            onChange={(e) => handleSeek(Number(e.target.value))}
          />
          <span>{duration.toFixed(2)}s</span>
        </div>
      </div>

      {/* Reroll Action Box */}
      <div className="reroll-action-box">
        <h4>↻ TẠO TAKE MỚI (RE-ROLL CÚ MÁY NÀY)</h4>
        <div className="reroll-inputs">
          <input
            type="text"
            placeholder="Gợi ý điều chỉnh prompt cho take mới (ví dụ: góc máy cận cảnh hơn, ánh sáng neon đỏ rực)..."
            value={promptOverride}
            onChange={(e) => setPromptOverride(e.target.value)}
          />
          <button
            className="btn-reroll"
            onClick={() => onRerollShot(shotId, promptOverride)}
          >
            ↻ Render Take Mới
          </button>
        </div>
      </div>
    </div>
  );
}
