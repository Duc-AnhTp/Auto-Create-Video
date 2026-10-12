import React, { useState } from "react";
import type { ValidationReport, InvariantViolation } from "../../../src/contracts/studio-features.js";
export interface CanonInvariantHudProps {
    report: ValidationReport | null;
    isValidating: boolean;
    isRepairing: boolean;
    onValidate: () => void;
    onAutoRepair: () => void;
    scriptText: string;
}
export const CanonInvariantHud: React.FC<CanonInvariantHudProps> = ({ report, isValidating, isRepairing, onValidate, onAutoRepair, scriptText, }) => {
    const [expanded, setExpanded] = useState(false);
    const status = report?.status ?? "UNCHECKED";
    const fatalCount = report?.fatalCount ?? 0;
    const repairableCount = report?.repairableCount ?? 0;
    const violations = report?.violations ?? [];
    const gate1Failed = violations.some((v) => v.type === "anti_resurrection");
    const gate2Failed = violations.some((v) => v.type === "prop_custody_violation");
    const gate3Failed = violations.some((v) => v.type === "epistemic_knowledge_violation");
    const gate4Failed = violations.some((v) => v.type === "spatio_temporal_violation");
    return (<div className={`canon-hud-container status-${status.toLowerCase()}`}>
      <div className="canon-hud-header">
        <div className="canon-hud-title-row">
          <div className="canon-hud-badge">
            <span className="indicator-dot"/>
            <span className="badge-text">
              {status === "PASS"
            ? "✓ CANON CHUẨN XÁC (PASS)"
            : status === "WARN"
                ? `⚠ CẦN BẮC CẦU (${repairableCount} VI PHẠM)`
                : status === "FAIL"
                    ? `✕ VI PHẠM CANON (${fatalCount} LỖI TỬ THƯƠNG)`
                    : "⚡ CHƯA KIỂM ĐỊNH NHÂN QUẢ"}
            </span>
          </div>

          <div className="canon-hud-gates">
            <div className={`gate-chip ${gate1Failed ? "gate-fail" : status === "UNCHECKED" ? "" : "gate-pass"}`}>
              <span className="chip-icon">{gate1Failed ? "✕" : "✓"}</span>
              <span>G1: Kháng Hồi Sinh</span>
            </div>
            <div className={`gate-chip ${gate2Failed ? "gate-warn" : status === "UNCHECKED" ? "" : "gate-pass"}`}>
              <span className="chip-icon">{gate2Failed ? "⚠" : "✓"}</span>
              <span>G2: Sở Hữu Đạo Cụ</span>
            </div>
            <div className={`gate-chip ${gate3Failed ? "gate-fail" : status === "UNCHECKED" ? "" : "gate-pass"}`}>
              <span className="chip-icon">{gate3Failed ? "✕" : "✓"}</span>
              <span>G3: Biên Giới Tri Thức</span>
            </div>
            <div className={`gate-chip ${gate4Failed ? "gate-fail" : status === "UNCHECKED" ? "" : "gate-pass"}`}>
              <span className="chip-icon">{gate4Failed ? "✕" : "✓"}</span>
              <span>G4: Liên Tục Không Gian</span>
            </div>
          </div>
        </div>

        <div className="canon-hud-actions">
          {repairableCount > 0 && (<button className="btn-auto-repair pulse-animation" disabled={isRepairing || isValidating} onClick={onAutoRepair} title="Tự động sinh cảnh chuyển giao đạo cụ để hợp thức hóa kịch bản">
              {isRepairing ? "⚙ Đang sinh Cảnh Bắc Cầu..." : "🛠️ 1-Click Auto-Repair"}
            </button>)}

          <button className="btn-validate" disabled={isValidating || !scriptText.trim()} onClick={onValidate} title="Thẩm định toàn bộ kịch bản đối chiếu với Story Bible">
            {isValidating ? "⌛ Đang quét AST..." : "🔍 Thẩm Định Canon"}
          </button>

          {violations.length > 0 && (<button className="btn-toggle-details" onClick={() => setExpanded(!expanded)}>
              {expanded ? "Thu gọn ▲" : `Chi tiết (${violations.length}) ▼`}
            </button>)}
        </div>
      </div>

      {violations.length > 0 && expanded && (<div className="canon-hud-details">
          <div className="violation-list">
            {violations.map((v: InvariantViolation, idx: number) => (<div key={idx} className={`violation-item severity-${v.severity}`}>
                <div className="violation-header">
                  <span className={`severity-tag tag-${v.severity}`}>
                    {v.severity === "fatal" ? "TỬ THƯƠNG (FATAL)" : "CÓ THỂ HÓA GIẢI (BRIDGEABLE)"}
                  </span>
                  <span className="violation-scene">Cảnh {v.sceneNumber}</span>
                  {v.characterName && <span className="violation-char">Nhân vật: <strong>{v.characterName}</strong></span>}
                  {v.propName && <span className="violation-prop">Đạo cụ: <strong>{v.propName}</strong></span>}
                </div>
                <div className="violation-desc">{v.description}</div>
                {v.quote && <div className="violation-quote">"{v.quote}"</div>}
                <div className="violation-remedy">
                  <strong>💡 Giải pháp:</strong> {v.reconciliationSuggestion}
                </div>
              </div>))}
          </div>
        </div>)}
    </div>);
};
