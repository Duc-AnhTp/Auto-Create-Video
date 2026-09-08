import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { readFile, writeFile } from "node:fs/promises";
import { exec } from "node:child_process";
import { ScriptSchema, type Script } from "../render/script-schema.js";
import { normalizeVietnameseForTts } from "../tts/vietnamese-normalizer.js";
import { log } from "../utils/logger.js";

export interface ReviewServerOptions {
  scriptPath: string;
  initialScript?: Script;
  port?: number;
  autoOpen?: boolean;
  onReady?: (url: string) => void;
}

export type ReviewServerPromise = Promise<Script> & {
  ready: Promise<string>;
};

/**
 * Generates the HTML for the Review Micro-Dashboard.
 */
function renderDashboardHtml(script: Script, scriptPath: string): string {
  // Escape JSON to prevent script injection and premature tag termination
  const scenesJson = JSON.stringify(script.scenes).replace(/</g, "\\u003c");
  const metadataJson = JSON.stringify(script.metadata).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Auto News Video - Review & Edit Script</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #131b2e;
      --card-border: #1f2d4d;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
      --accent-hover: #0ea5e9;
      --success: #10b981;
      --success-hover: #059669;
      --danger: #ef4444;
      --danger-hover: #dc2626;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 24px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--card-border);
      margin-bottom: 24px;
    }
    .header h1 {
      font-size: 22px;
      font-weight: 700;
      color: var(--accent);
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .header .subtitle {
      font-size: 13px;
      color: var(--text-muted);
      margin-top: 4px;
    }
    .actions {
      display: flex;
      gap: 12px;
    }
    button {
      font-family: inherit;
      font-size: 14px;
      font-weight: 600;
      padding: 10px 18px;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      transition: all 0.15s ease;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .btn-approve {
      background: var(--success);
      color: #fff;
    }
    .btn-approve:hover { background: var(--success-hover); }
    .btn-normalize-all {
      background: var(--card-border);
      color: var(--text);
    }
    .btn-normalize-all:hover { background: #2d3f66; }
    .btn-cancel {
      background: transparent;
      border: 1px solid var(--card-border);
      color: var(--text-muted);
    }
    .btn-cancel:hover { background: #1a233a; color: var(--text); }

    .main-grid {
      display: grid;
      grid-template-columns: 320px 1fr;
      gap: 24px;
    }
    @media (max-width: 900px) {
      .main-grid { grid-template-columns: 1fr; }
    }
    .sidebar {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 20px;
      height: fit-content;
    }
    .sidebar h2 {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 16px;
      color: var(--text);
    }
    .meta-item {
      margin-bottom: 12px;
    }
    .meta-label {
      font-size: 12px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 2px;
    }
    .meta-value {
      font-size: 14px;
      font-weight: 500;
      word-break: break-word;
    }
    .scenes-container {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .scene-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 20px;
      position: relative;
    }
    .scene-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .scene-badge {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .badge {
      font-size: 12px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 6px;
      text-transform: uppercase;
    }
    .badge-id { background: #1e293b; color: var(--accent); }
    .badge-template { background: #312e81; color: #a5b4fc; }
    .voice-textarea {
      width: 100%;
      min-height: 85px;
      background: #0b1120;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 12px;
      color: #fff;
      font-family: inherit;
      font-size: 15px;
      line-height: 1.6;
      resize: vertical;
      margin-bottom: 10px;
    }
    .voice-textarea:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.2);
    }
    .scene-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 13px;
      color: var(--text-muted);
    }
    .btn-scene-norm {
      background: transparent;
      border: 1px solid var(--card-border);
      color: var(--accent);
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 12px;
      cursor: pointer;
    }
    .btn-scene-norm:hover { background: #1e293b; }
    .status-toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      padding: 12px 20px;
      border-radius: 8px;
      background: var(--card-bg);
      border: 1px solid var(--accent);
      color: #fff;
      font-size: 14px;
      display: none;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
      z-index: 1000;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>🎬 Duyệt & Tinh Chỉnh Kịch Bản Video</h1>
      <div class="subtitle">Kiểm tra phát âm tiếng Việt (TTS) và nội dung trước khi render</div>
    </div>
    <div class="actions">
      <button class="btn-cancel" onclick="cancelReview()">Hủy bỏ</button>
      <button class="btn-normalize-all" onclick="normalizeAll()">✨ Chuẩn hóa toàn bộ</button>
      <button class="btn-approve" onclick="approveScript()">✓ Duyệt & Bắt đầu Render</button>
    </div>
  </div>

  <div class="main-grid">
    <div class="sidebar">
      <h2>Thông tin bài viết</h2>
      <div class="meta-item">
        <div class="meta-label">Tiêu đề</div>
        <div class="meta-value" id="meta-title"></div>
      </div>
      <div class="meta-item">
        <div class="meta-label">Kênh phát</div>
        <div class="meta-value" id="meta-channel"></div>
      </div>
      <div class="meta-item">
        <div class="meta-label">Nguồn</div>
        <div class="meta-value" id="meta-source"></div>
      </div>
      <div class="meta-item">
        <div class="meta-label">Đường dẫn tệp</div>
        <div class="meta-value" style="font-size: 12px; color: var(--text-muted);">${scriptPath.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')}</div>
      </div>
      <div class="meta-item" style="margin-top: 20px; padding-top: 15px; border-top: 1px solid var(--card-border);">
        <div class="meta-label">Tổng số phân cảnh</div>
        <div class="meta-value" id="meta-scene-count"></div>
      </div>
      <div class="meta-item">
        <div class="meta-label">Ước tính thời lượng</div>
        <div class="meta-value" id="meta-estimated-dur" style="color: var(--accent); font-weight: 700;"></div>
      </div>
    </div>

    <div class="scenes-container" id="scenes-list">
      <!-- Injected by JavaScript -->
    </div>
  </div>

  <div id="toast" class="status-toast"></div>

  <script>
    let scriptData = {
      metadata: ${metadataJson},
      scenes: ${scenesJson}
    };

    function showToast(msg, duration = 3000) {
      const t = document.getElementById('toast');
      t.innerText = msg;
      t.style.display = 'block';
      setTimeout(() => { t.style.display = 'none'; }, duration);
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function renderSidebar() {
      document.getElementById('meta-title').innerText = scriptData.metadata.title;
      document.getElementById('meta-channel').innerText = scriptData.metadata.channel;
      document.getElementById('meta-source').innerText = scriptData.metadata.source.domain;
      document.getElementById('meta-scene-count').innerText = scriptData.scenes.length + ' cảnh';

      // Estimate duration: ~3 words per second + scene gaps
      const totalWords = scriptData.scenes.reduce((acc, s) => acc + s.voiceText.trim().split(/\\s+/).length, 0);
      const estSec = Math.round(totalWords / 2.8) + (scriptData.scenes.length * 0.3);
      document.getElementById('meta-estimated-dur').innerText = '~' + estSec + ' giây (' + totalWords + ' từ)';
    }

    function renderScenes() {
      const container = document.getElementById('scenes-list');
      container.innerHTML = '';

      scriptData.scenes.forEach((scene, index) => {
        const card = document.createElement('div');
        card.className = 'scene-card';
        const previewNorm = scene.voiceText !== (scene._phoneticPreview || '') && (scene._phoneticPreview)
          ? \`<div style="font-size:12px;color:var(--accent);margin-top:6px;background:#0d1527;padding:6px 10px;border-radius:6px;border:1px dashed var(--accent);">🔊 Xem âm vị TTS: \${escapeHtml(scene._phoneticPreview)}</div>\`
          : '';
        card.innerHTML = \`
          <div class="scene-header">
            <div class="scene-badge">
              <span class="badge badge-id">#\${escapeHtml(scene.id)} (\${escapeHtml(scene.type)})</span>
              <span class="badge badge-template">\${escapeHtml(scene.templateData.template)}</span>
            </div>
            <button class="btn-scene-norm" onclick="normalizeScene(\${index})">✨ Xem trước âm vị TTS</button>
          </div>
          <textarea class="voice-textarea" id="scene-text-\${index}" oninput="updateSceneText(\${index}, this.value)">\${escapeHtml(scene.voiceText)}</textarea>
          \${previewNorm}
          <div class="scene-footer">
            <span id="scene-stat-\${index}">\${scene.voiceText.trim().split(/\\s+/).length} từ</span>
            <span>Hiển thị visual: \${escapeHtml(scene.templateData.template)}</span>
          </div>
        \`;
        container.appendChild(card);
      });
      renderSidebar();
    }

    function updateSceneText(index, text) {
      scriptData.scenes[index].voiceText = text;
      const wordCount = text.trim() ? text.trim().split(/\\s+/).length : 0;
      document.getElementById(\`scene-stat-\${index}\`).innerText = wordCount + ' từ';
      renderSidebar();
    }

    async function normalizeScene(index) {
      const text = scriptData.scenes[index].voiceText;
      try {
        const res = await fetch('/api/normalize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        });
        const data = await res.json();
        if (data.normalized) {
          scriptData.scenes[index]._phoneticPreview = data.normalized;
          renderScenes();
          showToast(\`Đã tạo xem trước âm vị cảnh #\${scriptData.scenes[index].id}\`);
        }
      } catch (err) {
        showToast('Lỗi khi chuẩn hóa: ' + err.message);
      }
    }

    async function normalizeAll() {
      showToast('Đang chuẩn hóa toàn bộ các phân cảnh...');
      try {
        const promises = scriptData.scenes.map(async (scene) => {
          const res = await fetch('/api/normalize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: scene.voiceText })
          });
          const data = await res.json();
          if (data.normalized) {
            scene._phoneticPreview = data.normalized;
          }
        });
        await Promise.all(promises);
        renderScenes();
        showToast('Đã chuẩn hóa toàn bộ các phân cảnh!');
      } catch (err) {
        showToast('Lỗi khi chuẩn hóa toàn bộ: ' + err.message);
      }
    }

    async function approveScript() {
      showToast('Đang lưu kịch bản và khởi động render...', 10000);
      try {
        const res = await fetch('/api/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(scriptData)
        });
        const data = await res.json();
        if (data.success) {
          document.body.innerHTML = \`
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:80vh;text-align:center;">
              <h1 style="color:#10b981;font-size:32px;margin-bottom:16px;">✓ Đã duyệt kịch bản thành công!</h1>
              <p style="color:#94a3b8;font-size:16px;">Pipeline đang tiếp tục tạo giọng nói TTS và render video trong terminal...</p>
              <p style="color:#64748b;font-size:13px;margin-top:12px;">Bạn có thể đóng tab trình duyệt này.</p>
            </div>
          \`;
        } else {
          alert('Lỗi khi duyệt: ' + data.error);
        }
      } catch (err) {
        alert('Lỗi kết nối: ' + err.message);
      }
    }

    async function cancelReview() {
      if (!confirm('Bạn có chắc muốn hủy tiến trình tạo video này không?')) return;
      try {
        await fetch('/api/cancel', { method: 'POST' });
      } finally {
        window.close();
      }
    }

    renderScenes();
  </script>
</body>
</html>`;
}

const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * Parses JSON request body safely accumulating raw Buffer chunks with size limits.
 */
function parseJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    req.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_PAYLOAD_BYTES) {
        req.destroy(new Error("Payload Too Large: request body exceeds 5MB"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

/**
 * Starts the interactive review HTTP server.
 * Resolves with the updated script when approved, or rejects if cancelled.
 */
export function startReviewServer(options: ReviewServerOptions): ReviewServerPromise {
  const { scriptPath, initialScript, port = 3000, autoOpen = true, onReady } = options;

  let resolveReady!: (url: string) => void;
  const readyPromise = new Promise<string>((r) => {
    resolveReady = r;
  });

  const mainPromise = new Promise<Script>((resolve, reject) => {
    (async () => {
      let rawScript: Script;
      if (initialScript) {
        rawScript = initialScript;
      } else {
        try {
          const content = await readFile(scriptPath, "utf8");
          const parsedRaw = JSON.parse(content);
          if (parsedRaw.voice && !parsedRaw.voice.provider) {
            const defaultProv = process.env.TTS_PROVIDER === "elevenlabs" ? "elevenlabs" : "lucylab";
            parsedRaw.voice.provider = defaultProv;
          }
          if (parsedRaw.voice?.voiceId === "${VIETNAMESE_VOICEID}" || parsedRaw.voice?.voiceId === "${VOICE_ID}") {
            const isEleven = parsedRaw.voice?.provider === "elevenlabs";
            const envVoice = isEleven
              ? (process.env.ELEVENLABS_VOICE_ID || "default-voice")
              : (process.env.VIETNAMESE_VOICEID || process.env.ELEVENLABS_VOICE_ID || "default-voice");
            parsedRaw.voice.voiceId = envVoice;
          }
          rawScript = ScriptSchema.parse(parsedRaw);
        } catch (err) {
          reject(new Error(`Failed to load script at ${scriptPath}: ${err}`));
          return;
        }
      }

      const sockets = new Set<Socket>();
      let isClosing = false;

    let activeServer: Server | null = null;

    const teardownServer = (onDone: () => void) => {
      if (isClosing) return;
      isClosing = true;
      setTimeout(() => {
        if (activeServer) {
          if (typeof (activeServer as any).closeAllConnections === "function") {
            (activeServer as any).closeAllConnections();
          } else {
            for (const socket of sockets) {
              socket.destroy();
            }
          }
          try {
            activeServer.close(() => onDone());
          } catch {
            onDone();
          }
        } else {
          onDone();
        }
      }, 100);
    };

    const requestHandler = async (req: IncomingMessage, res: ServerResponse) => {
      const url = req.url || "/";
      const method = req.method || "GET";

      // Restrict CORS to localhost only (no arbitrary network access)
      const origin = req.headers.origin;
      if (origin && (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:"))) {
        res.setHeader("Access-Control-Allow-Origin", origin);
      }
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // 1. Dashboard UI
      if (url === "/" && method === "GET") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderDashboardHtml(rawScript, scriptPath));
        return;
      }

      // 2. API: Normalize phonetic text
      if (url === "/api/normalize" && method === "POST") {
        try {
          const body = await parseJsonBody(req);
          const normalized = normalizeVietnameseForTts(body.text || "");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ normalized }));
        } catch (err: any) {
          if (!res.destroyed && !res.writableEnded) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err.message }));
          }
        }
        return;
      }

      // 3. API: Approve & Save script
      if (url === "/api/approve" && method === "POST") {
        try {
          const body = await parseJsonBody(req);
          const validated = ScriptSchema.parse({
            ...rawScript,
            metadata: body.metadata,
            scenes: body.scenes,
          });

          // Read original script from disk to preserve template voiceId placeholders (${VIETNAMESE_VOICEID})
          let diskVoiceConfig = rawScript.voice;
          try {
            const diskContent = await readFile(scriptPath, "utf8");
            const diskJson = JSON.parse(diskContent);
            if (diskJson.voice) {
              diskVoiceConfig = diskJson.voice;
            }
          } catch {}

          const diskScript = {
            ...validated,
            ...(diskVoiceConfig ? { voice: diskVoiceConfig } : {}),
          };

          await writeFile(scriptPath, JSON.stringify(diskScript, null, 2), "utf8");
          log.info("Review approved: script.json updated successfully.");

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));

          teardownServer(() => resolve(validated));
        } catch (err: any) {
          if (!res.destroyed && !res.writableEnded) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err.message }));
          }
        }
        return;
      }

      // 4. API: Cancel review
      if (url === "/api/cancel" && method === "POST") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ cancelled: true }));
        teardownServer(() => reject(new Error("Review was cancelled by the user.")));
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    };

    // Auto port fallback if current port is occupied (e.g., EADDRINUSE)
    let currentPort = port;
    const maxPortAttempts = 10;
    let attempts = 0;

    const tryListen = (p: number) => {
      const s = createServer(requestHandler);
      activeServer = s;

      s.on("connection", (socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
      });

      s.on("error", (err: any) => {
        if (err.code === "EADDRINUSE" && attempts < maxPortAttempts) {
          attempts++;
          currentPort++;
          log.warn(`Port in use, trying next port http://127.0.0.1:${currentPort}...`);
          setTimeout(() => tryListen(currentPort), 100);
        } else {
          reject(err);
        }
      });

      // Bind strictly to 127.0.0.1 (localhost only)
      s.listen(p, "127.0.0.1", () => {
        const serverUrl = `http://127.0.0.1:${p}`;
        log.info(`\n👉 Web Review Dashboard is running at: ${serverUrl}`);
        log.info(`👉 Mở trình duyệt để xem, sửa kịch bản và bấm 'Duyệt & Bắt đầu Render'...\n`);

        resolveReady(serverUrl);
        if (onReady) onReady(serverUrl);

        if (autoOpen) {
          // Cross-platform open browser
          const cmd =
            process.platform === "win32"
              ? `start "" "${serverUrl}"`
              : process.platform === "darwin"
                ? `open "${serverUrl}"`
                : `xdg-open "${serverUrl}"`;
          exec(cmd, () => {});
        }
      });
    };

    tryListen(currentPort);
    })().catch(reject);
  });

  (mainPromise as any).ready = readyPromise;
  return mainPromise as ReviewServerPromise;
}
