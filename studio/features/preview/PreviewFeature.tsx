




import type { WorkspaceModel } from "../../app/use-workspace.js";
import { media } from "../../shared/api/client.js";

export function PreviewFeature({mainVideo, previewStale, renderedJob, setCurrentTime, video}:Pick<WorkspaceModel,"mainVideo"|"previewStale"|"renderedJob"|"setCurrentTime"|"video">){return ((
            <div className="preview">
              {mainVideo ? (
                <>
                  <video
                    ref={video}
                    controls
                    src={media(mainVideo)}
                    onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                  />
                  <p>
                    {renderedJob?.result?.isMock ? "BẢN THỬ · Media mô phỏng" : "Bản dựng Master gần nhất"}
                    {previewStale ? " · Kịch bản có thay đổi chưa dựng" : ""}
                  </p>
                </>
              ) : (
                <div className="empty">
                  <span>◈</span>
                  <h2>Chưa có bản dựng</h2>
                  <p>Nhập kịch bản và chạy bản thử để bắt đầu.</p>
                </div>
              )}
            </div>
          ));}
