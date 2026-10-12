import React, { useState, useEffect } from "react";
import type { PrunedSemanticContextData, SemanticMemoryEntityItem } from "../../../src/contracts/studio-features.js";

export interface SemanticMemoryInspectorProps {
  seriesId: string;
  episodeNumber: number;
  currentScriptText: string;
  onQueryMemory: (queryText: string, tokenBudget?: number) => Promise<{
    prunedContext: PrunedSemanticContextData;
    queryResults: SemanticMemoryEntityItem[];
  }>;
}

export const SemanticMemoryInspector: React.FC<SemanticMemoryInspectorProps> = ({
  seriesId,
  episodeNumber,
  currentScriptText,
  onQueryMemory,
}) => {
  const [queryText, setQueryText] = useState("");
  const [tokenBudget, setTokenBudget] = useState(3000);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [prunedData, setPrunedData] = useState<PrunedSemanticContextData | null>(null);
  const [queryResults, setQueryResults] = useState<SemanticMemoryEntityItem[]>([]);
  const [activeTab, setActiveTab] = useState<"pruned" | "ranked">("pruned");

  const executeQuery = async (textToQuery: string) => {
    if (!textToQuery.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await onQueryMemory(textToQuery.trim(), tokenBudget);
      setPrunedData(res.prunedContext);
      setQueryResults(res.queryResults);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initial analysis using first 500 characters of current script or episode label
    const initialQuery = currentScriptText.slice(0, 400).trim() || `Tập ${episodeNumber}`;
    setQueryText(initialQuery);
    void executeQuery(initialQuery);
  }, [seriesId, episodeNumber]);

  const estimatedTokens = prunedData?.estimatedTokens ?? 0;
  const budgetRatio = Math.min(100, Math.round((estimatedTokens / tokenBudget) * 100));

  return (
    <div className="semantic-inspector-container">
      <div className="semantic-header">
        <div className="semantic-title">
          <span className="semantic-icon">🧠</span>
          <div>
            <h3>BỘ NHỚ NGỮ NGHĨA 128-D & CẮT TỈA NGỮ CẢNH (DYNAMIC PRUNING)</h3>
            <small>
              Trích lọc KNN Cosine Similarity từ Story Bible để bảo vệ LLM Context Window khỏi quá tải và phân tán chú ý.
            </small>
          </div>
        </div>

        <div className="semantic-search-bar">
          <input
            type="text"
            placeholder="Nhập tình huống phân cảnh hoặc beat kịch bản để thẩm định độ liên quan..."
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void executeQuery(queryText);
            }}
          />
          <button
            className="btn-query"
            disabled={loading || !queryText.trim()}
            onClick={() => void executeQuery(queryText)}
          >
            {loading ? "Đang nhúng 128-D..." : "Truy Vấn KNN"}
          </button>
          <button
            className="btn-sync-script"
            title="Đồng bộ tự động từ kịch bản đang soạn thảo"
            onClick={() => {
              const text = currentScriptText.slice(0, 500).trim();
              setQueryText(text);
              void executeQuery(text);
            }}
          >
            Đồng bộ từ Kịch bản
          </button>
        </div>
      </div>

      {error && <div className="banner error">{error}</div>}

      {/* Token Budget Gauge */}
      <div className="token-budget-bar">
        <div className="budget-label-row">
          <span>
            <strong>Ước lượng Token Ngữ Cảnh:</strong> {estimatedTokens} / {tokenBudget} tokens ({budgetRatio}%)
          </span>
          <span className="budget-tag">
            {budgetRatio < 75 ? "✓ Tối ưu hóa an toàn" : "⚠ Tiệm cận ngưỡng bão hòa"}
          </span>
        </div>
        <div className="budget-track">
          <div
            className={`budget-fill ${budgetRatio > 85 ? "fill-warning" : "fill-optimal"}`}
            style={{ width: `${budgetRatio}%` }}
          />
        </div>
      </div>

      {/* Sub-nav tabs */}
      <div className="semantic-tabs">
        <button
          className={activeTab === "pruned" ? "active" : ""}
          onClick={() => setActiveTab("pruned")}
        >
          📦 Thực Thể Đã Cắt Tỉa ({prunedData?.totalRetrievedItems || 0})
        </button>
        <button
          className={activeTab === "ranked" ? "active" : ""}
          onClick={() => setActiveTab("ranked")}
        >
          📊 Bảng Xếp Hạng Cosine Similarity ({queryResults.length})
        </button>
      </div>

      {activeTab === "pruned" ? (
        <div className="pruned-entities-grid">
          {/* Characters */}
          <div className="entity-category-card">
            <h4>Nhân vật trọng tâm ({prunedData?.relevantCharacters.length || 0})</h4>
            <div className="card-items">
              {prunedData?.relevantCharacters.map((c) => (
                <div key={c.id} className="entity-chip char-chip">
                  <strong>{c.name}</strong>
                  <small>({c.role} · {c.status})</small>
                  {c.visual_summary && <p>{c.visual_summary}</p>}
                </div>
              ))}
              {(!prunedData?.relevantCharacters || prunedData.relevantCharacters.length === 0) && (
                <p className="muted">Không có nhân vật phụ không liên quan được nạp vào context.</p>
              )}
            </div>
          </div>

          {/* Key Props */}
          <div className="entity-category-card">
            <h4>Đạo cụ then chốt ({prunedData?.relevantProps.length || 0})</h4>
            <div className="card-items">
              {prunedData?.relevantProps.map((p) => (
                <div key={p.id} className="entity-chip prop-chip">
                  <strong>{p.name}</strong>
                  <small>
                    Người giữ: {p.current_holder_id ? `char_${p.current_holder_id}` : "Chưa có"}
                  </small>
                  {p.description && <p>{p.description}</p>}
                </div>
              ))}
              {(!prunedData?.relevantProps || prunedData.relevantProps.length === 0) && (
                <p className="muted">Không có đạo cụ xung đột trong phân cảnh này.</p>
              )}
            </div>
          </div>

          {/* Locations & World Rules */}
          <div className="entity-category-card">
            <h4>Bối cảnh & Quy tắc thế giới ({ (prunedData?.relevantLocations.length || 0) + (prunedData?.relevantRules.length || 0) })</h4>
            <div className="card-items">
              {prunedData?.relevantLocations.map((l) => (
                <div key={l.id} className="entity-chip loc-chip">
                  <strong>📍 {l.name}</strong>
                  {l.visual_summary && <p>{l.visual_summary}</p>}
                </div>
              ))}
              {prunedData?.relevantRules.map((r, idx) => (
                <div key={idx} className="entity-chip rule-chip">
                  <strong>⚡ Quy tắc:</strong> {r}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="ranked-results-list">
          <table className="ranked-table">
            <thead>
              <tr>
                <th>Xếp hạng</th>
                <th>Loại thực thể</th>
                <th>Nội dung tri thức</th>
                <th>Cosine Sim</th>
                <th>Điểm tổng hợp</th>
              </tr>
            </thead>
            <tbody>
              {queryResults.map((item, idx) => (
                <tr key={item.id}>
                  <td>#{idx + 1}</td>
                  <td>
                    <span className={`entity-type-badge type-${item.entityType}`}>
                      {item.entityType}
                    </span>
                  </td>
                  <td>
                    <div className="memory-text-snippet">{item.text}</div>
                  </td>
                  <td>
                    <div className="sim-bar-cell">
                      <div className="sim-bar-bg">
                        <div
                          className="sim-bar-fill"
                          style={{ width: `${Math.round(item.similarity * 100)}%` }}
                        />
                      </div>
                      <span className="sim-val">{(item.similarity * 100).toFixed(1)}%</span>
                    </div>
                  </td>
                  <td>
                    <strong>{(item.compositeScore * 100).toFixed(1)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
