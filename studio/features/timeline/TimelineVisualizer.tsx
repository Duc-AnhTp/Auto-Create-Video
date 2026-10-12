import React, { useState, useRef } from "react";
import type { UnifiedTimeline } from "../../../src/contracts/studio-features.js";

interface TimelineVisualizerProps {
  timeline: UnifiedTimeline | null;
  currentTime: number;
  onSeek: (timeSec: number) => void;
  selectedShotId: string;
  onSelectShot: (shotId: string) => void;
  onEditShot: (shotId: string, change: Record<string, unknown>, direction?: number) => void;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
}

export function TimelineVisualizer({
  timeline,
  currentTime,
  onSeek,
  selectedShotId,
  onSelectShot,
  onEditShot,
  videoRef,
}: TimelineVisualizerProps) {
  const [zoom, setZoom] = useState(18); // pixels per second
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [mutedTracks, setMutedTracks] = useState<Record<string, boolean>>({});
  const [soloTracks, setSoloTracks] = useState<Record<string, boolean>>({});
  const containerRef = useRef<HTMLDivElement>(null);

  const totalDuration = timeline?.targetTotalDurationSec || 60;
  const totalWidth = Math.max(1200, Math.ceil(totalDuration * zoom + 200));

  const formatTimecode = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = Math.floor(sec % 60);
    const frames = Math.floor((sec % 1) * (timeline?.fps || 30));
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const scrollLeft = containerRef.current.scrollLeft;
    const offsetX = e.clientX - rect.left + scrollLeft - 130; // 130px header offset
    const targetSec = Math.max(0, Math.min(totalDuration, offsetX / zoom));
    onSeek(targetSec);
    setIsScrubbing(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isScrubbing || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const scrollLeft = containerRef.current.scrollLeft;
    const offsetX = e.clientX - rect.left + scrollLeft - 130;
    const targetSec = Math.max(0, Math.min(totalDuration, offsetX / zoom));
    onSeek(targetSec);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isScrubbing) {
      setIsScrubbing(false);
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  const toggleMute = (trackName: string) => {
    setMutedTracks((prev) => ({ ...prev, [trackName]: !prev[trackName] }));
  };

  const toggleSolo = (trackName: string) => {
    setSoloTracks((prev) => ({ ...prev, [trackName]: !prev[trackName] }));
  };

  const selectedShot = timeline?.videoTrack.find((s) => s.shotId === selectedShotId);

  // Time ruler tick generator
  const renderRulerTicks = () => {
    const ticks = [];
    const stepSec = zoom >= 30 ? 1 : zoom >= 15 ? 2 : 5;
    for (let sec = 0; sec <= totalDuration; sec += stepSec) {
      const left = sec * zoom;
      ticks.push(
        <div key={sec} className="ruler-tick" style={{ left: `${left}px` }}>
          <span className="tick-label">{formatTimecode(sec)}</span>
        </div>
      );
    }
    return ticks;
  };

  const tracks: Array<{ name: string; type: string; color: string; cues: Array<{startSec?:number;durationSec?:number;endSec?:number;shotId?:string;visualPrompt?:string;subtitleText?:string;name?:string}> }> = timeline
    ? [
        { name: "Video", type: "video", color: "#344e72", cues: timeline.videoTrack || [] },
        { name: "Thoại (Dialogue)", type: "dialogue", color: "#2d634f", cues: timeline.dialogueTrack || [] },
        { name: "SFX / Foley", type: "sfx", color: "#614483", cues: timeline.sfxTrack || [] },
        { name: "Môi trường (Amb)", type: "ambience", color: "#3b5879", cues: timeline.ambienceTrack || [] },
        { name: "Nhạc nền (BGM)", type: "bgm", color: "#744b36", cues: timeline.bgmTrack ? [timeline.bgmTrack] : [] },
        { name: "Phụ đề (Sub)", type: "subtitle", color: "#665a36", cues: timeline.subtitleTrack || [] },
      ]
    : [];

  return (
    <div className="nle-timeline-root">
      {/* NLE Toolbar */}
      <div className="nle-timeline-toolbar">
        <div className="nle-tc-display">
          <span className="tc-label">PLAYHEAD</span>
          <span className="tc-digits">{formatTimecode(currentTime)}</span>
          <span className="tc-fps">{timeline?.fps || 30} FPS</span>
        </div>

        <div className="nle-controls-cluster">
          <button
            className="btn-icon"
            title="Về đầu timeline"
            onClick={() => onSeek(0)}
          >
            ⏮
          </button>
          <button
            className="btn-icon"
            title="Lùi 1s"
            onClick={() => onSeek(Math.max(0, currentTime - 1))}
          >
            ⏪
          </button>
          <button
            className="btn-icon btn-primary"
            title={videoRef?.current?.paused ? "Phát" : "Tạm dừng"}
            onClick={() => {
              if (videoRef?.current) {
                if (videoRef.current.paused) void videoRef.current.play();
                else videoRef.current.pause();
              }
            }}
          >
            ⏯
          </button>
          <button
            className="btn-icon"
            title="Tiến 1s"
            onClick={() => onSeek(Math.min(totalDuration, currentTime + 1))}
          >
            ⏩
          </button>
          <button
            className="btn-icon"
            title="Tới cuối"
            onClick={() => onSeek(totalDuration)}
          >
            ⏭
          </button>
        </div>

        <div className="nle-zoom-control">
          <span>🔍 Thu phóng:</span>
          <input
            type="range"
            min="8"
            max="60"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            title={`Thu phóng: ${zoom}px/giây`}
          />
          <span className="zoom-val">{zoom}px/s</span>
        </div>

        <div className="nle-timeline-meta">
          <span>{timeline ? `${timeline.videoTrack.length} shots · ${timeline.targetTotalDurationSec.toFixed(1)}s` : "Chưa có dữ liệu"}</span>
        </div>
      </div>

      {/* Main Track Scrolling Area */}
      <div
        className="nle-tracks-viewport"
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div className="nle-timeline-canvas" style={{ width: `${totalWidth}px` }}>
          {/* Time Ruler */}
          <div className="nle-ruler-row">
            <div className="track-header-spacer">THỜI GIAN</div>
            <div className="nle-ruler-track">{renderRulerTicks()}</div>
          </div>

          {/* Interactive Playhead Line */}
          <div
            className="nle-playhead-line"
            style={{ left: `${130 + currentTime * zoom}px` }}
          >
            <div className="nle-playhead-head">▼</div>
          </div>

          {/* Render Tracks */}
          {tracks.map((track) => {
            const isMuted = mutedTracks[track.name];
            const isSolo = soloTracks[track.name];
            return (
              <div
                className={`nle-track-row ${isMuted ? "muted-track" : ""} ${isSolo ? "solo-track" : ""}`}
                key={track.name}
              >
                <div className="nle-track-header">
                  <span className="track-title">{track.name}</span>
                  <div className="track-btns">
                    <button
                      className={`btn-m ${isMuted ? "active" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleMute(track.name);
                      }}
                      title="Mute track"
                    >
                      M
                    </button>
                    <button
                      className={`btn-s ${isSolo ? "active" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSolo(track.name);
                      }}
                      title="Solo track"
                    >
                      S
                    </button>
                  </div>
                </div>

                <div className="nle-track-lane">
                  {track.cues.map((cue, idx) => {
                    const start = cue.startSec || 0;
                    const duration = cue.durationSec || (cue.endSec ? cue.endSec - start : 2.5);
                    const width = Math.max(28, duration * zoom);
                    const left = start * zoom;
                    const isSelected = cue.shotId === selectedShotId;

                    return (
                      <div
                        key={cue.shotId || idx}
                        className={`nle-clip ${isSelected ? "selected" : ""}`}
                        style={{
                          left: `${left}px`,
                          width: `${width}px`,
                          backgroundColor: track.color,
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (cue.shotId) {
                            onSelectShot(cue.shotId);
                            onSeek(start);
                          }
                        }}
                        title={`${cue.shotId || track.name}: ${cue.visualPrompt || cue.subtitleText || cue.name || ""} (${duration.toFixed(1)}s)`}
                      >
                        <span className="clip-name">{cue.shotId || cue.name || track.name}</span>
                        <span className="clip-dur">{duration.toFixed(1)}s</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected Clip Inspector Bar */}
      {selectedShot && (
        <div className="nle-clip-inspector">
          <div className="inspector-field">
            <strong>Cú máy đã chọn:</strong> <code>{selectedShot.shotId}</code>
          </div>
          <div className="inspector-field prompt-preview">
            <span>{selectedShot.visualPrompt}</span>
          </div>
          <div className="inspector-actions">
            <label>
              Thời lượng:
              <input
                type="number"
                step="0.1"
                min="0.5"
                max="30"
                defaultValue={selectedShot.durationSec}
                onBlur={(e) => {
                  const val = Number(e.target.value);
                  if (val !== selectedShot.durationSec && val > 0) {
                    onEditShot(selectedShot.shotId, { durationSec: val });
                  }
                }}
              />
              s
            </label>
            <button
              className="btn-sm"
              onClick={() => onEditShot(selectedShot.shotId, {}, -1)}
              title="Đổi thứ tự sang trái"
            >
              ◀ Đổi vị trí
            </button>
            <button
              className="btn-sm"
              onClick={() => onEditShot(selectedShot.shotId, {}, 1)}
              title="Đổi thứ tự sang phải"
            >
              Đổi vị trí ▶
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
