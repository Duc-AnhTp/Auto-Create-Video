<a id="top"></a>

<div align="center">

<img src="./assets/logo.svg" alt="Auto-Create-Video Logo" width="130" />

# 🎬 Auto-Create-Video: Cinema Production Studio

### The Autonomous AI Video Platform — From Long Novels & Screenplays to Episodic Cinematic Series & Viral Short-Form Motion Graphics

**One repository. Zero manual editing. Hollywood-grade episodic assembly + viral 9:16 motion graphics.**

[![GitHub Stars](https://img.shields.io/github/stars/Duc-AnhTp/Auto-Create-Video?style=for-the-badge&logo=github&color=yellow)](https://github.com/Duc-AnhTp/Auto-Create-Video/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/Duc-AnhTp/Auto-Create-Video?style=for-the-badge&logo=github&color=blue)](https://github.com/Duc-AnhTp/Auto-Create-Video/network/members)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](LICENSE)
[![Node: 22+](https://img.shields.io/badge/Node.js-22%2B-brightgreen?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript: 5+](https://img.shields.io/badge/TypeScript-5%2B-blue?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tests: Vitest](https://img.shields.io/badge/Tests-Passing-success?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev)
[![Database: SQLite v6](https://img.shields.io/badge/Story%20Bible-SQLite%20v6-cyan?style=for-the-badge&logo=sqlite&logoColor=white)](https://sqlite.org)

[**🇬🇧 English**](README.md) · [**🇻🇳 Tiếng Việt**](README.vi.md) · [**🖥️ Web Studio UI**](#-cinema-production-studio-web-ui) · [**🎯 Dual-Engine**](#-dual-engine-overview) · [**🚀 Quick Start**](#-quick-start) · [**📚 Deep Dive**](#-deep-dive-novel-to-series-production-engine) · [**💻 CLI Reference**](#-complete-cli-reference)

</div>

---

## 🌟 Highlights & Breakthroughs

- 🎬 **Episodic Cinema Series Engine (v2.0):** Ingest entire novels (100+ chapters), maintain character canon across episodes with **Story Bible SQLite v6**, and assemble multi-episode seasons with **100% mandatory beat coverage**.
- 🖥️ **Full-Flow Cinema Studio Web UI:** Real-time production control console running at `http://localhost:3000` / `http://localhost:3456`, featuring ArcFace 512-D face lightbox inspection, screenplay dual-view, dynamic audio stems VU equalizer, and dark obsidian aesthetics styled with JetBrains Mono.
- 💰 **4-State Budget & Financial Ledger:** Multi-worker atomic reservations preventing overspending (`estimated` → `reserved` → `confirmed` / `uncertain`) with hard budget caps.
- 🎞️ **Hierarchical Film Assembler:** Two-tier rendering pipeline (`Shot Takes` → `Scene Stitching` → `Episode Master`) outputting 1080p video, 4 isolated audio stems (Dialogue, SFX, Ambience, Ducked BGM), SRT/VTT subtitles, and standard NLE interchange timelines (FCP7 XML & OTIO).
- ⚡ **Autonomous Short-Form News Pipeline:** Turn any URL, text file, or markdown article into a polished 9:16 TikTok/Shorts video in under 5 minutes with 12 motion graphic templates, GSAP animations, HyperFrames, and dual-engine TTS (LucyLab Vietnamese voice cloning & ElevenLabs multilingual).
- 🛡️ **Resilient Fault Recovery:** Deterministic SHA-256 asset caching, cross-series data isolation, and crash-resilient checkpoint resumption (`--resume`) that skips already rendered episodes.

---

## 🖥️ Cinema Production Studio Web UI

Launch the in-browser interactive production environment with a single command:

```bash
npm run studio
# Opens http://localhost:3456 (or custom port via --port 3000)
```

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 🎬 AUTO-CREATE-VIDEO ★ CINEMA PRODUCTION STUDIO                  [LIVE PROD] [0.00$]    │
├───────────────┬────────────────────────────────────────────────────────┬───────────────┤
│ 📚 STORY BIBLE│ 🎞️ DUAL-VIEW SCREENPLAY STUDIO                         │ 🎛️ TAKE REVIEW│
│  - Minh (MC)  │  SCENE 1: MÀN ĐÊM LẠC DƯƠNG [EXT. NIGHT]               │ Take #01 PASS │
│  - Tiểu Lan   │  Camera: 35mm Anamorphic, Low-key Lighting             │ Take #02 REJ  │
│  - Lý Quầy    │  Action: Minh khoác áo choàng cũ bước vào quán trọ... │ Take #03 CAND │
├───────────────┼────────────────────────────────────────────────────────┼───────────────┤
│ 🎚️ STEMS VU   │ ⏱️ UNIFIED TIMELINE (00:04:12.00)                      │ 👤 ARCFACE QA │
│  Dialogue ▃▅█ │  [=== Shot 1 ===][===== Shot 2 =====][== Shot 3 =]     │  512-D Cosine │
│  SFX      ▂▄▆ │  [--- Voice Cue ---] [---- SFX Rain ----]              │  Drift: 0.08  │
│  BGM Duck █▃▂ │  [================ Subtitles SRT ===============]      │  Status: PASS │
└───────────────┴────────────────────────────────────────────────────────┴───────────────┘
```

- **Dual-View Screenplay Console:** Read director action notes, camera lens specifications, atmospheric lighting cues, and AI generation prompts side-by-side.
- **ArcFace 512-D Face Lightbox:** Inspect facial vector cosine similarity against character anchors across multi-episode takes to eliminate character drift *(Note: Test & CI suites use deterministic synthetic simulation; production deployment binds live InsightFace/ArcFace weights)*.
- **Dynamic Audio Stems Equalizer:** Real-time 4-channel VU meter animating Dialogue, SFX, Ambience, and Ducked BGM tracks.
- **In-Browser Configuration:** Securely update API keys (Kling, Runway, Gemini, LucyLab, ElevenLabs) without touching terminal files or restarting the server.

---

## 🎯 Dual-Engine Overview

Auto-Create-Video integrates two specialized production engines in one repository:

| Capability / Requirement | 🎬 Episodic Cinema Series Engine | ⚡ Viral Short-Form News Pipeline |
|---|---|---|
| **Primary Input** | Full novels, book chapters, long screenplays (`.txt`, `.md`) | News article URLs (VnExpress, TechCrunch, blogs, etc.) |
| **Target Output** | Multi-episode film series (9:16 Shorts/Reels or 16:9 Cinema) | 60–90 second viral social video (9:16 vertical) |
| **Memory & Canon** | SQLite Story Bible v6 (Characters, wardrobe, injuries, props) | Stateless `script.json` schema validation via Zod |
| **Visual Generation** | AI Video Diffusion (Runway Gen-3, Kling, Hunyuan, ComfyUI) | HyperFrames + Puppeteer + GSAP (12 motion templates) |
| **Assembly Architecture** | Hierarchical 2-tier (Shot Takes → Scenes → Master Episode) | Frame-accurate timeline synchronization per spoken word |
| **Audio Architecture** | 4 Isolated Stems (Dialogue, SFX, Ambience, Ducked BGM) | Contextual 3-tier SFX mixing + dynamic BGM ducking |
| **NLE Timeline Export** | FCP7 XML (`timeline.xml`) & OTIO (`timeline.otio`) | Direct MP4 render ready for social upload |
| **Execution Trigger** | `npm run series -- <command>` or `npm run studio` | `/create-news-video <url>` or `npm run pipeline` |

---

## 🚀 Quick Start

### 1. Installation & Environment Check

```bash
# Clone the repository
git clone https://github.com/Duc-AnhTp/Auto-Create-Video.git
cd Auto-Create-Video

# Install dependencies
npm install

# Run automated system diagnostic doctor
npm run setup
```

The setup doctor validates your Node.js runtime (≥ 22), SQLite database engine, FFmpeg/ffprobe binaries, Puppeteer Chrome browser, and API configurations.

---

### 2. Workflow A: Interactive Web Studio

```bash
npm run studio
# Open http://localhost:3456 in your browser to manage stories, cast, and episodes visually
```

---

### 3. Workflow B: Novel-to-Series Production (CLI)

Transform a multi-chapter novel into an episodic cinematic series in 4 deterministic steps:

```bash
# Step 1: Ingest novel with SHA-256 hashing and zero-loss chunking
npm run series -- series:ingest --series "thien-long" --input "novel.txt" --title "Thiên Long Bát Bộ"

# Step 2: Extract characters, beats, flashbacks, and 4D epistemic knowledge
npm run series -- series:analyze --series "thien-long"

# Step 3: Plan season structure, episodes, and 100% mandatory beat coverage
npm run series -- series:plan-series --series "thien-long" --episodes 3 --pacing standard

# Step 4: Batch produce entire season with budget cap & checkpointing
npm run series -- series:season --series "thien-long" --dry-run --budget-cap 50
```

---

### 4. Workflow C: 60-Second Short-Form News Video

Generate a viral 9:16 TikTok/Shorts video directly from any news article:

```bash
# Configure API keys
cp .env.example .env.local
# Edit .env.local with your LucyLab or ElevenLabs credentials

# Inside Claude Code CLI:
claude
> /create-news-video https://vnexpress.net/cong-nghe-ai-moi-nhat

# Or run headless from a pre-authored script:
npm run pipeline -- output/my-news-video/script.json
```

---

## 🎬 Deep-Dive: Novel-to-Series Production Engine

```
[Raw Novel / Screenplay (.txt, .md)]
                │
                ▼
  Phase P2: Source Ingestion Engine
  (SHA-256 Content Hash, Zero-Loss Coordinate Mapping, Chapter & Block Units)
                │
                ▼
  Phase P2: Stateful Story Analysis
  (Anti-Merging Entity Registry, Flashback Detector, 4D Epistemic Knowledge)
                │
                ▼
  Phase P3: Series Planner & Coverage Ledger
  (Pacing Presets, 100% Mandatory Beat Coverage, Omission Rationales)
                │
                ▼
  Phase P3: Story-to-Screenplay Generator
  (Cinematic Scene & Shot Prompts, Audio Cues, Continuity Rules)
                │
                ▼
  Phase P4: Season Orchestrator & Budget Ledger
  (Batch Processing, Multi-Worker Leases, 4-State Financial Ledger)
                │
                ▼
  Phase P4: Hierarchical Film Assembler
  (Shot Takes -> Scene Stitching -> Master Video, 4 Audio Stems Muxing)
                │
                ▼
  Phase P5: Delivery Package & Studio Review UI
  (master.mp4, 4 Stems WAV, subtitles.srt/vtt, FCP7 XML / OTIO)
```

### Phase 1: Source Ingestion & Zero-Loss Chunking
- **SHA-256 Immutability:** Full content hashing ensures source texts are versioned with immutable revisions. Re-running the same text is strictly idempotent; editing text creates a tracked revision.
- **Zero-Loss Coordinate Mapping:** Raw texts are split into chapters (`source_units`) and paragraph blocks (`source_blocks`) with exact `char_start` and `char_end` byte offsets. Eliminates truncation of prologue, climax, and epilogue content.
- **Dialogue & Speaker Identification:** Automatically distinguishes narrative prose from dialogue cues and extracts candidate speakers for audio casting.

### Phase 2: Stateful Story Analysis & Story Bible v6
- **Anti-Merging Entity Registry:** Characters, titles, and aliases are cross-indexed with bidirectional alias mapping. Prevents unrelated characters from being erroneously merged.
- **Story Time vs. Presentation Order:** Distinguishes chronological timeline events from non-linear storytelling devices (flashbacks and flash-forwards marked with `is_flashback: 1`).
- **4D Epistemic Knowledge States:** Tracks knowledge boundaries across 4 dimensions:
  1. *Source Fact* (Ground truth in the original novel).
  2. *Adaptation Decision* (Creative adjustments made for film pacing).
  3. *Character Knowledge* (What a character actually knows at a given scene).
  4. *Audience Knowledge* (What the audience has been shown so far).

### Phase 3: Series Planning & Coverage Ledger
- **Pacing Presets:** Choose from `fast` (action/thriller), `standard` (balanced drama), `dense` (high-context mystery), or `epic` (world-building saga).
- **100% Mandatory Beat Coverage:** The `CoverageLedgerManager` verifies that all pivotal story beats (`mandatory_beats`) are allocated to episodes. No endings are dropped, and all omitted secondary beats require explicit rationale logging.
- **Target Duration Optimization:** Specify total episode count (`--episodes 5`) or target episode duration (`--duration 120`) for automatic scene and shot distribution.

### Phase 4: Season Orchestrator & 4-State Budget Ledger
- **Batch Range Orchestration:** Produce an entire season, a specific episode window (`--from 2 --to 4`), or remaining unfinished episodes (`--remaining`).
- **4-State Financial Control:**
  - `estimated`: Pre-execution cost calculation based on provider rate cards.
  - `reserved`: Atomic credit reservation preventing concurrent workers from exceeding budget limits.
  - `confirmed`: Reconciled final charges returned by provider APIs upon task completion.
  - `uncertain`: Isolated jobs experiencing network timeouts awaiting verification before retry.
- **Checkpoint Resumption:** If power fails or a process is interrupted, re-running with `--resume` inspects existing takes and final video artifacts on disk, bypassing already completed episodes with zero redundant API calls.

### Phase 5: Hierarchical Film Assembler & Delivery Package
- **Two-Tier Assembly:** Assembles individual shot takes into scene masters (`scene-XX.mp4`), then joins scenes into the final episode master (`master.mp4`). Eliminates OS command-line length limits and decodes video within bounded RAM.
- **4 Isolated Audio Stems:**
  - `stem-dialogue.wav`: Clean spoken character dialogue.
  - `stem-sfx.wav`: Foley and action sound effects.
  - `stem-ambience.wav`: Environmental background room tone.
  - `stem-bgm.wav`: Ducked soundtrack (automatically lowered during speech).
  - `master-audio.wav`: Mixed composite audio master.
- **Industry Standard NLE Interchange:** Exports `timeline.xml` (Apple FCP7 XML xmeml v4) and `timeline.otio` (OpenTimelineIO) for one-click import into DaVinci Resolve Studio and Adobe Premiere Pro.

---

## ⚡ Deep-Dive: Short-Form News Video Pipeline

```mermaid
flowchart LR
    A[📰 News URL / .md] -->|/create-news-video| B[Claude Code]
    B -->|Synthesize Script| C[script.json (Zod)]
    C -->|12 Template Variants| D[Template Selector]
    D -->|Per-scene / Per-chunk| E[LucyLab / ElevenLabs TTS]
    E -->|voice.mp3 + SFX Mix| F[HyperFrames Engine]
    F -.->|lint / validate / inspect| F
    F -->|Puppeteer + GSAP| G[1800 Frames @ 30fps]
    G -->|FFmpeg 1080x1920| H[video.mp4]
    H -->|Gemini 2.5 Flash Cover| I[Final MP4 + Cover]

    style A fill:#0f172a,color:#fff
    style B fill:#6366f1,color:#fff
    style E fill:#f59e0b,color:#fff
    style F fill:#ec4899,color:#fff
    style I fill:#10b981,color:#fff
```

### 12 Specialized Motion Templates

| Template | Primary Use Case | Visual Behavior |
|---|---|---|
| `hook` | First 3–5 seconds | Ken Burns zoom over backdrop with shimmering typography |
| `comparison` | "A vs B" comparisons | Two distinct contrasting cards with animated winner highlight |
| `stat-hero` | Key metric or percentage | Giant gradient number reveal with contextual label |
| `feature-list` | Product features / bullets | Staggered card entrance with glowing accent bullet points |
| `callout` | Important takeaways / warnings | High-contrast neon border with alert icon animation |
| `quote-card` | Pull quotes & philosophy | Elegant serif typography with author attribution footer |
| `icon-grid` | 3–6 capability highlights | Grid-based icon reveal with synchronized micro-pops |
| `timeline` | Chronological roadmap | Cascade progression connecting milestone nodes |
| `big-text` | Dramatic narrative pivots | Full-bleed typographic impact with dynamic backdrop |
| `chart-bars` | Quantitative bar data | Animated vertical or horizontal bar fills with SFX dings |
| `kinetic-quote` | Spoken sentence emphasis | Word-by-word kinetic animation highlighting spoken cadence |
| `outro` | Call-to-action & follow | Channel branding, handle badge, and subscribe prompt |

### Dual TTS & Synchronized Spoken Cadence
- **LucyLab.io:** Natural Vietnamese voice cloning with free synchronized SRT subtitles.
- **ElevenLabs:** Multilingual voice generation supporting 30+ languages.
- **Voice Chunks (`voiceChunks`):** Audio is segmented into sentence chunks to extract measured timecodes, firing visual motion beats **exactly** when the speaker pronounces the corresponding keyword.

---

## 💻 Complete CLI Reference

All platform operations are exposed via `npm run series -- <command>` and standard scripts:

| Domain | Command | Description |
|---|---|---|
| **System** | `npm run setup` | Run comprehensive environment diagnostic doctor (FFmpeg, SQLite, APIs). |
| **Studio** | `npm run studio` | Launch web production console at `http://localhost:3456` (or custom `--port`). |
| **Tests** | `npm test` | Run complete test suite (392 tests, 54 test files). |
| **Typecheck** | `npm run typecheck` | Verify zero TypeScript compilation errors. |
| **Ingestion** | `npm run series -- series:ingest` | Ingest novel text with SHA-256 hash and block coordinates (`--input <path>`). |
| **Analysis** | `npm run series -- series:analyze` | Analyze entity graph, flashback beats, and 4D epistemic knowledge. |
| **Planning** | `npm run series -- series:plan-series` | Plan episodes, target durations, and 100% mandatory beat coverage. |
| **Season Batch**| `npm run series -- series:season` | Batch orchestrate season with checkpointing (`--from`, `--to`, `--budget-cap`). |
| **Scriptwriting**| `npm run series -- series:write-script`| Generate production screenplay from story beats or source text. |
| **Single Episode**| `npm run series -- series:episode` | Produce single episode from raw screenplay text (`--script <path>`). |
| **Resume** | `npm run series -- series:resume` | Resume interrupted episode execution from `checkpoint.json`. |
| **Shot Reroll** | `npm run series -- series:reroll` | Re-generate an individual rejected shot without touching other scenes. |
| **Remux** | `npm run series -- series:remux` | Re-stitch video and 4 audio stems from existing takes without AI cost. |
| **Budget** | `npm run series -- series:budget` | Inspect 4-state financial ledger or update ceiling (`--set-max <usd>`). |
| **Jobs** | `npm run series -- series:jobs` | View active and historical provider jobs with status and timestamps. |
| **Reconciliation**| `npm run series -- series:reconcile` | Audit and settle network-uncertain provider jobs (`uncertain_timeout`). |
| **Status** | `npm run series -- series:status` | Display Story Bible character roster, prop ledger, and episode history. |
| **Shorts Pipeline**| `npm run pipeline -- <script.json>`| Render 60s 9:16 short-form video via HyperFrames + GSAP. |

---

## ⚙️ Configuration & Environment Guide

Create your local configuration by copying `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

### 1. TTS Provider Setup

```env
# Option A: LucyLab (Best for natural Vietnamese voice cloning + free SRT)
TTS_PROVIDER=lucylab
VIETNAMESE_API_KEY=sk_live_your_lucylab_api_key
VIETNAMESE_VOICEID=your_voice_id_here

# Option B: ElevenLabs (Best for multilingual global content)
TTS_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=sk_your_elevenlabs_api_key
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
```

### 2. Video Diffusion Providers (Cinema Series)

```env
# Kling AI Gateway
KLING_API_KEY=your_kling_api_key
KLING_API_SECRET=your_kling_api_secret

# Runway Gen-3 Gateway
RUNWAY_API_SECRET=your_runway_api_secret

# Local ComfyUI Instance (Default self-hosted backend)
COMFYUI_HOST=http://127.0.0.1:8188
```

### 3. AI Scriptwriting & Thumbnail Imagery

```env
# Google Gemini (for automated 9:16 cover art and concept design)
GEMINI_API_KEY=your_gemini_api_key
GEMINI_IMAGE_MODEL=gemini-2.5-flash-image

# Anthropic Claude (used within Claude Code CLI)
ANTHROPIC_API_KEY=your_claude_api_key
```

---

## 📊 Technical Maturity & Verification Matrix

To uphold engineering integrity, platform capabilities are classified into three maturity tiers:

| Maturity Tier | Capabilities Included | Technical Evidence |
|---|---|---|
| **✅ 1. Operational & Validated (Production Ready)** | • SHA-256 Novel Ingestion & Coordinate Mapping<br/>• Story Bible SQLite v6 with Composite Keys<br/>• 100% Mandatory Beat Coverage Ledger<br/>• Season Batch Orchestrator with Checkpoint Resume<br/>• 4-State Budget Ledger (Atomic Reservation)<br/>• 2-Tier Hierarchical Film Assembler<br/>• 4 Isolated Audio Stems (Dialogue, SFX, Ambience, Ducked BGM)<br/>• FCP7 XML & OTIO Timeline Interchange<br/>• Automated QA Verifier (`driftSec <= 0.1s`)<br/>• HyperFrames 12 Motion Templates + GSAP Engine | 100% pass across 54 test files (392/392 tests), zero TypeScript compilation errors, and complete Section I acceptance test verification in `novel-to-series-acceptance.test.ts`. |
| **🧪 2. Experimental (Beta / Active Iteration)** | • ArcFace 512-D Face Cosine Similarity Auto-Reroll<br/>• Autoregressive Shot Extension via Last-Frame Chaining<br/>• Provider Circuit Breaker FSM (Closed/Open/Half-Open) | Implemented with integration test coverage; live provider API endpoints subject to remote cloud latency and rate limits. |
| **⚠️ 3. Known Limitations (Roadmap)** | • Phonetic Lip-Sync Morphing (Wav2Lip/SadTalker)<br/>• 100% Deterministic Visual Diffusion Consistency<br/>• Headless NLE GUI Automation Testing | Spoken audio is frame-accurately anchored to shot timecodes, but acoustic lip-mesh morphing is in active R&D. NLE XML/OTIO structures are schema-validated without live DaVinci GUI hooks. |

---

## 🛡️ Troubleshooting & Resilient Recovery

### 1. Production Halts Due to Budget Ceiling (`budget_exceeded`)
- **Symptom:** Orchestrator stops and marks pending episodes as `budget_exceeded`.
- **Resolution:**
  1. Inspect committed expenditures: `npm run series -- series:budget --series <seriesId>`
  2. Increase the series budget cap: `npm run series -- series:budget --series <seriesId> --set-max 100.0`
  3. Resume remaining unfinished episodes: `npm run series -- series:season --series <seriesId> --remaining`

### 2. Process Interrupted by Crash or Power Loss
- **Protection:** All generated takes are flushed to disk atomically with SQLite journal integrity.
- **Resolution:**
  Re-run the season command with `--resume`:
  ```bash
  npm run series -- series:season --series <seriesId> --resume
  ```
  The orchestrator reads existing checkpoint manifests, verifies completed video files on disk, and seamlessly resumes only the unfinished shots.

### 3. Missing FFmpeg on Windows / Linux / macOS
- **Symptom:** `FFmpeg / FFprobe: Không tìm thấy trên PATH hệ thống.`
- **Resolution:**
  - **Windows:** `winget install Gyan.FFmpeg`
  - **macOS:** `brew install ffmpeg`
  - **Ubuntu / Debian:** `sudo apt update && sudo apt install ffmpeg`
  - Restart your terminal and verify with `ffmpeg -version`.

---

## 🗺️ Roadmap & Milestones

- [x] **v1.0:** Autonomous short-form news video pipeline with 12 GSAP templates & HyperFrames.
- [x] **v1.5:** LucyLab Vietnamese voice cloning and ElevenLabs multilingual TTS integration.
- [x] **v2.0 (Current):** Full Novel-to-Series Production Engine:
  - [x] SHA-256 source ingestion & zero-loss coordinate chunking.
  - [x] Story Bible SQLite v6 migration with composite series keys.
  - [x] Series planner with 100% mandatory beat coverage ledger.
  - [x] Season batch orchestrator with 4-state financial ledger.
  - [x] Hierarchical film assembly (Shot → Scene → Master) with 4 audio stems.
  - [x] FCP7 XML and OpenTimelineIO export.
  - [x] Cinema Production Studio Web UI with ArcFace lightbox and JetBrains Mono typography.
- [ ] **v2.1:** Deep acoustic lip-sync integration (Wav2Lip / SadTalker) for dialogue shots.
- [ ] **v2.2:** Multi-modal video upscaling (4K 60FPS) via Topaz / ESRGAN post-processing pipelines.
- [ ] **v2.3:** Direct social auto-publisher (TikTok, YouTube Shorts, Facebook Reels) via authenticated OAuth2 APIs.

---

## 🤝 Contributing

Contributions are welcome! Please follow standard development practices:

1. Fork the repository and create a feature branch (`git checkout -b feature/cinema-enhancement`).
2. Implement your changes adhering to existing TypeScript idioms and comment styles.
3. Verify that all 392 tests pass and there are zero TypeScript compiler warnings:
   ```bash
   npm test
   npm run typecheck
   ```
4. Commit using Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`).
5. Open a Pull Request with a clear description of your architectural enhancements.

---

## 📜 License

This project is licensed under the [MIT License](LICENSE) — free for personal, academic, and commercial production use.

---

## 🙏 Acknowledgements

Auto-Create-Video stands on the shoulders of remarkable open-source engineering:

- [HyperFrames by HeyGen](https://hyperframes.heygen.com) — HTML-to-video declarative composition.
- [LucyLab.io](https://lucylab.io) — Vietnamese voice cloning and synthesis API.
- [ElevenLabs](https://elevenlabs.io) — Multilingual realistic speech synthesis.
- [Anthropic Claude](https://anthropic.com/claude) — Story analysis and scriptwriting intelligence.
- [GSAP (GreenSock)](https://greensock.com) — High-performance motion graphic animations.
- [SQLite](https://sqlite.org) & `node:sqlite` — Resilient embedded database for Story Bible canon.
- [FFmpeg](https://ffmpeg.org) — Universal multimedia processing and encoding.

<div align="center">

**[⬆ Back to top](#top)**

Built with ❤️ for AI Cinema Creators & Content Pioneers.

</div>
