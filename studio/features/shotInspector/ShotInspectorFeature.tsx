import type { StudioJob } from "../../../src/contracts/studio.js";





import type { WorkspaceModel } from "../../app/use-workspace.js";
import { statusLabel, request } from "../../shared/api/client.js";

export function ShotInspectorFeature({api, busy, editShot, jobs, run, selectedShot, seriesId, setPanel}:Pick<WorkspaceModel,"api"|"busy"|"editShot"|"jobs"|"run"|"selectedShot"|"seriesId"|"setPanel">){return (<aside className="inspector">
          <h2>THUỘC TÍNH & KIỂM ĐỊNH</h2>
          {selectedShot ? (
            <article>
              <h3>{selectedShot.shotId}</h3>
              <p>{selectedShot.visualPrompt}</p>
              <label>
                Thời lượng (giây)
                <input
                  key={selectedShot.shotId}
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="30"
                  defaultValue={selectedShot.durationSec}
                  onBlur={(e) => {
                    if (Number(e.target.value) !== selectedShot.durationSec)
                      void editShot(selectedShot.shotId, { durationSec: Number(e.target.value) });
                  }}
                />
              </label>
              <div className="actions">
                <button onClick={() => void editShot(selectedShot.shotId, {}, -1)}>← Đổi thứ tự</button>
                <button onClick={() => void editShot(selectedShot.shotId, {}, 1)}>Đổi thứ tự →</button>
                <button
                  className="btn-primary"
                  onClick={() => {
                    setPanel("comparison");
                  }}
                >
                  🎬 So sánh Take
                </button>
              </div>
              <small>Sửa shot cập nhật kịch bản; dựng lại sẽ tính lại timeline và phần media phụ thuộc.</small>
            </article>
          ) : (
            <p className="muted">Chọn shot trên timeline để xem chi tiết.</p>
          )}

          <h3>Hàng đợi sản xuất</h3>
          {jobs
            .filter((j) => j.request.seriesId === seriesId)
            .map((j) => (
              <article className={`job ${j.status}`} key={j.id}>
                <strong>
                  Tập {j.request.episodeNumber} · {j.control === "cancel" && j.status !== "cancelled" ? "Đang chờ hủy" : statusLabel[j.status]}
                </strong>
                <small>
                  {j.request.provider} · Trần {j.request.budgetCapUsd ?? 0} USD
                </small>
                <progress max={j.progress?.total || 8} value={j.progress?.step || 0} />
                <p>{j.progress?.message}</p>
                {j.error && <p className="error-text">{j.error.message}</p>}
                <div className="actions">
                  {(["queued", "running"].includes(j.status)
                    ? ["pause", "cancel"]
                    : j.status === "paused"
                    ? ["resume", "cancel"]
                    : ["failed", "needs_review", "cancelled"].includes(j.status)
                    ? (j.request.kind === "episode" && ["AUDIO_RESUME_REVIEW_REQUIRED", "TTS_RECOVERY_REQUIRED", "TTS_SUBMIT_UNCERTAIN"].includes(j.error?.code ?? "") ? ["retry", "regenerate-audio"] : ["retry"])
                    : []
                  ).map((a) => (
                    <button
                      key={a}
                      disabled={busy || (j.control === "cancel" && j.status !== "cancelled")}
                      onClick={() =>
                        void run(async () => {
                          await api<{jobs:StudioJob[]}>(`/api/v1/jobs/${j.id}/${a}`, {});
                        })
                      }
                    >
                      {{ pause: "Dừng", resume: "Tiếp tục", cancel: "Hủy", retry: "Thử lại", "regenerate-audio": "Tạo lại audio (có thể phát sinh phí)" }[a]}
                    </button>
                  ))}
                </div>
              </article>
            ))}
        </aside>);}
