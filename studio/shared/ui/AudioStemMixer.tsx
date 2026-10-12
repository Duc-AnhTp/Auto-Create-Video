import React, { useState, useEffect, useRef } from "react";
import type { StemChannelState, AutoDuckingConfig } from "../../../src/contracts/studio-features.js";

interface AudioStemMixerProps {
  stems: Record<string, string>; // { dialogue: path, sfx: path, ambience: path, bgm: path }
  onMasterMuteChange?: (muted: boolean) => void;
}

export function AudioStemMixer({ stems }: AudioStemMixerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [channels, setChannels] = useState<Record<string, StemChannelState>>({});
  const [masterVolume, setMasterVolume] = useState(1.0);
  const [masterMuted, setMasterMuted] = useState(false);
  const [ducking, setDucking] = useState<AutoDuckingConfig>({
    enabled: true,
    threshold: -24,
    duckingAmountDb: -14,
    attackMs: 50,
    releaseMs: 300,
  });

  const audioRefs = useRef<Record<string, HTMLAudioElement>>({});
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodesRef = useRef<Record<string, GainNode>>({});
  const analyserNodesRef = useRef<Record<string, AnalyserNode>>({});
  const masterGainRef = useRef<GainNode | null>(null);
  const animFrameRef = useRef<number>(0);

  // Define the standard 4 audio stems
  const stemKeys = ["dialogue", "sfx", "ambience", "bgm"];
  const stemDisplayNames: Record<string, string> = {
    dialogue: "1. THOẠI (DIALOGUE)",
    sfx: "2. SFX / FOLEY",
    ambience: "3. MÔI TRƯỜNG (AMB)",
    bgm: "4. NHẠC NỀN (MUSIC)",
  };

  // Initialize channels
  useEffect(() => {
    const initialChannels: Record<string, StemChannelState> = {};
    for (const key of stemKeys) {
      initialChannels[key] = {
        name: stemDisplayNames[key] || key.toUpperCase(),
        path: stems[key] || "",
        volume: 1.0,
        muted: false,
        solo: false,
        level: 0,
        peak: 0,
      };
    }
    setChannels(initialChannels);
  }, [stems]);

  // Setup Web Audio API Context and Graph
  const initAudioGraph = () => {
    if (audioContextRef.current) {
      if (audioContextRef.current.state === "suspended") {
        void audioContextRef.current.resume();
      }
      return;
    }

    const ctx = new (window.AudioContext || (window as Window & {webkitAudioContext?:typeof AudioContext}).webkitAudioContext!)();
    audioContextRef.current = ctx;

    const masterGain = ctx.createGain();
    masterGain.gain.value = masterMuted ? 0 : masterVolume;
    masterGain.connect(ctx.destination);
    masterGainRef.current = masterGain;

    for (const key of stemKeys) {
      const audioEl = audioRefs.current[key];
      if (audioEl) {
        try {
          const source = ctx.createMediaElementSource(audioEl);
          const gain = ctx.createGain();
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;

          source.connect(gain);
          gain.connect(analyser);
          analyser.connect(masterGain);

          gainNodesRef.current[key] = gain;
          analyserNodesRef.current[key] = analyser;
        } catch {}
      }
    }

    // Start VU meter loop
    const sampleVU = () => {
      const updatedLevels: Record<string, { level: number; peak: number }> = {};
      let dialogueRMS = 0;

      for (const key of stemKeys) {
        const analyser = analyserNodesRef.current[key];
        if (analyser) {
          const buffer = new Uint8Array(analyser.frequencyBinCount);
          analyser.getByteTimeDomainData(buffer);

          let sum = 0;
          let peak = 0;
          for (let i = 0; i < buffer.length; i++) {
            const v = (buffer[i] - 128) / 128;
            sum += v * v;
            const absV = Math.abs(v);
            if (absV > peak) peak = absV;
          }
          const rms = Math.sqrt(sum / buffer.length);
          updatedLevels[key] = {
            level: Math.min(1.0, rms * 3.5),
            peak: Math.min(1.0, peak * 2.5),
          };

          if (key === "dialogue") {
            dialogueRMS = rms;
          }
        }
      }

      // Auto-ducking sidechain logic: if dialogue exceeds threshold, duck BGM gain
      if (ducking.enabled && gainNodesRef.current["bgm"]) {
        const bgmGain = gainNodesRef.current["bgm"];
        const thresholdRMS = Math.pow(10, ducking.threshold / 20);
        if (dialogueRMS > thresholdRMS) {
          // Duck BGM
          const targetGain = Math.pow(10, ducking.duckingAmountDb / 20);
          bgmGain.gain.setTargetAtTime(targetGain, ctx.currentTime, ducking.attackMs / 1000);
        } else {
          // Restore BGM gain to current channel volume
          const normalGain = channels["bgm"]?.muted ? 0 : channels["bgm"]?.volume ?? 1.0;
          bgmGain.gain.setTargetAtTime(normalGain, ctx.currentTime, ducking.releaseMs / 1000);
        }
      }

      setChannels((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [k, v] of Object.entries(updatedLevels)) {
          if (next[k]) {
            next[k] = { ...next[k], level: v.level, peak: v.peak };
            changed = true;
          }
        }
        return changed ? next : prev;
      });

      animFrameRef.current = requestAnimationFrame(sampleVU);
    };

    sampleVU();
  };

  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (audioContextRef.current) void audioContextRef.current.close();
    };
  }, []);

  const toggleMasterPlay = () => {
    initAudioGraph();
    const nextPlay = !isPlaying;
    setIsPlaying(nextPlay);

    for (const key of stemKeys) {
      const el = audioRefs.current[key];
      if (el) {
        if (nextPlay) {
          el.currentTime = 0;
          void el.play().catch(() => {});
        } else {
          el.pause();
        }
      }
    }
  };

  const handleChannelVolumeChange = (key: string, vol: number) => {
    setChannels((prev) => ({
      ...prev,
      [key]: { ...prev[key], volume: vol },
    }));
    const gainNode = gainNodesRef.current[key];
    if (gainNode) {
      gainNode.gain.value = channels[key]?.muted ? 0 : vol;
    }
  };

  const handleToggleMute = (key: string) => {
    const nextMuted = !channels[key]?.muted;
    setChannels((prev) => ({
      ...prev,
      [key]: { ...prev[key], muted: nextMuted },
    }));
    const gainNode = gainNodesRef.current[key];
    if (gainNode) {
      gainNode.gain.value = nextMuted ? 0 : (channels[key]?.volume ?? 1.0);
    }
  };

  const handleToggleSolo = (key: string) => {
    const nextSolo = !channels[key]?.solo;
    setChannels((prev) => {
      const next = { ...prev };
      for (const k of stemKeys) {
        if (k === key) {
          next[k] = { ...next[k], solo: nextSolo };
        } else {
          next[k] = { ...next[k], solo: false };
        }
      }
      return next;
    });

    for (const k of stemKeys) {
      const gainNode = gainNodesRef.current[k];
      if (gainNode) {
        if (nextSolo) {
          gainNode.gain.value = k === key ? (channels[k]?.volume ?? 1.0) : 0;
        } else {
          gainNode.gain.value = channels[k]?.muted ? 0 : (channels[k]?.volume ?? 1.0);
        }
      }
    }
  };

  const toDb = (vol: number) => {
    if (vol <= 0.001) return "-inf";
    const db = 20 * Math.log10(vol);
    return `${db >= 0 ? "+" : ""}${db.toFixed(1)} dB`;
  };

  return (
    <div className="audio-mixer-suite">
      <div className="mixer-topbar">
        <div className="mixer-title">
          <h3>BÀN TRỘN ÂM THANH ĐIỆN ẢNH (4-STEM MASTER MIXER)</h3>
          <span>Web Audio API 48kHz Stereo Engine</span>
        </div>

        <div className="mixer-actions">
          <button className={`btn-primary ${isPlaying ? "active" : ""}`} onClick={toggleMasterPlay}>
            {isPlaying ? "⏹ DỪNG TẤT CẢ STEMS" : "▶ PHÁT TẤT CẢ STEMS ĐỒNG BỘ"}
          </button>
        </div>
      </div>

      {/* Channel Strips Grid */}
      <div className="mixer-console-desk">
        {stemKeys.map((key) => {
          const ch = channels[key];
          const hasStem = Boolean(stems[key]);
          const levelPercent = Math.min(100, (ch?.level || 0) * 100);
          const peakPercent = Math.min(100, (ch?.peak || 0) * 100);

          return (
            <div className={`channel-strip ${!hasStem ? "empty-stem" : ""}`} key={key}>
              <div className="strip-header">
                <span className="channel-badge">{key.toUpperCase()}</span>
                <h4>{stemDisplayNames[key]}</h4>
              </div>

              {/* Dual VU Meter */}
              <div className="vu-meter-chassis">
                <div className="meter-scale-markers">
                  <span>+6</span>
                  <span>0</span>
                  <span>-6</span>
                  <span>-12</span>
                  <span>-24</span>
                  <span>-48</span>
                </div>
                <div className="vu-bars-container">
                  <div className="vu-bar left">
                    <div className="vu-fill" style={{ height: `${levelPercent}%` }} />
                    <div className="vu-peak" style={{ bottom: `${peakPercent}%` }} />
                  </div>
                  <div className="vu-bar right">
                    <div className="vu-fill" style={{ height: `${Math.max(0, levelPercent * 0.95)}%` }} />
                    <div className="vu-peak" style={{ bottom: `${Math.max(0, peakPercent * 0.95)}%` }} />
                  </div>
                </div>
              </div>

              {/* Fader & Gain Controls */}
              <div className="fader-well">
                <span className="db-readout">{toDb(ch?.volume ?? 1.0)}</span>
                <input
                  type="range"
                  className="vertical-fader"
                  min="0"
                  max="1.5"
                  step="0.02"
                  value={ch?.volume ?? 1.0}
                  disabled={!hasStem}
                  onChange={(e) => handleChannelVolumeChange(key, Number(e.target.value))}
                />
              </div>

              {/* Mute / Solo Toggles */}
              <div className="strip-buttons">
                <button
                  className={`btn-strip-m ${ch?.muted ? "active" : ""}`}
                  disabled={!hasStem}
                  onClick={() => handleToggleMute(key)}
                  title="Mute kênh này"
                >
                  MUTE
                </button>
                <button
                  className={`btn-strip-s ${ch?.solo ? "active" : ""}`}
                  disabled={!hasStem}
                  onClick={() => handleToggleSolo(key)}
                  title="Solo kênh này"
                >
                  SOLO
                </button>
              </div>

              {/* Hidden Audio Element for Media Routing */}
              {hasStem && (
                <audio
                  ref={(el) => {
                    if (el) audioRefs.current[key] = el;
                  }}
                  src={`/api/media/stream?path=${encodeURIComponent(stems[key])}`}
                  crossOrigin="anonymous"
                  loop
                />
              )}
            </div>
          );
        })}

        {/* Master Bus Channel Strip */}
        <div className="channel-strip master-bus">
          <div className="strip-header">
            <span className="channel-badge master">MASTER</span>
            <h4>TỔNG MASTER BUS</h4>
          </div>

          <div className="vu-meter-chassis">
            <div className="meter-scale-markers">
              <span>+6</span>
              <span>0</span>
              <span>-6</span>
              <span>-12</span>
              <span>-24</span>
              <span>-48</span>
            </div>
            <div className="vu-bars-container">
              <div className="vu-bar master">
                <div
                  className="vu-fill master"
                  style={{
                    height: `${Math.min(
                      100,
                      Object.values(channels).reduce((acc, c) => Math.max(acc, c.level * 100), 0)
                    )}%`,
                  }}
                />
              </div>
            </div>
          </div>

          <div className="fader-well">
            <span className="db-readout">{toDb(masterVolume)}</span>
            <input
              type="range"
              className="vertical-fader"
              min="0"
              max="1.5"
              step="0.02"
              value={masterVolume}
              onChange={(e) => {
                const v = Number(e.target.value);
                setMasterVolume(v);
                if (masterGainRef.current) masterGainRef.current.gain.value = masterMuted ? 0 : v;
              }}
            />
          </div>

          <div className="strip-buttons">
            <button
              className={`btn-strip-m ${masterMuted ? "active" : ""}`}
              onClick={() => {
                const next = !masterMuted;
                setMasterMuted(next);
                if (masterGainRef.current) masterGainRef.current.gain.value = next ? 0 : masterVolume;
              }}
            >
              MUTE ALL
            </button>
          </div>
        </div>
      </div>

      {/* Auto-Ducking Sidechain Controller */}
      <div className="ducking-controls-pod">
        <div className="pod-header">
          <h4>🎛️ TỰ ĐỘNG NÉN NHẠC THEO THOẠI (SIDECHAIN AUTO-DUCKING)</h4>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={ducking.enabled}
              onChange={(e) => setDucking({ ...ducking, enabled: e.target.checked })}
            />
            <span>{ducking.enabled ? "BẬT DUCKING" : "TẮT DUCKING"}</span>
          </label>
        </div>

        <div className="pod-sliders">
          <div className="slider-group">
            <label>Ngưỡng thoại (Threshold): <strong>{ducking.threshold} dB</strong></label>
            <input
              type="range"
              min="-36"
              max="-10"
              step="1"
              value={ducking.threshold}
              onChange={(e) => setDucking({ ...ducking, threshold: Number(e.target.value) })}
            />
            <small>Khi mức thoại vượt ngưỡng này, nhạc nền sẽ tự động hạ xuống.</small>
          </div>

          <div className="slider-group">
            <label>Độ suy giảm nhạc (Ducking Amount): <strong>{ducking.duckingAmountDb} dB</strong></label>
            <input
              type="range"
              min="-24"
              max="-6"
              step="1"
              value={ducking.duckingAmountDb}
              onChange={(e) => setDucking({ ...ducking, duckingAmountDb: Number(e.target.value) })}
            />
            <small>Nhạc nền tự động giảm {Math.abs(ducking.duckingAmountDb)}dB để thoại nổi bật chuẩn Hollywood.</small>
          </div>
        </div>
      </div>
    </div>
  );
}
