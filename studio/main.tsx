import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { StudioJob } from "../src/server/studio-contract";
import type { UnifiedTimeline } from "../src/series/timeline-schema";
import "./style.css";

async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : data.error?.message || "Không thể thực hiện yêu cầu");
  return data;
}
const media = (path: string) => `/api/media/stream?path=${encodeURIComponent(path)}`;
const statusLabel: Record<string, string> = { queued: "Đang chờ", running: "Đang chạy", paused: "Tạm dừng", needs_review: "Cần kiểm tra", succeeded: "Hoàn tất", failed: "Thất bại", cancelled: "Đã hủy" };
function Meter({ path }: { path: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [level, setLevel] = useState<number | null>(null);
  useEffect(() => {
    const element = ref.current!;
    let context: AudioContext | undefined, frame = 0;
    const start = () => {
      if (context) { void context.resume(); return; }
      context = new AudioContext();
      const source = context.createMediaElementSource(element), analyser = context.createAnalyser();
      analyser.fftSize = 256; source.connect(analyser); analyser.connect(context.destination);
      const values = new Uint8Array(analyser.fftSize);
      const sample = () => {
        analyser.getByteTimeDomainData(values);
        const rms = Math.sqrt(values.reduce((sum, v) => sum + ((v - 128) / 128) ** 2, 0) / values.length);
        setLevel(element.paused ? null : Math.min(1, rms * 4)); frame = requestAnimationFrame(sample);
      }; sample();
    };
    element.addEventListener("play", start);
    return () => { cancelAnimationFrame(frame); element.removeEventListener("play", start); void context?.close(); };
  }, [path]);
  return <div className="stem"><audio ref={ref} controls src={media(path)} /><meter min={0} max={1} value={level ?? 0} aria-label="Âm lượng đang phát"/><small>{level === null ? "Chưa phát âm thanh" : "Âm lượng đang phát"}</small></div>;
}
function App() {
  const [series, setSeries] = useState<any[]>([]), [seriesId, setSeriesId] = useState("");
  const [episode, setEpisode] = useState(1), [text, setText] = useState(""), [saved, setSaved] = useState(""), [version, setVersion] = useState(0);
  const [jobs, setJobs] = useState<StudioJob[]>([]), [bible, setBible] = useState<any>({});
  const [timeline, setTimeline] = useState<UnifiedTimeline | null>(null), [files, setFiles] = useState<string[]>([]);
  const [provider, setProvider] = useState("mock"), [budget, setBudget] = useState("");
  const [resolution, setResolution] = useState<"1080p" | "720p">("1080p");
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState("script"), [selected, setSelected] = useState("");
  const [providers, setProviders] = useState<any[]>([]), [changes, setChanges] = useState<Record<string,string>>({});
  const [newTitle,setNewTitle]=useState(""),[newId,setNewId]=useState(""),[creating,setCreating]=useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const video = useRef<HTMLVideoElement>(null);
  const dirty = text !== saved;
  const prefix = `/api/v1/series/${seriesId}/episodes/${episode}`;
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(""); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const loadSeries = async () => { const result = await api("/api/series/list"); setSeries(result.series); return result.series; };
  const loadArtifacts = async () => { if (!seriesId) return; const result = await api(`${prefix}/artifacts`); setTimeline(result.timeline); setFiles(result.files); };
  useEffect(() => { void run(async () => { const all = await loadSeries(); if (all.length) setSeriesId(all[0].id); const models = await api("/api/settings/models"); setProviders(models.providers); }); }, []);
  useEffect(() => {
    const events = new EventSource("/api/v1/events");
    events.addEventListener("snapshot", event => setJobs(JSON.parse((event as MessageEvent).data).jobs));
    events.addEventListener("job", event => { const job = JSON.parse((event as MessageEvent).data) as StudioJob; setJobs(old => [job, ...old.filter(j => j.id !== job.id)].slice(0,200)); });
    void api("/api/v1/jobs").then(result => setJobs(result.jobs)).catch(e => setError(e.message));
    return () => events.close();
  }, []);
  useEffect(() => {
    if (!seriesId) return;
    let active = true;
    void Promise.all([api(`${prefix}/draft`), api(`/api/series/${seriesId}/bible`), api(`${prefix}/artifacts`)])
      .then(([draft, data, artifacts]) => { if (!active) return; setText(draft.text); setSaved(draft.text); setVersion(draft.version); setBible(data); setTimeline(artifacts.timeline); setFiles(artifacts.files); setHistory([]); })
      .catch(e => { if(active) setError(e.message); });
    return () => { active = false; };
  }, [seriesId, episode]);
  const latest = jobs.find(j => j.request.seriesId === seriesId && j.request.episodeNumber === episode);
  useEffect(() => { if (latest?.result) void loadArtifacts().catch(e => setError(e.message)); }, [latest?.updatedAt]);
  useEffect(() => { const warn = (e: BeforeUnloadEvent) => { if(dirty) {e.preventDefault(); e.returnValue="";} }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  const save = async () => { const draft = await api(`${prefix}/draft`, { baseVersion: version, text }); setVersion(draft.version); setSaved(draft.text); return draft; };
  const switchProject = (id: string, number = 1) => { if (dirty) { setError("Hãy lưu bản nháp trước khi đổi dự án hoặc tập."); return; } setSeriesId(id); setEpisode(number); };
  const produce = () => run(async () => { await save(); await api("/api/v1/jobs", { seriesId, episodeNumber: episode, rawScreenplay: text, mode: provider === "mock" ? "mock" : "production", provider, exportResolution: resolution, ...(budget ? { budgetCapUsd: Number(budget) } : {}), maxReRolls: 2, resume: true }); setNotice("Đã xếp hàng sản xuất. Có thể theo dõi bên dưới."); });
  const renderedJob = jobs.find(j => j.request.seriesId === seriesId && j.request.episodeNumber === episode && j.result?.videoPath);
  const mainVideo = renderedJob?.result?.videoPath || files.find(f => /[\\/]video\.mp4$/.test(f));
  const previewStale = dirty || Boolean(renderedJob ? renderedJob.request.rawScreenplay !== text : (mainVideo && text !== saved));
  const selectedShot = timeline?.videoTrack.find(s => s.shotId === selected);
  const editShot = (change: Record<string, unknown>, direction = 0) => run(async () => {
    const result = await api(`${prefix}/edit-shot`, { baseVersion: version, text, shotId: selected, change, direction });
    setHistory(h => [...h, text]); setText(result.text); setNotice("Đã cập nhật kịch bản. Lưu và dựng lại để cập nhật preview.");
  });
  return <div className="app">
    <header><div className="brand">◈ <strong>STUDIO</strong><span>PHÒNG SẢN XUẤT PHIM</span></div><select aria-label="Dự án" value={seriesId} onChange={e => switchProject(e.target.value)}><option value="">Chọn dự án</option>{series.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select><label>Tập <input className="episode" type="number" min="1" value={episode} onChange={e=>switchProject(seriesId, Math.max(1,Number(e.target.value)))}/></label><button onClick={()=>setPanel(panel === "settings" ? "script" : "settings")}>Cấu hình</button><a href="/studio-legacy">Studio cũ ↗</a></header>
    {(error || notice) && <div role={error ? "alert" : "status"} className={error ? "banner error" : "banner"}>{error || notice}<button onClick={()=>{setError("");setNotice("");}}>×</button></div>}
    <main><aside className="library"><h2>THƯ VIỆN DỰ ÁN</h2><button onClick={()=>setCreating(!creating)}>＋ Dự án mới</button>{creating&&<form onSubmit={e=>{e.preventDefault();void run(async()=>{await api("/api/series/init",{id:newId,title:newTitle,aspect_ratio:"16:9",fps:30});await loadSeries();switchProject(newId);setCreating(false);});}}><label>Tên dự án<input aria-label="Tên dự án mới" required value={newTitle} onChange={e=>setNewTitle(e.target.value)}/></label><label>Mã dự án<input aria-label="Mã dự án mới" required pattern="[a-zA-Z0-9_-]+" value={newId} onChange={e=>setNewId(e.target.value)}/></label><button type="submit">Tạo dự án</button></form>}<h3>Nhân vật</h3>{(bible.characters || []).map((c:any)=><article key={c.id}><strong>{c.name}</strong><small>{c.visual_summary || "Chưa có mô tả hình ảnh"}</small></article>)}<h3>Bối cảnh</h3>{(bible.locations||[]).map((l:any)=><article key={l.id}>{l.name}</article>)}<h3>Dữ liệu</h3><button disabled={!seriesId} onClick={()=>void run(async()=>{const snap=await api(`/api/v1/series/${seriesId}/backups`,{});setNotice(`Đã sao lưu dự án: ${snap.id}`);})}>Sao lưu dự án</button><button disabled={!seriesId} onClick={()=>void run(async()=>{const usage=await api(`/api/v1/series/${seriesId}/usage`);setNotice(`${usage.files} tệp · ${(usage.bytes/1024**3).toFixed(2)} GiB. Media đang dùng được giữ nguyên.`);})}>Dung lượng</button><h3>Đầu ra</h3>{files.map(f=><a className="file" key={f} href={media(f)} download>{f.split(/[\\/]/).pop()}</a>)}{!files.length&&<p className="muted">Chưa có bản dựng.</p>}</aside>
    <section className="workspace"><nav>{[["script","Kịch bản"],["source","Tiểu thuyết"],["preview","Bản dựng"],["settings","Mô hình & giọng"]].map(([id,label])=><button key={id} className={panel===id?"active":""} onClick={()=>setPanel(id)}>{label}</button>)}</nav>
      {panel==="settings" ? <div className="settings">{providers.map(p=><article key={p.id}><h3>{p.name}</h3><small>{p.isConfigured?"Đã cấu hình · chưa xác minh kết nối":"Chưa cấu hình"}</small>{p.fields.map((f:any)=><label key={f.envKey}>{f.label}<input type={f.type==="password"?"password":"text"} placeholder={f.type==="password"?"Nhập để thay khóa hiện có":f.value||f.placeholder} value={changes[f.envKey]??""} onChange={e=>setChanges({...changes,[f.envKey]:e.target.value})}/></label>)}</article>)}<button disabled={busy} onClick={()=>void run(async()=>{await api("/api/settings/models",{updates:changes});setChanges({});setNotice("Đã lưu cấu hình. Công việc tiếp theo sẽ dùng cấu hình mới.");})}>Lưu cấu hình</button></div>
      : panel==="source" ? <SourcePanel seriesId={seriesId} run={run} onGenerated={(value,ep)=>{void run(async()=>{if(dirty)await save();const dest=`/api/v1/series/${seriesId}/episodes/${ep}/draft`;const current=await api(dest);const next=await api(dest,{baseVersion:current.version,text:value});setEpisode(ep);setText(next.text);setSaved(next.text);setVersion(next.version);setPanel("script");});}}/>
      : panel==="preview" ? <div className="preview">{mainVideo?<><video ref={video} controls src={media(mainVideo)}/><p>{renderedJob?.result?.isMock?"BẢN THỬ · Media mô phỏng":"Bản dựng gần nhất"}{previewStale?" · Kịch bản có thay đổi chưa dựng":""}</p></>:<div className="empty"><span>◈</span><h2>Chưa có bản dựng</h2><p>Nhập kịch bản và chạy bản thử để bắt đầu.</p></div>}</div>
      : <div className="editor"><div className="toolbar"><span>KỊCH BẢN PHÂN CẢNH <small>Phiên bản {version}{dirty?" · Chưa lưu":" · Đã lưu"}</small></span><button disabled={!history.length} onClick={()=>{setText(history[history.length-1]);setHistory(history.slice(0,-1));}}>Hoàn tác</button><button disabled={!seriesId||busy} onClick={()=>void run(async()=>{await save();setNotice("Đã lưu bản nháp.");})}>Lưu</button></div><textarea aria-label="Kịch bản phân cảnh" value={text} onChange={e=>setText(e.target.value)} placeholder="Dán kịch bản phân cảnh hoặc nhập tiểu thuyết để tạo kịch bản…" spellCheck={false}/></div>}
      <div className="production"><select aria-label="Provider video" value={provider} onChange={e=>setProvider(e.target.value)}>{["mock","local_comfyui","api_kling","api_runway","api_veo","api_seedance"].map(p=><option key={p}>{p}</option>)}</select><select aria-label="Độ phân giải xuất" value={resolution} onChange={e=>setResolution(e.target.value as any)}><option value="1080p">1080p Master</option><option value="720p">720p Bản thử</option></select><input aria-label="Trần ngân sách USD" type="number" min="0.01" step="0.01" placeholder="Trần ngân sách USD" value={budget} onChange={e=>setBudget(e.target.value)}/><button className="primary" disabled={busy||!seriesId||!text.trim()} onClick={produce}>{provider==="mock"?"▶ Tạo bản thử":"▶ Sản xuất"}</button></div>
    </section>
    <aside className="inspector"><h2>THUỘC TÍNH & CHẤT LƯỢNG</h2>{selectedShot?<article><h3>{selectedShot.shotId}</h3><p>{selectedShot.visualPrompt}</p><label>Thời lượng (giây)<input key={selectedShot.shotId} type="number" step="0.1" min="0.1" max="30" defaultValue={selectedShot.durationSec} onBlur={e=>{if(Number(e.target.value)!==selectedShot.durationSec)void editShot({durationSec:Number(e.target.value)});}}/></label><div className="actions"><button onClick={()=>void editShot({},-1)}>← Đổi thứ tự</button><button onClick={()=>void editShot({},1)}>Đổi thứ tự →</button></div><small>Sửa shot cập nhật kịch bản; dựng lại sẽ tính lại timeline và phần media phụ thuộc.</small></article>:<p className="muted">Chọn shot trên timeline để xem chi tiết.</p>}<h3>Hàng đợi sản xuất</h3>{jobs.filter(j=>j.request.seriesId===seriesId).map(j=><article className={`job ${j.status}`} key={j.id}><strong>Tập {j.request.episodeNumber} · {j.control==="cancel" && j.status!=="cancelled" ? "Đang chờ hủy" : statusLabel[j.status]}</strong><small>{j.request.provider} · Trần {j.request.budgetCapUsd??0} USD</small><progress max={j.progress?.total||8} value={j.progress?.step||0}/><p>{j.progress?.message}</p>{j.error&&<p className="error-text">{j.error.message}</p>}<div className="actions">{(["queued","running"].includes(j.status)?["pause","cancel"]:j.status==="paused"?["resume","cancel"]:["failed","needs_review","cancelled"].includes(j.status)?["retry"]:[]).map(a=><button key={a} disabled={busy || (j.control==="cancel" && j.status!=="cancelled")} onClick={()=>void run(async()=>{await api(`/api/v1/jobs/${j.id}/${a}`,{});})}>{{pause:"Dừng",resume:"Tiếp tục",cancel:"Hủy",retry:"Thử lại"}[a]}</button>)}</div></article>)}</aside></main>
    <section className="timeline"><div className="toolbar"><h2>TIMELINE ĐỒNG BỘ</h2><span>{timeline?`${timeline.fps} FPS · ${timeline.videoTrack.length} shots`:"Chưa có timeline"}</span><button onClick={()=>void run(loadArtifacts)}>Làm mới</button></div>{timeline ? <div className="tracks">{([['Video',timeline.videoTrack],['Thoại',timeline.dialogueTrack],['SFX',timeline.sfxTrack],['Ambience',timeline.ambienceTrack],['Nhạc',timeline.bgmTrack?[timeline.bgmTrack]:[]],['Phụ đề',timeline.subtitleTrack]] as [string,any[]][]).map(([name,cues])=><div className="track" key={name}><label>{name}</label><div className="track-body">{cues.map((cue,index)=><button key={index} className={selected===cue.shotId?"clip selected":"clip"} style={{left:`${cue.startSec*14}px`,width:`${Math.max(26,(cue.durationSec||1)*14)}px`}} title={cue.visualPrompt||cue.subtitleText||cue.name} onClick={()=>{setSelected(cue.shotId||""); if(video.current)video.current.currentTime=cue.startSec;}}>{cue.shotId||cue.name||name}</button>)}</div></div>)}</div>:<p className="muted">Timeline sẽ xuất hiện sau khi tạo bản thử hoặc sản xuất tập phim.</p>}</section>
    <footer>{Object.entries(timeline?.stems||{}).filter(([,p])=>typeof p==="string"&&p).map(([name,path])=><div key={name}><h3>{name}</h3><Meter key={String(path)} path={String(path)}/></div>)}</footer>
  </div>;
}
function SourcePanel({ seriesId, run, onGenerated }: {seriesId:string;run:(fn:()=>Promise<void>)=>Promise<void>;onGenerated:(text:string,episode:number)=>void}) {
  const [text,setText]=useState(""),[title,setTitle]=useState(""),[result,setResult]=useState<any>(null),[ep,setEp]=useState(1);
  return <div className="source"><h2>Tiểu thuyết → Kế hoạch tập</h2><input aria-label="Tên tác phẩm" placeholder="Tên tác phẩm" value={title} onChange={e=>setTitle(e.target.value)}/><input type="file" accept=".txt,.md" onChange={e=>{const file=e.target.files?.[0];if(file)void file.text().then(setText);}}/><textarea aria-label="Nội dung tiểu thuyết" value={text} onChange={e=>setText(e.target.value)} placeholder="Nhập toàn văn tác phẩm…"/><button disabled={!seriesId||!text||!title} onClick={()=>void run(async()=>setResult(await api(`/api/v1/series/${seriesId}/source`,{title,text,episodes:2})))}>Nhập và lập kế hoạch 2 tập</button>{result&&<article><p>{result.message}</p><pre>{JSON.stringify(result.summary,null,2)}</pre><label>Tập <input type="number" min="1" max="2" value={ep} onChange={e=>setEp(Number(e.target.value))}/></label><button onClick={()=>void run(async()=>{const draft=await api(`/api/v1/series/${seriesId}/screenplay`,{planId:result.planId,episodeNumber:ep});onGenerated(draft.text,ep);})}>Tạo kịch bản bản thử</button><small>Phân tích và kịch bản bản thử dùng luật cục bộ, chưa chứng minh chất lượng biên kịch AI.</small></article>}</div>;
}
createRoot(document.getElementById("root")!).render(<App/>);
