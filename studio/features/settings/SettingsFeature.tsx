
import type { ModelProviderInfo } from "../../../src/contracts/settings.js";



import type { WorkspaceModel } from "../../app/use-workspace.js";

export function SettingsFeature({api, busy, changes, providers, run, setChanges, setNotice}:Pick<WorkspaceModel,"api"|"busy"|"changes"|"providers"|"run"|"setChanges"|"setNotice">){return ((
            <div className="settings">
              {providers.map((p) => (
                <article key={p.id}>
                  <h3>{p.name}</h3>
                  <small>{p.isConfigured ? "Đã cấu hình · sẵn sàng sản xuất" : "Chưa cấu hình"}</small>
                  {p.fields.map((f) => (
                    <label key={f.envKey}>
                      {f.label}
                      <input
                        type={f.type === "password" ? "password" : "text"}
                        placeholder={f.type === "password" ? "Nhập để thay khóa hiện có" : f.value || f.placeholder}
                        value={changes[f.envKey] ?? ""}
                        onChange={(e) => setChanges({ ...changes, [f.envKey]: e.target.value })}
                      />
                    </label>
                  ))}
                </article>
              ))}
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api<{providers:ModelProviderInfo[]}>("/api/settings/models", { updates: changes });
                    setChanges({});
                    setNotice("Đã lưu cấu hình. Công việc tiếp theo sẽ dùng cấu hình mới.");
                  })
                }
              >
                Lưu cấu hình
              </button>
            </div>
          ));}
