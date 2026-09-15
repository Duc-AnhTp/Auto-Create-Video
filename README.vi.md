<a id="top"></a>

<div align="center">

<img src="./assets/logo.svg" alt="Auto-Create-Video Logo" width="130" />

# 🎬 Auto-Create-Video: Cinema Production Studio

### Nền Tảng Sản Xuất Video AI Tự Động Toàn Diện — Từ Tiểu Thuyết & Kịch Bản Văn Học Đến Series Phim Điện Ảnh Dài Tập & Video Ngắn Chuyên Nghiệp

**Một kho lưu trữ mã nguồn. Không cần dựng thủ công. Dựng phim nhiều tập chuẩn Hollywood + Motion Graphic 9:16 tối ưu thuật toán mạng xã hội.**

[![GitHub Stars](https://img.shields.io/github/stars/Duc-AnhTp/Auto-Create-Video?style=for-the-badge&logo=github&color=yellow)](https://github.com/Duc-AnhTp/Auto-Create-Video/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/Duc-AnhTp/Auto-Create-Video?style=for-the-badge&logo=github&color=blue)](https://github.com/Duc-AnhTp/Auto-Create-Video/network/members)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](LICENSE)
[![Node: 22+](https://img.shields.io/badge/Node.js-22%2B-brightgreen?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript: 5+](https://img.shields.io/badge/TypeScript-5%2B-blue?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tests: 392 Passed](https://img.shields.io/badge/Ki%E1%BB%83m%20Th%E1%BB%AD-392%20Pass%20(100%25)-success?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev)
[![Database: SQLite v6](https://img.shields.io/badge/Story%20Bible-SQLite%20v6-cyan?style=for-the-badge&logo=sqlite&logoColor=white)](https://sqlite.org)

[**🇬🇧 English**](README.md) · [**🇻🇳 Tiếng Việt**](README.vi.md) · [**🖥️ Web Studio UI**](#-giao-di%E1%BB%87n-web-cinema-production-studio) · [**🎯 Hai Phân Hệ**](#-t%E1%BB%95ng-quan-hai-ph%C3%A2n-h%E1%BB%87-dual-engine) · [**🚀 Bắt Đầu Nhanh**](#-b%E1%BA%AFt-%C4%91%E1%BA%A7u-nhanh-3-ph%C3%BAt) · [**📚 Chuyên Sâu**](#-chuy%C3%AAn-s%C3%A2u-h%E1%BB%87-th%E1%BB%91ng-s%E1%BA%A3n-xu%E1%BA%A5t-phim-t%E1%BB%AB-ti%E1%BB%83u-thuy%E1%BA%BFt) · [**💻 Tra Cứu CLI**](#-b%E1%BA%A3ng-tra-c%E1%BB%A9u-l%E1%BB%87nh-cli-%C4%91%E1%BA%A7y-%C4%91%E1%BB%A7)

</div>

---

## 🌟 Điểm Nhấn Đột Phá

- 🎬 **Hệ Thống Làm Phim Dài Tập Từ Tiểu Thuyết (v2.0):** Nhập toàn văn tiểu thuyết hàng trăm chương, duy trì tính nhất quán của nhân vật và cốt truyện xuyên suốt các tập qua **Story Bible SQLite v6**, lập kế hoạch mùa phim với **độ phủ 100% các tình tiết bắt buộc (mandatory beats)**.
- 🖥️ **Phòng Sản Xuất Phim Kỹ Thuật Số (Studio Web UI):** Giao diện điều hành thời gian thực chạy tại `http://localhost:3000` / `http://localhost:3456`, tích hợp hộp kiểm định khuôn mặt ArcFace 512-D, bảng kịch bản phân cảnh song song (dual-view), bộ đo âm lượng 4 kênh stems động và phong cách Dark Obsidian với phông chữ JetBrains Mono.
- 💰 **Sổ Cái Tài Chính & Ngân Sách 4 Trạng Thái:** Cơ chế giữ ngân sách nguyên tử (atomic reservation) ngăn ngừa bội chi khi chạy đa luồng (`estimated` → `reserved` → `confirmed` / `uncertain`), tự động dừng khi chạm ngưỡng trần (`budget cap`).
- 🎞️ **Dựng Phim Phân Cấp (Hierarchical Film Assembler):** Kiến trúc dựng 2 tầng (`Shot Takes` → `Ghép Cảnh Scene` → `Tập Phim Master`) xuất file MP4 1080p, 4 audio stems tách biệt (Thoại, SFX, Môi trường Ambience, Nhạc nền Ducked BGM), phụ đề SRT/VTT và timeline chuẩn công nghiệp NLE (FCP7 XML & OTIO).
- ⚡ **Pipeline Video Tin Tức Ngắn 60 Giây:** Biến bất kỳ bài báo, văn bản thô hoặc file markdown thành video 9:16 sẵn sàng đăng TikTok/Shorts chỉ trong 5 phút với 12 mẫu motion graphic GSAP, HyperFrames và bộ đôi TTS (LucyLab nhân bản giọng Việt & ElevenLabs đa ngôn ngữ).
- 🛡️ **Khả Năng Phục Hồi & Tái Sử Dụng:** Lưu vết SHA-256 tất định, phân lập dữ liệu tuyệt đối giữa các series, và cơ chế tiếp tục từ checkpoint (`--resume`) tự động bỏ qua các tập đã dựng xong.

---

## 🖥️ Giao Diện Web Cinema Production Studio

Khởi chạy phòng sản xuất phim điện ảnh ngay trên trình duyệt với một câu lệnh:

```bash
npm run studio
# Tự động mở http://localhost:3456 (hoặc đổi cổng qua --port 3000)
```

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 🎬 AUTO-CREATE-VIDEO ★ CINEMA PRODUCTION STUDIO                  [LIVE PROD] [0.00$]    │
├───────────────┬────────────────────────────────────────────────────────┬───────────────┤
│ 📚 STORY BIBLE│ 🎞️ DUAL-VIEW SCREENPLAY STUDIO                         │ 🎛️ TAKE REVIEW│
│  - Minh (MC)  │  SCENE 1: MÀN ĐÊM LẠC DƯƠNG [EXT. NIGHT]               │ Take #01 PASS │
│  - Tiểu Lan   │  Camera: 35mm Anamorphic, Low-key Lighting             │ Take #02 REJ  │
│  - Lý Quầy    │  Hành động: Minh khoác áo choàng cũ bước vào quán trọ...│ Take #03 CAND │
├───────────────┼────────────────────────────────────────────────────────┼───────────────┤
│ 🎚️ STEMS VU   │ ⏱️ DÒNG THỜI GIAN ĐỒNG BỘ (00:04:12.00)                 │ 👤 ARCFACE QA │
│  Thoại   ▃▅█  │  [=== Cú máy 1 ===][===== Cú máy 2 =====][== Cú 3 =]   │  512-D Cosine │
│  SFX     ▂▄▆  │  [--- Voice Cue ---] [---- SFX Mưa Rơi ----]           │  Độ lệch:0.08 │
│  BGM Duck █▃▂ │  [================ Phụ Đề SRT ===================]      │  Trạng thái:OK│
└───────────────┴────────────────────────────────────────────────────────┴───────────────┘
```

- **Bàn Kịch Bản Phân Cảnh Song Song:** Đọc chỉ đạo diễn xuất, thông số tiêu cự ống kính máy quay, gợi ý ánh sáng không gian và prompt AI cùng một lúc trên một màn hình.
- **Hộp Kiểm Tra Khuôn Mặt ArcFace 512-D:** So sánh độ tương đồng cosine của vector khuôn mặt qua từng take phim với ảnh mẫu mỏ neo của nhân vật để loại bỏ hiện tượng biến dạng mặt giữa các tập.
- **Bộ Đo VU Âm Thanh 4 Kênh Động:** Hiển thị thời gian thực mức âm lượng cho Thoại, Hiệu ứng (SFX), Môi trường (Ambience) và Nhạc nền tự động né tiếng (Ducked BGM).
- **Cấu Hình Trực Tiếp Trên Trình Duyệt:** Thay đổi API key (Kling, Runway, Gemini, LucyLab, ElevenLabs) ngay trong giao diện Studio, lưu bảo mật vào `.env.local` mà không cần chạm tay vào terminal hay khởi động lại máy chủ.

---

## 🎯 Tổng Quan Hai Phân Hệ (Dual-Engine)

Auto-Create-Video tích hợp trọn vẹn hai phân hệ sản xuất chuyên biệt trong một nền tảng:

| Tính Năng / Nhu Cầu | 🎬 Hệ Thống Phim Dài Tập (Episodic Cinema Series) | ⚡ Video Tin Tức Ngắn (Viral Short-Form News) |
|---|---|---|
| **Đầu vào chính** | Tiểu thuyết, truyện chữ, kịch bản nhiều hồi (`.txt`, `.md`) | Link bài báo mạng (VnExpress, TechCrunch, blog, ...) |
| **Định dạng video** | Phim dài tập (9:16 Shorts/Reels hoặc 16:9 Cinema) | Video ngắn 60–90 giây dọc (chuẩn 9:16) |
| **Bộ nhớ cốt truyện**| SQLite Story Bible v6 (Nhân vật, trang phục, thương tật, đạo cụ)| Schema `script.json` phi trạng thái kiểm thực bằng Zod |
| **Công nghệ hình ảnh**| AI Video Diffusion (Runway Gen-3, Kling, Hunyuan, ComfyUI) | HyperFrames + Puppeteer + GSAP (12 mẫu đồ họa động) |
| **Kiến trúc dựng** | Phân cấp 2 tầng (Takes cú máy → Ghép cảnh → Master tập) | Dòng thời gian chuẩn xác đến từng từ giọng đọc |
| **Kiến trúc âm thanh**| 4 Stems tách biệt (Thoại, SFX, Ambience, Ducked BGM) | Bộ chọn SFX ngữ cảnh 3 tầng + tự động ducking nhạc nền |
| **Xuất timeline NLE** | FCP7 XML (`timeline.xml`) & OTIO (`timeline.otio`) | Xuất trực tiếp file MP4 sẵn sàng đăng mạng xã hội |
| **Phương thức chạy** | `npm run series -- <lệnh>` hoặc `npm run studio` | `/create-news-video <url>` hoặc `npm run pipeline` |

---

## 🚀 Bắt Đầu Nhanh (3 Phút)

### 1. Cài Đặt & Chẩn Đoán Môi Trường

```bash
# Tải mã nguồn về máy
git clone https://github.com/Duc-AnhTp/Auto-Create-Video.git
cd Auto-Create-Video

# Cài đặt các gói phụ thuộc
npm install

# Chạy trình chẩn đoán tự động toàn diện
npm run setup
```

Trình chẩn đoán (`setup-doctor`) sẽ tự động kiểm tra phiên bản Node.js (≥ 22), SQLite DatabaseSync, công cụ FFmpeg/ffprobe, trình duyệt Puppeteer Chrome và các cấu hình API.

---

### 2. Cách A: Sử Dụng Giao Diện Web Studio Trực Quan

```bash
npm run studio
# Truy cập http://localhost:3456 để quản lý tác phẩm, nhân vật và sản xuất tập phim trực quan
```

---

### 3. Cách B: Quy Trình Chuyển Thể Tiểu Thuyết Qua Dòng Lệnh (CLI)

Chuyển thể tiểu thuyết nhiều chương thành series phim điện ảnh qua 4 bước tất định:

```bash
# Bước 1: Nhập tiểu thuyết với băm SHA-256 và lập chỉ mục không mất mát
npm run series -- series:ingest --series "thien-long" --input "novel.txt" --title "Thiên Long Bát Bộ"

# Bước 2: Phân tích nhân vật, nhịp truyện, hồi tưởng và tri thức nhận thức 4 chiều
npm run series -- series:analyze --series "thien-long"

# Bước 3: Lập kế hoạch mùa phim, chia tập và bảo đảm 100% mandatory beats
npm run series -- series:plan-series --series "thien-long" --episodes 3 --pacing standard

# Bước 4: Điều phối sản xuất hàng loạt trọn mùa phim kèm giới hạn ngân sách
npm run series -- series:season --series "thien-long" --dry-run --budget-cap 50
```

---

### 4. Cách C: Tạo Video Tin Tức 60 Giây Từ Bài Báo Mạng

Tạo video ngắn 9:16 triệu view từ một đường link báo:

```bash
# Thiết lập API keys
cp .env.example .env.local
# Mở .env.local và điền key LucyLab hoặc ElevenLabs

# Trong terminal Claude Code CLI:
claude
> /create-news-video https://vnexpress.net/cong-nghe-ai-moi-nhat

# Hoặc dựng từ kịch bản có sẵn:
npm run pipeline -- output/my-news-video/script.json
```

---

## 🎬 Chuyên Sâu: Hệ Thống Sản Xuất Phim Từ Tiểu Thuyết

```
[Tiểu thuyết / Kịch bản văn học (.txt, .md)]
                   │
                   ▼
  Giai đoạn P2: Source Ingestion Engine
  (Băm SHA-256, Ánh xạ tọa độ không mất mát, Phân rã Chương & Đoạn văn)
                   │
                   ▼
  Giai đoạn P2: Phân Tích Cấu Trúc Truyện (Story Analysis)
  (Đồ thị nhân vật chống gộp nhầm, Nhận diện hồi tưởng, Tri thức 4D)
                   │
                   ▼
  Giai đoạn P3: Lập Kế Hoạch Loạt Phim & Sổ Cái Bao Phủ
  (Pacing tiêu chuẩn, Phủ 100% tình tiết bắt buộc, Giải trình lược bỏ)
                   │
                   ▼
  Giai đoạn P3: Biên Soạn Kịch Bản Phân Cảnh (Story-to-Screenplay)
  (Chi tiết cú máy, góc máy điện ảnh, gợi ý âm thanh, quy tắc liên tục)
                   │
                   ▼
  Giai đoạn P4: Điều Phối Mùa Phim & Sổ Cái Ngân Sách
  (Xử lý hàng loạt, khóa worker ngân sách, kiểm soát 4 trạng thái chi phí)
                   │
                   ▼
  Giai đoạn P4: Dựng Phim Phân Cấp (Hierarchical Assembler)
  (Takes cú máy -> Ghép cảnh Scene -> Master tập phim, Mix 4 audio stems)
                   │
                   ▼
  Giai đoạn P5: Đóng Gói Sản Phẩm & Studio Review UI
  (master.mp4, 4 Stems WAV, subtitles.srt/vtt, FCP7 XML / OTIO)
```

### Bước 1: Nhập Tác Phẩm & Ánh Xạ Tọa Độ Không Mất Mát
- **Bảo toàn tính bất biến qua SHA-256:** Mỗi văn bản nguồn được băm toàn văn để quản lý phiên bản chính xác. Chạy lại cùng nội dung giữ nguyên revision; thay đổi văn bản tự động sinh revision mới.
- **Tọa độ ký tự chính xác (Zero-Loss Mapping):** Văn bản được phân tách thành các chương (`source_units`) và đoạn văn (`source_blocks`) với tọa độ byte bắt đầu (`char_start`) và kết thúc (`char_end`). Tuyệt đối không làm rớt lời tựa, cao trào hay phần kết.
- **Phân tách lời thoại và người nói:** Tự động tách biệt văn xuôi tự sự với lời thoại nhân vật và trích xuất danh tính người nói làm điều kiện phân vai lồng tiếng.

### Bước 2: Phân Tích Truyện & Quản Lý Canon Với Story Bible v6
- **Chống gộp nhầm nhân vật (Anti-Merging):** Phân tích biệt danh, chức vụ và tên gọi hai chiều. Ngăn ngừa việc gộp nhầm hai nhân vật khác nhau khi chưa đủ bằng chứng nguyên tác.
- **Thời gian truyện vs. Thứ tự kể:** Phân biệt trục thời gian thực của sự kiện với thủ pháp phi tuyến tính (hồi tưởng quá khứ, điềm báo tương lai được gắn cờ `is_flashback: 1`).
- **Tri thức nhận thức 4 chiều (4D Epistemic Knowledge):**
  1. *Sự thật nguyên tác (Source Fact):* Những gì chắc chắn đã xảy ra trong tiểu thuyết.
  2. *Quyết định cải biên (Adaptation Decision):* Những điều chỉnh để phù hợp nhịp phim.
  3. *Tri thức nhân vật (Character Knowledge):* Nhân vật biết những gì tại thời điểm của cảnh.
  4. *Tri thức khán giả (Audience Knowledge):* Khán giả đã được tiết lộ những bí mật nào.

### Bước 3: Lập Kế Hoạch Loạt Phim & Sổ Cái Bao Phủ (Coverage Ledger)
- **Các cấu hình nhịp phim (Pacing Presets):** Tùy chọn `fast` (hành động nghẹt thở), `standard` (kịch tính cân bằng), `dense` (trinh thám suy luận) hoặc `epic` (sử thi đồ sộ).
- **Phủ 100% các tình tiết bắt buộc (Mandatory Beats):** `CoverageLedgerManager` kiểm toán chặt chẽ từng sự kiện cốt lõi. Không bao giờ bỏ quên cái kết của truyện, và mọi đoạn lược bỏ đều phải ghi chú lý do rõ ràng.
- **Tối ưu hóa thời lượng mục tiêu:** Chỉ định số tập (`--episodes 5`) hoặc thời lượng mục tiêu mỗi tập (`--duration 120`) để hệ thống tự phân bổ cảnh và cú máy.

### Bước 4: Điều Phối Mùa Phim & Sổ Cái Chi Phí 4 Trạng Thái
- **Sản xuất linh hoạt:** Chạy toàn bộ mùa phim, một khoảng tập cụ thể (`--from 2 --to 4`), hoặc chỉ chạy các tập dở dang còn lại (`--remaining`).
- **Kiểm soát tài chính 4 trạng thái:**
  - `estimated`: Ước lượng chi phí trước khi gọi API dựa theo bảng giá rate card.
  - `reserved`: Khóa giữ ngân sách nguyên tử, ngăn chặn việc vượt ngân sách khi chạy nhiều tác vụ song song.
  - `confirmed`: Chi phí thực tế đã được nhà cung cấp API xác nhận sau khi hoàn thành công việc.
  - `uncertain`: Trạng thái các job bị timeout mạng, được giữ riêng để đối soát tránh bị trừ tiền 2 lần.
- **Tiếp tục từ điểm ngắt (Checkpoint Resume):** Khi mất điện hoặc dừng đột ngột, cờ `--resume` quét các file video và checkpoint đã có trên đĩa, tiếp tục đúng vị trí gián đoạn mà không tốn thêm chi phí.

### Bước 5: Dựng Phim Phân Cấp & Xuất Sản Phẩm Hoàn Chỉnh
- **Dựng phim 2 tầng (Hierarchical Assembly):** Nối các takes thành từng cảnh (`scene-XX.mp4`), sau đó ghép các cảnh thành tập phim hoàn chỉnh (`master.mp4`). Giải quyết triệt để lỗi tràn dòng lệnh trên Windows/Linux và hạn chế tiêu tốn RAM.
- **4 Audio Stems Tách Rời:**
  - `stem-dialogue.wav`: Giọng thoại trong trẻo của các nhân vật.
  - `stem-sfx.wav`: Tiếng động va chạm, bước chân và hiệu ứng hành động.
  - `stem-ambience.wav`: Tiếng gió, mưa, tiếng phòng không gian xung quanh.
  - `stem-bgm.wav`: Nhạc nền đã tự động hạ âm lượng khi có người nói (audio ducking).
  - `master-audio.wav`: Bản tổng hợp âm thanh hoàn chỉnh.
- **Trao đổi dòng thời gian chuẩn NLE:** Xuất tệp `timeline.xml` (chuẩn Apple FCP7 XML) và `timeline.otio` (OpenTimelineIO) để mở trực tiếp trong DaVinci Resolve Studio hoặc Adobe Premiere Pro.

---

## ⚡ Chuyên Sâu: Pipeline Video Tin Tức Ngắn 60 Giây

```mermaid
flowchart LR
    A[📰 Link Bài Báo / .md] -->|/create-news-video| B[Claude Code]
    B -->|Biên Soạn Kịch Bản| C[script.json (Zod)]
    C -->|12 Mẫu Đồ Họa Động| D[Bộ Chọn Mẫu Tự Động]
    D -->|Từng Cảnh / Từng Đoạn| E[LucyLab / ElevenLabs TTS]
    E -->|voice.mp3 + Mix SFX| F[Bộ Dựng HyperFrames]
    F -.->|lint / validate / inspect| F
    F -->|Puppeteer + GSAP| G[1800 Khung Hình @ 30fps]
    G -->|FFmpeg 1080x1920| H[video.mp4]
    H -->|Ảnh Bìa Gemini 2.5 Flash| I[MP4 Hoàn Chỉnh + Cover]

    style A fill:#0f172a,color:#fff
    style B fill:#6366f1,color:#fff
    style E fill:#f59e0b,color:#fff
    style F fill:#ec4899,color:#fff
    style I fill:#10b981,color:#fff
```

### 12 Mẫu Đồ Họa Động Thông Minh (Smart Templates)

| Mẫu | Ngữ Cảnh Sử Dụng | Hành Vi Hình Ảnh |
|---|---|---|
| `hook` | 3–5 giây đầu tiên | Zoom Ken Burns trên nền ảnh tin tức kèm chữ lấp lánh thu hút thị giác |
| `comparison` | So sánh "A vs B" | Hai thẻ thông số đối lập với hiệu ứng phát sáng cho bên chiến thắng |
| `stat-hero` | Con số hoặc % ấn tượng | Số đếm kích thước khổng lồ với màu gradient nổi bật |
| `feature-list` | Danh sách tính năng | Các thẻ thông tin xuất hiện so le với điểm nhấn phát sáng |
| `callout` | Cảnh báo hoặc điểm nhấn | Khung viền màu nổi kèm biểu tượng cảnh báo động |
| `quote-card` | Trích dẫn danh ngôn | Phông chữ có chân sang trọng kèm tên tác giả ở chân trang |
| `icon-grid` | 3–6 tính năng nổi bật | Lưới biểu tượng xuất hiện tuần tự kèm âm thanh pop siêu nhẹ |
| `timeline` | Lộ trình theo thời gian | Dòng tiến trình nối các cột mốc thời gian mượt mà |
| `big-text` | Thay đổi nhịp cảm xúc | Chữ tràn khung hình tạo điểm nhấn kịch tính |
| `chart-bars` | Biểu đồ cột định lượng | Các thanh cột dựng lên sinh động theo dữ liệu số |
| `kinetic-quote` | Nhấn mạnh lời thoại | Từng từ ngữ nhảy múa chính xác theo nhịp phát âm |
| `outro` | Kêu gọi hành động | Huy hiệu kênh, tài khoản TikTok và nút theo dõi |

### Đồng Bộ Âm Thanh Bản Ngữ Tuyệt Đối
- **LucyLab.io:** Giọng đọc tiếng Việt tự nhiên chuẩn nhân bản giọng nói kèm file phụ đề SRT miễn phí.
- **ElevenLabs:** Hỗ trợ lồng tiếng chất lượng cao trên 30 ngôn ngữ quốc tế.
- **Phân đoạn giọng nói (`voiceChunks`):** Đo đạc thời lượng thực tế của từng cụm từ để kích hoạt hiệu ứng hình ảnh **chính xác tuyệt đối** khi giọng đọc phát âm đến từ khóa đó.

---

## 💻 Bảng Tra Cứu Lệnh CLI Đầy Đủ

Mọi tác vụ của hệ thống được vận hành qua `npm run series -- <lệnh>` và các script chuẩn:

| Nhóm | Câu Lệnh | Chức Năng Chi Tiết |
|---|---|---|
| **Hệ thống** | `npm run setup` | Chẩn đoán toàn diện môi trường (FFmpeg, SQLite, Puppeteer, API keys). |
| **Giao diện** | `npm run studio` | Mở Studio Web UI tại `http://localhost:3456` (hoặc cổng tùy chọn `--port`). |
| **Kiểm thử** | `npm test` | Chạy toàn bộ 392 bài kiểm tra unit & integration test. |
| **Kiểm tra kiểu**| `npm run typecheck` | Biên dịch TypeScript và bảo đảm không có bất kỳ lỗi cú pháp nào. |
| **Nhập truyện**| `npm run series -- series:ingest` | Nhập văn bản nguồn với băm SHA-256 và tọa độ đoạn (`--input <path>`). |
| **Phân tích** | `npm run series -- series:analyze` | Phân tích đồ thị nhân vật, flashback và tri thức 4 chiều. |
| **Lập kế hoạch**| `npm run series -- series:plan-series`| Lập kế hoạch phân tập và bảo đảm 100% mandatory beats. |
| **Mùa phim** | `npm run series -- series:season` | Điều phối sản xuất hàng loạt cả mùa kèm checkpoint (`--from`, `--to`, `--budget-cap`). |
| **Viết kịch bản**| `npm run series -- series:write-script`| Chuyển nhịp truyện thành kịch bản phân cảnh chuẩn điện ảnh. |
| **Tập đơn lẻ**| `npm run series -- series:episode` | Sản xuất 1 tập phim từ file kịch bản thô (`--script <path>`). |
| **Tiếp tục** | `npm run series -- series:resume` | Tiếp tục tập phim bị ngắt quãng từ `checkpoint.json`. |
| **Sinh lại shot**| `npm run series -- series:reroll` | Sinh lại riêng 1 shot bị từ chối QA mà không ảnh hưởng shot khác. |
| **Dựng lại** | `npm run series -- series:remux` | Ghép lại video và 4 stems từ các take sẵn có mà không tốn phí AI. |
| **Ngân sách** | `npm run series -- series:budget` | Xem sổ cái chi phí 4 trạng thái hoặc đặt hạn mức (`--set-max <usd>`). |
| **Danh sách job**| `npm run series -- series:jobs` | Xem lịch sử các job gọi provider (thời gian, chi phí, trạng thái). |
| **Đối soát** | `npm run series -- series:reconcile` | Đối soát và xử lý các job bị timeout (`uncertain_timeout`). |
| **Trạng thái** | `npm run series -- series:status` | Xem danh sách nhân vật, đạo cụ và lịch sử các tập trong Story Bible. |
| **Video tin tức**| `npm run pipeline -- <script.json>`| Dựng video tin tức ngắn 9:16 bằng HyperFrames + GSAP. |

---

## ⚙️ Cấu Hình & Biến Môi Trường

Sao chép tệp mẫu `.env.example` thành `.env.local`:

```bash
cp .env.example .env.local
```

### 1. Cấu Hình Giọng Đọc (TTS)

```env
# Lựa chọn 1: LucyLab (Tốt nhất cho tiếng Việt tự nhiên + xuất file phụ đề SRT)
TTS_PROVIDER=lucylab
VIETNAMESE_API_KEY=sk_live_your_lucylab_api_key
VIETNAMESE_VOICEID=your_voice_id_here

# Lựa chọn 2: ElevenLabs (Dành cho video đa ngôn ngữ quốc tế)
TTS_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=sk_your_elevenlabs_api_key
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
```

### 2. Cấu Hình Video AI Diffusion (Phim Điện Ảnh)

```env
# Kling AI Gateway
KLING_API_KEY=your_kling_api_key
KLING_API_SECRET=your_kling_api_secret

# Runway Gen-3 Gateway
RUNWAY_API_SECRET=your_runway_api_secret

# ComfyUI chạy nội bộ trên máy (Local Backend)
COMFYUI_HOST=http://127.0.0.1:8188
```

### 3. Cấu Hình Trí Tuệ Nhân Tạo & Tạo Ảnh Bìa

```env
# Google Gemini (Tự động tạo ảnh bìa 9:16 và ảnh concept nhân vật/bối cảnh)
GEMINI_API_KEY=your_gemini_api_key
GEMINI_IMAGE_MODEL=gemini-2.5-flash-image

# Anthropic Claude (Dành cho Claude Code CLI)
ANTHROPIC_API_KEY=your_claude_api_key
```

---

## 📊 Bảng Phân Loại & Mức Độ Trưởng Thành Kỹ Thuật

Để đảm bảo tính trung thực kỹ thuật và minh bạch cho người dùng, các tính năng được phân nhóm rành mạch:

| Cấp Độ Trưởng Thành | Danh Sách Tính Năng | Bằng Chứng Kỹ Thuật |
|---|---|---|
| **✅ 1. Sẵn Sàng Vận Hành (Production Ready)** | • Nhập tiểu thuyết SHA-256 & Tọa độ không mất mát<br/>• Story Bible SQLite v6 có composite key<br/>• Sổ cái bao phủ 100% tình tiết bắt buộc<br/>• Điều phối mùa phim tự động với Checkpoint Resume<br/>• Sổ cái chi phí 4 trạng thái (Atomic Reservation)<br/>• Dựng phim phân cấp 2 tầng (Hierarchical Assembly)<br/>• 4 Audio Stems Tách Rời (Thoại, SFX, Ambience, Ducked BGM)<br/>• Xuất timeline NLE (FCP7 XML & OTIO)<br/>• Kiểm định QA tự động (`driftSec <= 0.1s`)<br/>• 12 mẫu motion graphic HyperFrames + GSAP | Đạt 100% trên 54 file kiểm thử (392/392 tests pass), 0 lỗi biên dịch TypeScript, và vượt qua toàn bộ 16 nhóm nghiệm thu trong `novel-to-series-acceptance.test.ts`. |
| **🧪 2. Đang Thử Nghiệm (Beta / Active Iteration)** | • So khớp vector ArcFace 512-D và tự động reroll<br/>• Nối shot tự hồi quy bằng trích xuất frame cuối<br/>• Bộ ngắt mạch Provider Circuit Breaker (Closed/Open/Half-Open) | Đã hoàn thiện mã nguồn và kiểm thử logic; các dịch vụ đám mây thực tế chịu ảnh hưởng bởi độ trễ mạng và giới hạn rate limit. |
| **⚠️ 3. Giới Hạn Đã Biết (Roadmap)** | • Nhép khẩu hình môi theo âm vị (Wav2Lip/SadTalker)<br/>• Bảo đảm toán học "100% hình ảnh không biến đổi"<br/>• Tự động hóa kiểm thử trên giao diện GUI DaVinci Resolve | Thoại được neo chính xác theo timecode cú máy, nhưng mô hình nhép môi AI đang trong giai đoạn nghiên cứu. File XML/OTIO được xác thực đúng cú pháp schema mà chưa mở GUI trực tiếp trên CI. |

---

## 🛡️ Xử Lý Sự Cố & Phục Hồi An Toàn

### 1. Quá Trình Dừng Do Chạm Ngưỡng Trần Ngân Sách (`budget_exceeded`)
- **Hiện tượng:** Orchestrator dừng tiến trình và đánh dấu các tập còn lại là `budget_exceeded`.
- **Cách xử lý:**
  1. Xem lại các khoản chi: `npm run series -- series:budget --series <seriesId>`
  2. Nâng hạn mức ngân sách cho series: `npm run series -- series:budget --series <seriesId> --set-max 100.0`
  3. Tiếp tục sản xuất các tập chưa xong: `npm run series -- series:season --series <seriesId> --remaining`

### 2. Bị Ngắt Đột Ngột Do Mất Điện Hoặc Kill Tiến Trình
- **Bảo vệ:** Mọi take video đã sinh đều được ghi nhận nguyên vẹn vào SQLite và lưu trên ổ đĩa.
- **Cách xử lý:**
  Chỉ cần chạy lại lệnh `season` với cờ `--resume`:
  ```bash
  npm run series -- series:season --series <seriesId> --resume
  ```
  Hệ thống sẽ tự động quét các tập và shot đã hoàn tất, bỏ qua bước render thừa và tiếp tục ngay từ vị trí bị gián đoạn.

### 3. Thiếu Công Cụ FFmpeg Trên Máy Tính
- **Hiện tượng:** `FFmpeg / FFprobe: Không tìm thấy trên PATH hệ thống.`
- **Cách xử lý:**
  - **Windows:** Mở PowerShell và chạy `winget install Gyan.FFmpeg`
  - **macOS:** Chạy `brew install ffmpeg`
  - **Ubuntu / Debian:** Chạy `sudo apt update && sudo apt install ffmpeg`
  - Khởi động lại terminal và kiểm tra bằng lệnh `ffmpeg -version`.

---

## 🗺️ Lộ Trình Phát Triển (Roadmap)

- [x] **v1.0:** Pipeline video tin tức ngắn 60 giây với 12 mẫu GSAP & HyperFrames.
- [x] **v1.5:** Tích hợp LucyLab nhân bản giọng Việt và ElevenLabs đa ngôn ngữ.
- [x] **v2.0 (Hiện tại):** Hệ thống sản xuất phim điện ảnh nhiều tập từ tiểu thuyết:
  - [x] Nhập tác phẩm SHA-256 và chia nhỏ tọa độ không mất mát.
  - [x] Nâng cấp Story Bible SQLite v6 với khóa composite `series_id`.
  - [x] Lập kế hoạch phim với độ phủ 100% mandatory beats.
  - [x] Điều phối sản xuất cả mùa với sổ cái ngân sách 4 trạng thái.
  - [x] Dựng phim phân cấp (Shot → Scene → Master) kèm 4 audio stems.
  - [x] Xuất timeline chuẩn NLE (FCP7 XML và OpenTimelineIO).
  - [x] Studio Web UI với hộp kiểm định ArcFace và phông chữ JetBrains Mono.
- [ ] **v2.1:** Tích hợp mô hình nhép môi AI sâu (Wav2Lip / SadTalker) cho các cú máy có thoại cận cảnh.
- [ ] **v2.2:** Nâng cấp độ phân giải video đa tầng (4K 60FPS) qua Topaz / ESRGAN.
- [ ] **v2.3:** Tự động đăng video lên TikTok, YouTube Shorts, Reels qua OAuth2 API.

---

## 🤝 Đóng Góp Phát Triển (Contributing)

Cộng đồng mã nguồn mở luôn được chào đón đóng góp! Quy trình phát triển:

1. Fork repository và tạo nhánh tính năng mới (`git checkout -b feature/tinh-nang-moi`).
2. Viết mã nguồn tuân thủ phong cách TypeScript và chú thích nhất quán của dự án.
3. Đảm bảo toàn bộ 392 bài kiểm thử đều vượt qua và không có bất kỳ cảnh báo biên dịch nào:
   ```bash
   npm test
   npm run typecheck
   ```
4. Đặt tiêu đề commit theo chuẩn Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`).
5. Mở Pull Request với phần mô tả rõ ràng về cải tiến kỹ thuật của bạn.

---

## 📜 Bản Quyền (License)

Dự án được phát hành theo giấy phép mã nguồn mở [MIT License](LICENSE) — hoàn toàn miễn phí cho mục đích cá nhân, học tập nghiên cứu và thương mại.

---

## 🙏 Lời Cảm Ơn

Auto-Create-Video kế thừa và phát triển từ những công trình mã nguồn mở xuất sắc:

- [HyperFrames by HeyGen](https://hyperframes.heygen.com) — Khung dựng video HTML khai báo.
- [LucyLab.io](https://lucylab.io) — Dịch vụ nhân bản và tổng hợp giọng nói tiếng Việt tự nhiên.
- [ElevenLabs](https://elevenlabs.io) — Nền tảng giọng nói AI đa ngôn ngữ chuẩn điện ảnh.
- [Anthropic Claude](https://anthropic.com/claude) — Trí tuệ biên kịch và phân tích cấu trúc truyện.
- [GSAP (GreenSock)](https://greensock.com) — Thư viện diễn hoạt đồ họa chuyển động hiệu năng cao.
- [SQLite](https://sqlite.org) & `node:sqlite` — Cơ sở dữ liệu nhúng bền bỉ cho Story Bible canon.
- [FFmpeg](https://ffmpeg.org) — Bộ công cụ xử lý đa phương tiện chuẩn mực thế giới.

<div align="center">

**[⬆ Trở về đầu trang](#top)**

Xây dựng với tất cả tâm huyết dành cho những nhà sáng tạo nội dung và nhà làm phim AI tương lai.

</div>
