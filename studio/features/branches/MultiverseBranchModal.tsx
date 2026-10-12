import React, { useState, useEffect } from "react";
import type { TimelineBranchItem, MultiverseBranchDiff } from "../../../src/contracts/studio-features.js";
export interface MultiverseBranchModalProps {
    seriesId: string;
    currentEpisode: number;
    branches: TimelineBranchItem[];
    activeBranchId: string;
    isOpen: boolean;
    mode: "fork" | "diff";
    onClose: () => void;
    onForkBranch: (options: {
        name: string;
        description?: string;
        fromEpisodeNumber: number;
    }) => Promise<void>;
    onCompareBranches: (branchAId: string, branchBId: string) => Promise<MultiverseBranchDiff>;
    onPromoteToCanonical: (branchId: string) => Promise<void>;
    onSwitchBranch: (branchId: string) => void;
}
export const MultiverseBranchModal: React.FC<MultiverseBranchModalProps> = ({ seriesId, currentEpisode, branches, activeBranchId, isOpen, mode: initialMode, onClose, onForkBranch, onCompareBranches, onPromoteToCanonical, onSwitchBranch, }) => {
    const [tab, setTab] = useState<"fork" | "diff">(initialMode);
    const [forkName, setForkName] = useState("");
    const [forkDesc, setForkDesc] = useState("");
    const [forkEpisode, setForkEpisode] = useState(currentEpisode);
    const [branchA, setBranchA] = useState("");
    const [branchB, setBranchB] = useState("");
    const [diffResult, setDiffResult] = useState<MultiverseBranchDiff | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    useEffect(() => {
        setTab(initialMode);
    }, [initialMode]);
    useEffect(() => {
        if (branches.length >= 2) {
            const canon = branches.find((b) => b.is_canonical === 1) || branches[0];
            const alt = branches.find((b) => b.id !== canon.id) || branches[1];
            setBranchA(canon.id);
            setBranchB(alt.id);
        }
        else if (branches.length === 1) {
            setBranchA(branches[0].id);
            setBranchB(branches[0].id);
        }
    }, [branches]);
    if (!isOpen)
        return null;
    const handleFork = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!forkName.trim()) {
            setError("Vui lòng nhập tên nhánh kịch bản.");
            return;
        }
        setLoading(true);
        setError("");
        try {
            await onForkBranch({
                name: forkName.trim(),
                description: forkDesc.trim() || undefined,
                fromEpisodeNumber: forkEpisode,
            });
            setNotice(`Đã tạo thành công nhánh What-If: "${forkName}"`);
            setForkName("");
            setForkDesc("");
            setTimeout(() => {
                onClose();
            }, 1000);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
        finally {
            setLoading(false);
        }
    };
    const handleCompare = async () => {
        if (!branchA || !branchB)
            return;
        setLoading(true);
        setError("");
        try {
            const diff = await onCompareBranches(branchA, branchB);
            setDiffResult(diff);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
        finally {
            setLoading(false);
        }
    };
    const handlePromote = async (targetBranchId: string) => {
        const target = branches.find((b) => b.id === targetBranchId);
        if (!window.confirm(`Bạn có chắc chắn muốn thăng hạng nhánh "${target?.name}" thành Dòng Thời Gian Chính Thức (Canon Main)?`)) {
            return;
        }
        setLoading(true);
        setError("");
        try {
            await onPromoteToCanonical(targetBranchId);
            setNotice(`Đã thăng hạng nhánh "${target?.name}" thành Canon Master!`);
            setTimeout(() => {
                onClose();
            }, 1200);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
        finally {
            setLoading(false);
        }
    };
    return (<div className="modal-backdrop" onClick={onClose}>
      <div className="multiverse-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <span className="multiverse-icon">🌀</span>
            <h3>ĐỘNG CƠ PHÂN NHÁNH ĐA VŨ TRỤ (MULTIVERSE TIMELINE)</h3>
          </div>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-tabs">
          <button className={`tab-btn ${tab === "fork" ? "active" : ""}`} onClick={() => setTab("fork")}>
            ＋ Rẽ Nhánh Giả Định (What-If)
          </button>
          <button className={`tab-btn ${tab === "diff" ? "active" : ""}`} onClick={() => {
            setTab("diff");
            if (!diffResult && branchA && branchB) {
                void handleCompare();
            }
        }}>
            ⚖️ So Sánh Đa Vũ Trụ (Multiverse Diff)
          </button>
        </div>

        {error && <div className="banner error">{error}</div>}
        {notice && <div className="banner status">{notice}</div>}

        <div className="modal-body">
          {tab === "fork" ? (<form onSubmit={handleFork} className="fork-form">
              <p className="form-lead">
                Rẽ nhánh "What-If" cho phép đạo diễn thử nghiệm hướng phát triển cốt truyện thay thế mà không ghi đè dòng thời gian chính thức.
              </p>

              <label>
                Tên nhánh cốt truyện *
                <input type="text" required placeholder="Ví dụ: What-If Nam Không Bị Bắt ở Tập 3" value={forkName} onChange={(e) => setForkName(e.target.value)}/>
              </label>

              <label>
                Rẽ nhánh từ tập số
                <input type="number" min="1" required value={forkEpisode} onChange={(e) => setForkEpisode(Math.max(1, Number(e.target.value)))}/>
                <small className="muted">
                  Trạng thái Story Bible (nhân vật, đạo cụ, quy tắc thế giới) tại Tập {forkEpisode} sẽ được nhân bản sang nhánh mới.
                </small>
              </label>

              <label>
                Mô tả ý đồ kịch bản (Tuỳ chọn)
                <textarea rows={3} placeholder="Ghi chú về phân kỳ sự kiện hoặc thay đổi nhân vật..." value={forkDesc} onChange={(e) => setForkDesc(e.target.value)}/>
              </label>

              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={onClose}>
                  Hủy
                </button>
                <button type="submit" className="btn-primary" disabled={loading}>
                  {loading ? "Đang tạo nhánh..." : "Tạo Nhánh What-If"}
                </button>
              </div>
            </form>) : (<div className="diff-view">
              <div className="branch-selector-row">
                <div className="branch-select-group">
                  <label>Nhánh A (Gốc)</label>
                  <select value={branchA} onChange={(e) => setBranchA(e.target.value)}>
                    {branches.map((b) => (<option key={b.id} value={b.id}>
                        {b.is_canonical ? "★ [Canon] " : "◈ [What-If] "} {b.name}
                      </option>))}
                  </select>
                </div>

                <div className="vs-badge">VS</div>

                <div className="branch-select-group">
                  <label>Nhánh B (So Sánh)</label>
                  <select value={branchB} onChange={(e) => setBranchB(e.target.value)}>
                    {branches.map((b) => (<option key={b.id} value={b.id}>
                        {b.is_canonical ? "★ [Canon] " : "◈ [What-If] "} {b.name}
                      </option>))}
                  </select>
                </div>

                <button type="button" className="btn-compare-action" disabled={loading || branchA === branchB} onClick={handleCompare}>
                  {loading ? "Đang so khớp..." : "So Khớp"}
                </button>
              </div>

              {diffResult ? (<div className="diff-results-container">
                  <div className="diff-summary-card">
                    <div>
                      <strong>Tập bắt đầu phân kỳ:</strong>{" "}
                      {diffResult.divergentEpisodes.length > 0
                    ? `Tập ${diffResult.divergentEpisodes.join(", ")}`
                    : "Hai nhánh có diễn biến hoàn toàn tương đồng."}
                    </div>
                  </div>

                  <h4>1. Khác Biệt Trạng Thái Nhân Vật ({diffResult.characterStatusDiffs.length})</h4>
                  {diffResult.characterStatusDiffs.length > 0 ? (<table className="diff-table">
                      <thead>
                        <tr>
                          <th>Nhân vật</th>
                          <th>{diffResult.branchA.name}</th>
                          <th>{diffResult.branchB.name}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diffResult.characterStatusDiffs.map((c) => (<tr key={c.characterId}>
                            <td><strong>{c.characterName}</strong></td>
                            <td>
                              <span className={`status-tag status-${c.statusInBranchA}`}>
                                {c.statusInBranchA}
                              </span>
                            </td>
                            <td>
                              <span className={`status-tag status-${c.statusInBranchB}`}>
                                {c.statusInBranchB}
                              </span>
                            </td>
                          </tr>))}
                      </tbody>
                    </table>) : (<p className="muted">Không có sai khác về trạng thái sống/chết của nhân vật.</p>)}

                  <h4>2. Khác Biệt Quyền Nắm Giữ Đạo Cụ ({diffResult.propHolderDiffs.length})</h4>
                  {diffResult.propHolderDiffs.length > 0 ? (<table className="diff-table">
                      <thead>
                        <tr>
                          <th>Đạo cụ</th>
                          <th>Người giữ ({diffResult.branchA.name})</th>
                          <th>Người giữ ({diffResult.branchB.name})</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diffResult.propHolderDiffs.map((p) => (<tr key={p.propId}>
                            <td><strong>{p.propName}</strong></td>
                            <td>{p.holderInBranchA || "Không ai"}</td>
                            <td>{p.holderInBranchB || "Không ai"}</td>
                          </tr>))}
                      </tbody>
                    </table>) : (<p className="muted">Quyền nắm giữ đạo cụ giữa hai nhánh đồng nhất.</p>)}

                  {/* Promote Branch B to Canonical */}
                  {!diffResult.branchB.isCanonical && (<div className="promote-box">
                      <div className="promote-info">
                        <strong>Thăng Hạng Nhánh Thành Canon Chính Thức</strong>
                        <p>
                          Nếu hài lòng với diễn biến của <em>"{diffResult.branchB.name}"</em>, bạn có thể biến nó thành dòng thời gian chính thức của tác phẩm.
                        </p>
                      </div>
                      <button className="btn-promote" disabled={loading} onClick={() => handlePromote(diffResult.branchB.id)}>
                        ⭐ Thăng Hạng Thành Canon
                      </button>
                    </div>)}
                </div>) : (<div className="diff-placeholder">
                  Chọn 2 nhánh khác nhau và nhấn "So Khớp" để kiểm tra sai lệch trạng thái đa vũ trụ.
                </div>)}
            </div>)}
        </div>
      </div>
    </div>);
};
