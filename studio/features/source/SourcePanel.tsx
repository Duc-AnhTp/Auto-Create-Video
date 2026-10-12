import { StoryImportResultSchema,type StoryImportResult } from "../../../src/contracts/studio-responses.js";
import type { StoryImportJob } from "../../../src/contracts/studio.js";




import { useState, useEffect, useRef } from "react";

import { api } from "../../shared/api/client.js";
export function SourcePanel({
  seriesId,
  run,
  onGenerated,
}: {
  seriesId: string;
  run: (fn: () => Promise<void>) => Promise<void>;
  onGenerated: (text: string, episode: number) => void;
}) {
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, [seriesId]);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [result, setResult] = useState<StoryImportResult|null>(null);
  const [ep, setEp] = useState(1);
  const [importStatus, setImportStatus] = useState("");

  return (
    <div className="source">
      <h2>Tiểu thuyết → Kế hoạch tập</h2>
      <input aria-label="Tên tác phẩm" placeholder="Tên tác phẩm" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input
        type="file"
        accept=".txt,.md"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void file.text().then(setText);
        }}
      />
      <textarea
        aria-label="Nội dung tiểu thuyết"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Nhập toàn văn tác phẩm…"
      />
      <button
        disabled={!seriesId || !text || !title || Boolean(importStatus)}
        onClick={() =>
          void run(async () => {
            const signal = lifetime.current!.signal;
            setResult(null);
            try {
              const accepted = await api<{ jobId: string }>(`/api/v1/series/${seriesId}/source`, { title, text, episodes: 2 }, signal);
              setImportStatus("Đang chờ phân tích…");
              while (!signal.aborted) {
                const { job } = await api<{ job: StoryImportJob }>(`/api/v1/story-imports/${accepted.jobId}`, undefined, signal);
                if (signal.aborted) return;
                if (job.status === "succeeded") {
                  setResult(StoryImportResultSchema.parse(job.result));
                  setImportStatus("");
                  return;
                }
                if (job.status === "failed") throw new Error(job.error?.message || "Không thể phân tích tác phẩm");
                setImportStatus(job.status === "running" ? "Đang phân tích tác phẩm…" : "Đang chờ phân tích…");
                await waitForPoll(signal);
              }
            } catch (error) {
              if (signal.aborted) return;
              setImportStatus("");
              throw error;
            }
          })
        }
      >
        {importStatus || "Nhập và lập kế hoạch 2 tập"}
      </button>
      {result && (
        <article>
          <p>{result.message}</p>
          <pre>{JSON.stringify(result.summary, null, 2)}</pre>
          <label>
            Tập{" "}
            <input
              type="number"
              min="1"
              max="2"
              value={ep}
              onChange={(e) => setEp(Number(e.target.value))}
            />
          </label>
          <button
            onClick={() =>
              void run(async () => {
                const signal = lifetime.current!.signal;
                const draft = await api<{text:string}>(`/api/v1/series/${seriesId}/screenplay`, {
                  planId: result.planId,
                  episodeNumber: ep,
                }, signal);
                if (signal.aborted) return;
                onGenerated(draft.text, ep);
              })
            }
          >
            Tạo kịch bản bản thử
          </button>
          <small>Phân tích và kịch bản bản thử dùng luật cục bộ, kết nối Story Bible SQLite.</small>
        </article>
      )}
    </div>
  );
}

function waitForPoll(signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) return resolve();
    const cancel = () => { clearTimeout(timer); signal.removeEventListener("abort", cancel); resolve(); };
    const timer = setTimeout(cancel, 1_000);
    signal.addEventListener("abort", cancel, { once: true });
  });
}

