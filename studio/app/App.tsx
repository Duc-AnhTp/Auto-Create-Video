import { TimelineVisualizer } from "../features/timeline/TimelineVisualizer.js";
import { AudioStemMixer } from "../shared/ui/AudioStemMixer.js";
import { MultiverseBranchModal } from "../features/branches/MultiverseBranchModal.js";
import { useWorkspace } from "./use-workspace.js";
import { ProjectsFeature } from "../features/projects/ProjectsFeature.js";
import { SettingsFeature } from "../features/settings/SettingsFeature.js";
import { SourceFeature } from "../features/source/SourceFeature.js";
import { TimelineFeature } from "../features/timeline/TimelineFeature.js";
import { ComparisonFeature } from "../features/comparison/ComparisonFeature.js";
import { BibleGraphFeature } from "../features/bibleGraph/BibleGraphFeature.js";
import { MixerFeature } from "../features/mixer/MixerFeature.js";
import { SemanticFeature } from "../features/semantic/SemanticFeature.js";
import { AssetsFeature } from "../features/assets/AssetsFeature.js";
import { GatewayFeature } from "../features/gateway/GatewayFeature.js";
import { CinematicPostFeature } from "../features/cinematicPost/CinematicPostFeature.js";
import { SeasonFeature } from "../features/season/SeasonFeature.js";
import { LipsyncFeature } from "../features/lipsync/LipsyncFeature.js";
import { NleRoundtripFeature } from "../features/nleRoundtrip/NleRoundtripFeature.js";
import { SceneLightingFeature } from "../features/sceneLighting/SceneLightingFeature.js";
import { SeasonTrailerFeature } from "../features/seasonTrailer/SeasonTrailerFeature.js";
import { PreviewFeature } from "../features/preview/PreviewFeature.js";
import { ScriptFeature } from "../features/script/ScriptFeature.js";
import { ShotInspectorFeature } from "../features/shotInspector/ShotInspectorFeature.js";
export function App() {
    const { activeBranchId, api, backupId, backups, bible, branchModalMode, branchModalOpen, branches, budget, busy, canonReport, changes, charRef, creating, currentTime, dirty, editShot, episode, error, files, graphData, handleApproveTake, handleAutoRepairCanon, handleCompareBranches, handleForkBranch, handlePromoteToCanonical, handleQuerySemanticMemory, handleRerollShot, handleRunVerticalSlice, handleSeek, handleValidateCanon, hedgeEnabled, hedgeProvider, history, isRepairingCanon, isValidatingCanon, jobs, loadArtifacts, loadNarrativeGraph, loadSeries, mainVideo, newId, newTitle, notice, panel, previewStale, produce, provider, providers, renderedJob, resolution, run, save, scopeKey, scoped, selected, selectedShot, series, seriesId, setActiveBranchId, setBackupId, setBackups, setBible, setBranchModalMode, setBranchModalOpen, setBudget, setChanges, setCreating, setCurrentTime, setEpisode, setError, setHedgeEnabled, setHedgeProvider, setHistory, setNewId, setNewTitle, setNotice, setPanel, setProvider, setResolution, setSaved, setSelected, setText, setVersion, switchProject, takes, text, timeline, version, video } = useWorkspace();
    return (<div className="app">
      <header>
        <div className="brand">
          ◈ <strong>STUDIO NLE</strong>
          <span>HOLLYWOOD WORKSPACE</span>
        </div>
        <select aria-label="Dự án" value={seriesId} onChange={(e) => switchProject(e.target.value)}>
          <option value="">Chọn dự án</option>
          {series.map((s) => (<option key={s.id} value={s.id}>
              {s.title}
            </option>))}
        </select>
        <label>
          Tập{" "}
          <input className="episode" type="number" min="1" value={episode} onChange={(e) => switchProject(seriesId, Math.max(1, Number(e.target.value)))}/>
        </label>
        <div className="branch-controls">
          <select aria-label="Nhánh kịch bản" className="branch-dropdown" value={activeBranchId} onChange={(e) => setActiveBranchId(e.target.value)}>
            {branches.map((b) => (<option key={b.id} value={b.id}>
                {b.is_canonical ? "★ [Canon] " : "◈ [What-If] "} {b.name}
              </option>))}
            {!branches.length && <option value="">Canon Main</option>}
          </select>
          <button title="Tạo nhánh kịch bản giả định What-If" onClick={() => {
            setBranchModalMode("fork");
            setBranchModalOpen(true);
        }}>
            ＋ Fork
          </button>
          <button title="So sánh phân kỳ giữa các nhánh đa vũ trụ" onClick={() => {
            setBranchModalMode("diff");
            setBranchModalOpen(true);
        }}>
            ⚖️ Diff
          </button>
        </div>
        <button onClick={() => setPanel(panel === "settings" ? "script" : "settings")}>⚙ Cấu hình</button>
        <a href="/studio-legacy">Studio cũ ↗</a>
      </header>

      {(error || notice) && (<div role={error ? "alert" : "status"} className={error ? "banner error" : "banner"}>
          {error || notice}
          <button onClick={() => {
                setError("");
                setNotice("");
            }}>
            ×
          </button>
        </div>)}

      <main>
        {/* Left Sidebar: Library & Story Bible */}
        <ProjectsFeature api={api} backupId={backupId} backups={backups} bible={bible} busy={busy} creating={creating} files={files} loadSeries={loadSeries} newId={newId} newTitle={newTitle} run={run} seriesId={seriesId} setBackupId={setBackupId} setBackups={setBackups} setCreating={setCreating} setNewId={setNewId} setNewTitle={setNewTitle} setNotice={setNotice} switchProject={switchProject}/>

        {/* Center Workspace Area */}
        <section className="workspace" key={scopeKey}>
          <nav>
            {[
            ["script", "📝 Kịch bản & Canon"],
            ["source", "📖 Tiểu thuyết"],
            ["assets", "Reference & nhân vật"],
            ["timeline", "🎞️ Timeline NLE"],
            ["comparison", "🎬 So sánh Take (A/B)"],
            ["bible-graph", "🕸️ Story Bible Graph"],
            ["mixer", "🎛️ Bàn Trộn Âm Thanh"],
            ["semantic", "🧠 Bộ Nhớ Ngữ Nghĩa"],
            ["gateway", "⚡ Gateway & Chi Phí"],
            ["cinematic-post", "🎨 Hậu Kỳ Điện Ảnh & 4K"],
            ["season", "🎬 Điều Phối Mùa (Season)"],
            ["lipsync", "👄 Khớp Khẩu Hình & SSML"],
            ["nle-roundtrip", "🔄 Đồng Bộ NLE (DaVinci)"],
            ["scene-lighting", "💡 Đồng Nhất Ánh Sáng"],
            ["season-trailer", "🎞️ Trailer Mùa Phim"],
            ["preview", "📺 Preview Master"],
            ["settings", "⚙️ Mô hình & Giọng"],
        ].map(([id, label]) => (<button key={id} className={panel === id ? "active" : ""} onClick={() => setPanel(id as typeof panel)}>
                {label}
              </button>))}
          </nav>

          {panel === "settings" ? <SettingsFeature api={api} busy={busy} changes={changes} providers={providers} run={run} setChanges={setChanges} setNotice={setNotice}/> : panel === "source" ? <SourceFeature scopeKey={scopeKey} api={api} dirty={dirty} run={run} save={save} seriesId={seriesId} setEpisode={setEpisode} setPanel={setPanel} setSaved={setSaved} setText={setText} setVersion={setVersion}/> : panel === "timeline" ? <TimelineFeature currentTime={currentTime} editShot={editShot} handleSeek={handleSeek} selected={selected} setSelected={setSelected} timeline={timeline} video={video}/> : panel === "comparison" ? <ComparisonFeature charRef={charRef} episode={episode} handleApproveTake={handleApproveTake} handleRerollShot={handleRerollShot} selected={selected} seriesId={seriesId} takes={takes} timeline={timeline}/> : panel === "bible-graph" ? <BibleGraphFeature graphData={graphData} loadNarrativeGraph={loadNarrativeGraph} seriesId={seriesId}/> : panel === "mixer" ? <MixerFeature timeline={timeline}/> : panel === "semantic" ? <SemanticFeature episode={episode} handleQuerySemanticMemory={handleQuerySemanticMemory} seriesId={seriesId} text={text}/> : panel === "assets" ? <AssetsFeature api={api} episode={episode} scopeKey={scopeKey} scoped={scoped} seriesId={seriesId} setBible={setBible} setError={setError} setNotice={setNotice}/> : panel === "gateway" ? <GatewayFeature api={api} episode={episode} handleRunVerticalSlice={handleRunVerticalSlice} seriesId={seriesId}/> : panel === "cinematic-post" ? <CinematicPostFeature api={api} episode={episode} jobs={jobs} seriesId={seriesId} setError={setError} setNotice={setNotice}/> : panel === "season" ? <SeasonFeature api={api} seriesId={seriesId} setError={setError} setNotice={setNotice}/> : panel === "lipsync" ? <LipsyncFeature api={api} episode={episode} seriesId={seriesId} setError={setError} setNotice={setNotice}/> : panel === "nle-roundtrip" ? <NleRoundtripFeature api={api} episode={episode} seriesId={seriesId} setError={setError} setNotice={setNotice}/> : panel === "scene-lighting" ? <SceneLightingFeature api={api} episode={episode} seriesId={seriesId} setError={setError} setNotice={setNotice}/> : panel === "season-trailer" ? <SeasonTrailerFeature api={api} seriesId={seriesId} setError={setError} setNotice={setNotice}/> : panel === "preview" ? <PreviewFeature mainVideo={mainVideo} previewStale={previewStale} renderedJob={renderedJob} setCurrentTime={setCurrentTime} video={video}/> : <ScriptFeature busy={busy} canonReport={canonReport} dirty={dirty} handleAutoRepairCanon={handleAutoRepairCanon} handleValidateCanon={handleValidateCanon} history={history} isRepairingCanon={isRepairingCanon} isValidatingCanon={isValidatingCanon} run={run} save={save} seriesId={seriesId} setHistory={setHistory} setNotice={setNotice} setText={setText} text={text} version={version}/>}

          {/* Bottom Production Execution Bar */}
          <div className="production">
            <select aria-label="Provider video" value={provider} onChange={(e) => setProvider(e.target.value)}>
              {["mock", "local_comfyui", "api_kling", "api_runway", "api_veo", "api_seedance"].map((p) => (<option key={p}>{p}</option>))}
            </select>
            <select aria-label="Độ phân giải xuất" value={resolution} onChange={(e) => setResolution(e.target.value as typeof resolution)}>
              <option value="1080p">1080p Master</option>
              <option value="720p">720p Bản thử</option>
            </select>
            <input aria-label="Trần ngân sách USD" type="number" min="0.01" step="0.01" placeholder="Trần ngân sách USD" value={budget} onChange={(e) => setBudget(e.target.value)}/>
            <label><input type="checkbox" aria-label="Bật hedge" checked={hedgeEnabled} disabled={provider === "mock"} onChange={event => setHedgeEnabled(event.target.checked)}/> Hedge sau 45 giây</label>
            {hedgeEnabled && provider !== "mock" && <select aria-label="Provider hedge" value={hedgeProvider} onChange={event => setHedgeProvider(event.target.value)}>{["api_kling", "api_runway", "api_veo", "api_seedance"].filter(value => value !== provider).map(value => <option key={value}>{value}</option>)}</select>}
            <button className="primary" disabled={busy || !seriesId || !text.trim()} onClick={produce}>
              {provider === "mock" ? "▶ Tạo bản thử (Mock)" : "▶ Sản xuất Thực tế (Real API)"}
            </button>
          </div>
        </section>

        {/* Right Inspector Sidebar */}
        <ShotInspectorFeature api={api} busy={busy} editShot={editShot} jobs={jobs} run={run} selectedShot={selectedShot} seriesId={seriesId} setPanel={setPanel}/>
      </main>

      {/* Persistent Bottom Multi-Track Timeline Visualizer */}
      <section className="timeline">
        <div className="toolbar">
          <h2>TIMELINE ĐỒNG BỘ ĐA RÃNH (MULTI-TRACK NLE)</h2>
          <span>{timeline ? `${timeline.fps} FPS · ${timeline.videoTrack.length} shots · ${timeline.targetTotalDurationSec.toFixed(1)}s` : "Chưa có timeline"}</span>
          <button onClick={() => void run(loadArtifacts)}>Làm mới</button>
        </div>
        {timeline ? (<TimelineVisualizer timeline={timeline} currentTime={currentTime} onSeek={handleSeek} selectedShotId={selected} onSelectShot={setSelected} onEditShot={(sId, change, dir) => editShot(sId, change, dir)} videoRef={video}/>) : (<p className="muted">Timeline sẽ xuất hiện sau khi tạo bản thử hoặc sản xuất tập phim.</p>)}
      </section>

      {/* Footer Multi-Stem Audio Mixer */}
      {timeline?.stems && Object.keys(timeline.stems).length > 0 && (<section className="footer-mixer-section">
          <AudioStemMixer stems={timeline.stems}/>
        </section>)}

      {/* Multiverse Branch Modal */}
      <MultiverseBranchModal seriesId={seriesId} currentEpisode={episode} branches={branches} activeBranchId={activeBranchId} isOpen={branchModalOpen} mode={branchModalMode} onClose={() => setBranchModalOpen(false)} onForkBranch={handleForkBranch} onCompareBranches={handleCompareBranches} onPromoteToCanonical={handlePromoteToCanonical} onSwitchBranch={(bId) => setActiveBranchId(bId)}/>
    </div>);
}
