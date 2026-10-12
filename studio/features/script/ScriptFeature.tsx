




import { CanonInvariantHud } from "../canon/CanonInvariantHud.js";

import type { WorkspaceModel } from "../../app/use-workspace.js";

export function ScriptFeature({busy, canonReport, dirty, handleAutoRepairCanon, handleValidateCanon, history, isRepairingCanon, isValidatingCanon, run, save, seriesId, setHistory, setNotice, setText, text, version}:Pick<WorkspaceModel,"busy"|"canonReport"|"dirty"|"handleAutoRepairCanon"|"handleValidateCanon"|"history"|"isRepairingCanon"|"isValidatingCanon"|"run"|"save"|"seriesId"|"setHistory"|"setNotice"|"setText"|"text"|"version">){return ((
            <div className="editor">
              <CanonInvariantHud
                report={canonReport}
                isValidating={isValidatingCanon}
                isRepairing={isRepairingCanon}
                onValidate={handleValidateCanon}
                onAutoRepair={handleAutoRepairCanon}
                scriptText={text}
              />
              <div className="toolbar">
                <span>
                  KỊCH BẢN PHÂN CẢNH{" "}
                  <small>
                    Phiên bản {version}
                    {dirty ? " · Chưa lưu" : " · Đã lưu"}
                  </small>
                </span>
                <button
                  disabled={!history.length}
                  onClick={() => {
                    setText(history[history.length - 1]);
                    setHistory(history.slice(0, -1));
                  }}
                >
                  Hoàn tác
                </button>
                <button
                  disabled={!seriesId || busy}
                  onClick={() =>
                    void run(async () => {
                      await save();
                      setNotice("Đã lưu bản nháp.");
                    })
                  }
                >
                  Lưu kịch bản
                </button>
              </div>
              <textarea
                aria-label="Kịch bản phân cảnh"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Dán kịch bản phân cảnh hoặc nhập tiểu thuyết để tạo kịch bản…"
                spellCheck={false}
              />
            </div>
          ));}
