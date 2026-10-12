

import type { BackupSnapshot } from "../../../src/contracts/studio-responses.js";


import type { WorkspaceModel } from "../../app/use-workspace.js";
import { media } from "../../shared/api/client.js";

export function ProjectsFeature({api, backupId, backups, bible, busy, creating, files, loadSeries, newId, newTitle, run, seriesId, setBackupId, setBackups, setCreating, setNewId, setNewTitle, setNotice, switchProject}:Pick<WorkspaceModel,"api"|"backupId"|"backups"|"bible"|"busy"|"creating"|"files"|"loadSeries"|"newId"|"newTitle"|"run"|"seriesId"|"setBackupId"|"setBackups"|"setCreating"|"setNewId"|"setNewTitle"|"setNotice"|"switchProject">){return (<aside className="library">
          <h2>THƯ VIỆN DỰ ÁN</h2>
          <button onClick={() => setCreating(!creating)}>＋ Dự án mới</button>
          {creating && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api("/api/series/init", { id: newId, title: newTitle, aspect_ratio: "16:9", fps: 30 });
                  await loadSeries();
                  switchProject(newId);
                  setCreating(false);
                });
              }}
            >
              <label>
                Tên dự án
                <input aria-label="Tên dự án mới" required value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
              </label>
              <label>
                Mã dự án
                <input
                  aria-label="Mã dự án mới"
                  required
                  pattern="[a-zA-Z0-9_-]+"
                  value={newId}
                  onChange={(e) => setNewId(e.target.value)}
                />
              </label>
              <button type="submit">Tạo dự án</button>
            </form>
          )}

          <h3>Nhân vật ({bible.characters?.length || 0})</h3>
          {(bible.characters || []).map((c) => (
            <article key={c.id}>
              <strong>{c.name}</strong>
              <small>{c.visual_summary || "Chưa có mô tả hình ảnh"}</small>
            </article>
          ))}

          <h3>Bối cảnh ({bible.locations?.length || 0})</h3>
          {(bible.locations || []).map((l) => (
            <article key={l.id}>{l.name}</article>
          ))}

          <h3>Dữ liệu</h3>
          <button disabled={!seriesId||busy} onClick={()=>void run(async()=>{const snapshots=await api<BackupSnapshot[]>(`/api/v1/series/${seriesId}/backups`);setBackups(snapshots);setBackupId(snapshots[0]?.id||"");})}>Danh sách bản sao lưu</button>
          {backups.length>0&&<><select value={backupId} onChange={event=>setBackupId(event.target.value)}>{backups.map(snapshot=><option key={snapshot.id} value={snapshot.id}>{snapshot.createdAt} · {snapshot.fileCount} tệp</option>)}</select><button disabled={!backupId||busy} onClick={()=>{if(window.confirm("Khôi phục bản sao lưu đã chọn? Dữ liệu hiện tại được giữ trong thư mục trước khôi phục."))void run(async()=>{await api(`/api/v1/series/${seriesId}/restore`,{id:backupId});setNotice("Đã khôi phục. Tải lại dự án để đọc dữ liệu mới.");});}}>Khôi phục bản đã chọn</button></>}
          <button
            disabled={!seriesId}
            onClick={() =>
              void run(async () => {
                const snap = await api<{id:string}>(`/api/v1/series/${seriesId}/backups`, {});
                setNotice(`Đã sao lưu dự án: ${snap.id}`);
              })
            }
          >
            Sao lưu dự án
          </button>
          <button
            disabled={!seriesId}
            onClick={() =>
              void run(async () => {
                const usage = await api<{files:number;bytes:number}>(`/api/v1/series/${seriesId}/usage`);
                setNotice(`${usage.files} tệp · ${(usage.bytes / 1024 ** 3).toFixed(2)} GiB. Media đang dùng được giữ nguyên.`);
              })
            }
          >
            Dung lượng
          </button>

          <h3>Đầu ra Master</h3>
          {files.map((f) => (
            <a className="file" key={f} href={media(f)} download>
              {f.split(/[\\/]/).pop()}
            </a>
          ))}
          {!files.length && <p className="muted">Chưa có bản dựng.</p>}
        </aside>);}
