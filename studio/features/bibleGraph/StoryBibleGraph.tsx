import React, { useState } from "react";
import type { NarrativeGraphData, NarrativeNode } from "../../../src/contracts/studio-features.js";

interface StoryBibleGraphProps {
  seriesId: string;
  data: NarrativeGraphData | null;
  onRefresh: () => void;
}

export function StoryBibleGraph({ seriesId, data, onRefresh }: StoryBibleGraphProps) {
  const [selectedNode, setSelectedNode] = useState<NarrativeNode | null>(null);
  const [activeTab, setActiveTab] = useState<"graph" | "props" | "chekhov">("graph");

  const nodes = data?.nodes || [];
  const edges = data?.edges || [];
  const propLedger = data?.propLedger || [];
  const chekhovGuns = data?.chekhovGuns || [];

  // Compute 2D node coordinates in a circular/force layout
  const width = 800;
  const height = 520;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(centerX, centerY) - 80;

  const positionedNodes = nodes.map((node, index) => {
    // Separate by type into concentric rings or radial sectors
    let angle = (index / Math.max(1, nodes.length)) * 2 * Math.PI;
    let r = radius;
    if (node.type === "character") r = radius * 0.75;
    else if (node.type === "prop") r = radius * 0.95;
    else if (node.type === "location") r = radius * 0.45;

    return {
      ...node,
      x: centerX + r * Math.cos(angle),
      y: centerY + r * Math.sin(angle),
    };
  });

  const nodeMap = new Map(positionedNodes.map((n) => [n.id, n]));

  const getNodeColor = (type: string) => {
    switch (type) {
      case "character":
        return "#06b6d4"; // cyan
      case "location":
        return "#6366f1"; // indigo
      case "prop":
        return "#f59e0b"; // amber
      default:
        return "#94a3b8";
    }
  };

  const getGunStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case "planted":
        return <span className="gun-badge planted">🌱 Đã cài cắm (Planted)</span>;
      case "active":
        return <span className="gun-badge active">⚡ Đang hoạt động (Active)</span>;
      case "dormant":
        return <span className="gun-badge dormant">💤 Ngủ đông (Dormant)</span>;
      case "fired":
        return <span className="gun-badge fired">💥 Đã phát nổ (Fired)</span>;
      case "resolved":
        return <span className="gun-badge resolved">✓ Đã giải quyết (Resolved)</span>;
      default:
        return <span className="gun-badge">{status}</span>;
    }
  };

  return (
    <div className="story-bible-suite">
      {/* Sub-navigation bar */}
      <div className="bible-suite-nav">
        <div className="suite-title">
          <h3>HỆ TRI THỨC CỐT TRUYỆN (STORY BIBLE & NARRATIVE LEDGER)</h3>
          <span>Series: {seriesId}</span>
        </div>

        <div className="suite-tabs">
          <button
            className={`btn-tab ${activeTab === "graph" ? "active" : ""}`}
            onClick={() => setActiveTab("graph")}
          >
            🕸️ Đồ Thị Quan Hệ (Relational Graph)
          </button>
          <button
            className={`btn-tab ${activeTab === "props" ? "active" : ""}`}
            onClick={() => setActiveTab("props")}
          >
            🗝️ Sổ Cái Đạo Cụ ({propLedger.length})
          </button>
          <button
            className={`btn-tab ${activeTab === "chekhov" ? "active" : ""}`}
            onClick={() => setActiveTab("chekhov")}
          >
            🎯 Súng Chekhov ({chekhovGuns.length})
          </button>
          <button className="btn-sm" onClick={onRefresh} title="Tải lại từ SQLite">
            🔄 Làm mới
          </button>
        </div>
      </div>

      {/* View 1: Relational SVG Graph */}
      {activeTab === "graph" && (
        <div className="graph-view-container">
          <div className="svg-canvas-wrapper">
            <svg viewBox={`0 0 ${width} ${height}`} className="narrative-svg">
              <defs>
                <marker
                  id="arrow"
                  viewBox="0 0 10 10"
                  refX="18"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" />
                </marker>
              </defs>

              {/* Background circular guide rings */}
              <circle cx={centerX} cy={centerY} r={radius * 0.45} fill="none" stroke="rgba(255,255,255,0.03)" strokeDasharray="4 4" />
              <circle cx={centerX} cy={centerY} r={radius * 0.75} fill="none" stroke="rgba(255,255,255,0.03)" strokeDasharray="4 4" />
              <circle cx={centerX} cy={centerY} r={radius * 0.95} fill="none" stroke="rgba(255,255,255,0.03)" strokeDasharray="4 4" />

              {/* Relation Edges */}
              {edges.map((edge, idx) => {
                const src = nodeMap.get(edge.source);
                const tgt = nodeMap.get(edge.target);
                if (!src || !tgt) return null;
                const isSelected = selectedNode?.id === src.id || selectedNode?.id === tgt.id;
                const strokeColor = edge.relation === "held_by" ? "#f59e0b" : edge.sentiment === "negative" ? "#ef4444" : "#64748b";

                return (
                  <g key={idx}>
                    <line
                      x1={src.x}
                      y1={src.y}
                      x2={tgt.x}
                      y2={tgt.y}
                      stroke={strokeColor}
                      strokeWidth={isSelected ? 2.5 : 1.2}
                      strokeOpacity={isSelected ? 0.9 : 0.45}
                      strokeDasharray={edge.relation === "held_by" ? "5 3" : undefined}
                      markerEnd="url(#arrow)"
                    />
                    <text
                      x={((src.x || 0) + (tgt.x || 0)) / 2}
                      y={((src.y || 0) + (tgt.y || 0)) / 2 - 4}
                      fill="#94a3b8"
                      fontSize="9"
                      fontFamily="monospace"
                      textAnchor="middle"
                    >
                      {edge.relation}
                    </text>
                  </g>
                );
              })}

              {/* Entity Nodes */}
              {positionedNodes.map((node) => {
                const color = getNodeColor(node.type);
                const isSelected = selectedNode?.id === node.id;

                return (
                  <g
                    key={node.id}
                    className="graph-node-group"
                    onClick={() => setSelectedNode(node)}
                    style={{ cursor: "pointer" }}
                  >
                    {/* Outer glow circle */}
                    {isSelected && (
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r={24}
                        fill="none"
                        stroke={color}
                        strokeWidth="3"
                        strokeOpacity="0.8"
                        className="pulse-circle"
                      />
                    )}

                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={node.type === "character" ? 17 : node.type === "prop" ? 14 : 12}
                      fill="#121826"
                      stroke={color}
                      strokeWidth={isSelected ? 3 : 1.8}
                    />

                    {/* Node icon label */}
                    <text
                      x={node.x}
                      y={(node.y || 0) + 4}
                      fill={color}
                      fontSize="11"
                      textAnchor="middle"
                      fontWeight="bold"
                    >
                      {node.type === "character" ? "👤" : node.type === "prop" ? "🗝️" : "📍"}
                    </text>

                    {/* Node Text */}
                    <text
                      x={node.x}
                      y={(node.y || 0) + 26}
                      fill="#f8fafc"
                      fontSize="11"
                      fontFamily="Inter, sans-serif"
                      textAnchor="middle"
                      fontWeight={isSelected ? "bold" : "normal"}
                    >
                      {node.label}
                    </text>
                  </g>
                );
              })}
            </svg>

            <div className="graph-legend">
              <span className="legend-item"><span className="legend-dot cyan" /> Nhân vật (Character)</span>
              <span className="legend-item"><span className="legend-dot indigo" /> Bối cảnh (Location)</span>
              <span className="legend-item"><span className="legend-dot amber" /> Đạo cụ chính (Key Prop)</span>
            </div>
          </div>

          {/* Node Inspector Drawer */}
          <div className="node-inspector-drawer">
            {selectedNode ? (
              <div className="inspector-card">
                <div className="inspector-header">
                  <span className="node-type-pill" style={{ borderColor: getNodeColor(selectedNode.type) }}>
                    {selectedNode.type.toUpperCase()}
                  </span>
                  <h4>{selectedNode.label}</h4>
                  <small>ID: {selectedNode.id}</small>
                </div>

                {selectedNode.image && (
                  <div className="inspector-img-box">
                    <img src={`/api/media/stream?path=${encodeURIComponent(selectedNode.image)}`} alt={selectedNode.label} />
                  </div>
                )}

                <div className="inspector-details">
                  <p><strong>Mô tả:</strong> {selectedNode.details || "Chưa có mô tả chi tiết."}</p>
                  {selectedNode.status && (
                    <p><strong>Trạng thái:</strong> <code>{selectedNode.status}</code></p>
                  )}
                </div>

                <div className="inspector-connections">
                  <strong>Các mối liên kết:</strong>
                  <ul>
                    {edges
                      .filter((e) => e.source === selectedNode.id || e.target === selectedNode.id)
                      .map((e, idx) => (
                        <li key={idx}>
                          <code>{e.source}</code> ➔ <em>{e.relation}</em> ➔ <code>{e.target}</code>
                        </li>
                      ))}
                  </ul>
                </div>
              </div>
            ) : (
              <div className="inspector-empty">
                <span>🔍</span>
                <p>Nhấp vào bất kỳ thực thể nào trên bản đồ để kiểm tra lý lịch và liên kết.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* View 2: Prop Transfer Provenance Ledger */}
      {activeTab === "props" && (
        <div className="prop-ledger-view">
          <h4>SỔ CÁI CHUYỂN GIAO ĐẠO CỤ QUA CÁC TẬP (PROP TRANSFER PROVENANCE)</h4>
          <p className="caption">
            Bảo vệ tính nhất quán thực tế: Đạo cụ chỉ có thể được sử dụng bởi người đang nắm giữ hợp lệ.
          </p>

          <table className="nle-table">
            <thead>
              <tr>
                <th>Đạo cụ</th>
                <th>Người giữ trước</th>
                <th>Người nhận mới</th>
                <th>Tập phim</th>
                <th>Thời điểm</th>
              </tr>
            </thead>
            <tbody>
              {propLedger.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty-cell">Chưa ghi nhận sự kiện chuyển giao đạo cụ nào.</td>
                </tr>
              ) : (
                propLedger.map((row, idx) => (
                  <tr key={idx}>
                    <td>
                      <strong>{row.propName}</strong> <br />
                      <small>{row.propId}</small>
                    </td>
                    <td><code>{row.fromHolder || "None (Khởi tạo)"}</code></td>
                    <td><strong style={{ color: "#10b981" }}>{row.toHolder || "N/A"}</strong></td>
                    <td>Tập {row.episodeNumber}</td>
                    <td><small>{row.createdAt ? new Date(row.createdAt).toLocaleString("vi-VN") : "--"}</small></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* View 3: Chekhov's Gun Lifecycle Tracker */}
      {activeTab === "chekhov" && (
        <div className="chekhov-guns-view">
          <h4>THEO DÕI VÒNG ĐỜI SÚNG CHEKHOV (NARRATIVE CAUSALITY)</h4>
          <p className="caption">
            Quy tắc điện ảnh Anton Chekhov: Mọi chi tiết hoặc vũ khí được cài cắm ở màn 1 phải được phát nổ ở màn cuối.
          </p>

          <div className="chekhov-grid">
            {chekhovGuns.length === 0 ? (
              <p className="empty-cell">Chưa có chi tiết Súng Chekhov nào được đăng ký trong Story Bible.</p>
            ) : (
              chekhovGuns.map((gun) => (
                <div className={`chekhov-card ${gun.isDormant ? "dormant-alert" : ""}`} key={gun.id}>
                  <div className="chekhov-card-head">
                    <span className="gun-id">{gun.id}</span>
                    {getGunStatusBadge(gun.status)}
                  </div>

                  <p className="gun-desc">{gun.description || gun.name}</p>

                  <div className="gun-timeline-steps">
                    <span>Cài cắm: Tập {gun.plantedEpisode}</span>
                    {gun.payoffEpisode ? (
                      <span className="payoff-text">💥 Phát nổ: Tập {gun.payoffEpisode}</span>
                    ) : (
                      <span className="unresolved-text">⏳ Chưa giải quyết</span>
                    )}
                  </div>

                  {gun.isDormant && (
                    <div className="dormancy-warning-box">
                      ⚠️ <strong>Cảnh Báo Ngủ Đông:</strong> Chi tiết này chưa được kích hoạt trong hơn 2 tập gần nhất! Hãy đưa vào kịch bản tập tiếp theo.
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
