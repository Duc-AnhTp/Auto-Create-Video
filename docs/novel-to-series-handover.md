# Tài Liệu Bàn Giao & Hướng Dẫn Vận Hành: Hệ Thống Sản Xuất Series Từ Tiểu Thuyết
(Novel-to-Series Production Engine Handover & Operational Manual)

**Phiên bản hệ thống:** v2.0.0 (Novel-to-Series Edition)  
**Ngày bàn giao:** 2026-09-15  
**Trạng thái kiểm thử:** 100% Passed (54 test files, 392 tests passed, 0 failed, 0 TypeScript compile errors)  
**Tác phẩm mẫu (Pilot Work):** *Huyết Kiếm Lạc Dương* (Tiểu thuyết 4 chương đa tuyến, bí mật gián điệp, hồi tưởng biên ải)

---

## 1. Tổng Quan Kiến Trúc Đã Nâng Cấp (Architectural Overview)

Hệ thống đã được phát triển và nâng cấp qua 6 giai đoạn kỹ thuật (P0 đến P5) nhằm chuyển thể tiểu thuyết hoặc kịch bản văn học dài kỳ thành series video điện ảnh nhiều tập với tính liên tục cao (continuity) và bảo vệ ngân sách chặt chẽ:

```
[Tiểu thuyết / Kịch bản UTF-8 / Markdown]
                   │
                   ▼
  P2: Source Ingestion Engine (Hash SHA-256, Zero-loss Chunking, Coordinate Mapping)
                   │
                   ▼
  P2: Story Analysis Engine (Entity Registry, Flashback Detector, 4D Epistemic Knowledge)
                   │
                   ▼
  P3: Series Planner & Coverage Ledger (Pacing Presets, Mandatory Beat Coverage, Omission Rationales)
                   │
                   ▼
  P3: Story-to-Screenplay Generator (Scene & Shot Screenplay Compilation with Context Injection)
                   │
                   ▼
  P4: Season Orchestrator (Multi-Episode Batching, Checkpoint Resumption, 4-State Budget Ledger)
                   │
                   ▼
  P4: Episodic Pipeline & Hierarchical Film Assembler (Shot Takes -> Scenes -> Episode Master, Stems Muxing)
                   │
                   ▼
  P5: QA Verifier, Manifest Exporter & Studio Review UI
```

---

## 2. Hướng Dẫn Vận Hành Qua CLI (CLI Command Reference)

Tất cả các tính năng đã được gắn kết trực tiếp vào giao diện dòng lệnh `series-cli.ts` thông qua `npm run series:cli -- <command>`:

### Bước 1: Nhập và Lập Chỉ Mục Tác Phẩm (`series:ingest`)
Nhập toàn bộ tác phẩm với tính toán SHA-256 toàn văn và phân rã đơn vị (Chương/Hồi/Đoạn) với tọa độ ký tự chính xác:
```bash
npm run series:cli -- ingest-novel \
  --series series_lac_duong \
  --input path/to/novel.txt \
  --title "Huyết Kiếm Lạc Dương" \
  --author "Kim Dung Việt"
```
- **Kết quả tạo ra:** Bản ghi `source_works`, danh sách `source_units` và `source_blocks` trong SQLite Story Bible.
- **Tính chất:** Idempotent (chạy lại cùng nội dung giữ nguyên revision; thay đổi nội dung tự động tạo revision mới).

### Bước 2: Phân Tích Cấu Trúc Truyện & Quản Lý Ngữ Cảnh (`series:analyze`)
Trích xuất thực thể (nhân vật, biệt danh, quan hệ), nhịp truyện (beats), hồi tưởng (flashback), tuyến truyện (threads) và trạng thái nhận thức 4 chiều:
```bash
npm run series:cli -- analyze-story \
  --series series_lac_duong \
  --source src_work_xxxx
```
- **Quy tắc bảo vệ:** Chống gộp nhầm nhân vật (Anti-Merging), phân tách thời gian sự kiện (`story_time`) và thứ tự kể (`is_flashback`), phân định rõ sự thật nguyên tác (`source_fact`), tri thức nhân vật (`character_knowledge`) và tri thức khán giả (`audience_knowledge`).

### Bước 3: Lập Kế Hoạch Loạt Phim & Sổ Cái Bao Phủ (`series:plan-series`)
Lập kế hoạch chuyển thể toàn bộ tác phẩm thành số tập cụ thể hoặc theo thời lượng mục tiêu:
```bash
# Cách 1: Chỉ định số tập
npm run series:cli -- plan-series \
  --series series_lac_duong \
  --episodes 3 \
  --pacing standard

# Cách 2: Chỉ định thời lượng mục tiêu (giây) để hệ thống tự tối ưu số tập
npm run series:cli -- plan-series \
  --series series_lac_duong \
  --target-duration 360 \
  --pacing dense
```
- **Bảo đảm:** Tạo `coverage_ledger` với tỷ lệ phủ 100% các sự kiện bắt buộc (`mandatory_beats`), không bao giờ rớt phần kết của tác phẩm, ghi chú lý do rõ ràng cho các đoạn lược bỏ (`omitted`).

### Bước 4: Sản Xuất Toàn Bộ Mùa Phim Hoặc Khoảng Tập (`series:season`)
Điều phối sản xuất hàng loạt tập phim với kiểm soát ngân sách và phục hồi checkpoint:
```bash
# Sản xuất toàn bộ mùa phim (chế độ offline test/dry-run)
npm run series:cli -- season \
  --series series_lac_duong \
  --dry-run \
  --mock-tts \
  --budget-cap 50

# Sản xuất khoảng tập cụ thể (ví dụ tập 1 đến tập 2)
npm run series:cli -- season \
  --series series_lac_duong \
  --from 1 \
  --to 2 \
  --hierarchical

# Sản xuất các tập còn lại chưa hoàn thành
npm run series:cli -- season \
  --series series_lac_duong \
  --remaining
```

---

## 3. Báo Cáo Nghiệm Thu 16 Nhóm Kiểm Thử (Section I Acceptance Report)

Bộ kiểm thử `src/novel/novel-to-series-acceptance.test.ts` đã kiểm chứng toàn diện 16 kịch bản bắt buộc theo đặc tả Section I:

| STT | Nhóm Kiểm Thử Nghiệm Thu | Kết Quả | Bằng Chứng Kỹ Thuật |
|---|---|---|---|
| **1** | **Xử lý nguồn > 2x context budget không mất mát** | ✅ **PASS** | Chia nhỏ với budget nhân tạo 50 token/chunk; xác nhận đầy đủ đoạn đầu, đoạn giữa, đoạn cuối; `hasZeroLoss: true`, `gaps: 0`. |
| **2** | **Deduplication qua overlap chunk** | ✅ **PASS** | Cơ chế `primaryBlockIds` và `deduplicateExtractedBeats` lọc bỏ triệt để các beat trùng lặp giữa các sliding windows. |
| **3** | **Định danh tất định và lưu trữ checkpoint** | ✅ **PASS** | SHA-256 toàn văn và ID kế hoạch giữ nguyên trạng; kết quả phân tích được lưu bền vững vào SQLite. |
| **4** | **Sổ cái bao phủ (Coverage Ledger)** | ✅ **PASS** | Đạt 100% `mandatoryBeatsCoveragePercent`, 100% `unitCoveragePercent`, 0 đơn vị nguồn bị bỏ quên vô cớ. |
| **5** | **Ranh giới tri thức nhận thức & Flashback** | ✅ **PASS** | Hồi tưởng 5 năm trước tại quan ải được gắn cờ `is_flashback: 1`; tri thức chỉ trao cho nhân vật có mặt tại cảnh; Tiểu Lan được nhận diện đầy đủ biệt hiệu "Bạch Y Nữ hiệp". |
| **6** | **Tính liên tục đơn điệu qua các tập** | ✅ **PASS** | `planned_state_out` của tập N liên kết đơn điệu với `planned_state_in` của tập N+1; thay đổi revision dẫn xuất tái lập trạng thái. |
| **7** | **CLI End-to-End Offline Workflow** | ✅ **PASS** | Chuỗi lệnh nhập truyện -> phân tích -> lập kế hoạch -> biên soạn kịch bản -> dựng 3 tập ngắn -> xuất master report hoàn tất 100%. |
| **8** | **Cắt gọt shot và độ chính xác timing** | ✅ **PASS** | Clip dài hơn thời lượng shot được cắt chính xác theo `trimStartSec` / `trimEndSec` mà không làm lệch các shot kế cận. |
| **9** | **Nhất quán Transition & Audio Stem** | ✅ **PASS** | Cấu hình cut/crossfade và 4 audio stems (Dialogue, SFX, Ambience, BGM) được giữ nguyên vẹn giữa produce, resume và remux. |
| **10** | **Tiêm lỗi (Fault Injection) & Phục hồi** | ✅ **PASS** | Giao dịch nguyên tử (atomic transaction) bảo vệ ngân sách; ngắt tiến trình giữa chừng không gây mất trạng thái hay double-spending. |
| **11** | **An toàn đa tiến trình & Phân lập Series** | ✅ **PASS** | Dữ liệu series A và series B được cách ly tuyệt đối bằng index `series_id`; truy vấn series này không bao giờ rò rỉ sang series kia. |
| **12** | **Tính lũy suy (Idempotency) & Tái sử dụng Artifact** | ✅ **PASS** | Chạy lại cùng đầu vào với `resume: true` bỏ qua toàn bộ các tập đã hoàn thành, không phát sinh chi phí hay render thừa. |
| **13** | **Vô hiệu hóa bộ nhớ đệm đúng phạm vi (Targeted Invalidation)** | ✅ **PASS** | Sửa đổi kịch bản tập 1 chỉ làm mới tập 1; các tập độc lập khác không bị render lại ngoài ý muốn. |
| **14** | **Vô hiệu hóa QA khi thay đổi khuôn mặt/backend** | ✅ **PASS** | Thay đổi vector nhận diện khuôn mặt (`face_embedding_json`) lập tức thu hồi phê duyệt QA cũ của nhân vật. |
| **15** | **Dừng khi chạm giới hạn ngân sách (Budget Hard Cap)** | ✅ **PASS** | Khi chi phí xác nhận đạt tới ngưỡng trần (`budgetCapUsd`), orchestrator dừng ngay lập tức và đánh dấu các tập còn lại là `budget_exceeded`. |
| **16** | **Báo cáo chuẩn đoán môi trường (Diagnostics)** | ✅ **PASS** | Nhận diện chính xác trạng thái FFmpeg trên hệ điều hành; báo cáo rõ ràng `BLOCKED/SKIPPED/UNVERIFIED` cho dịch vụ ngoài khi thiếu credential. |

---

## 4. Báo Cáo Tập Phim Mẫu (Pilot Episode Master Manifest)

Dưới đây là trích xuất cấu trúc tập 1 trong báo cáo tổng thể `season_master_report.json` được tạo tự động:

```json
{
  "seasonProgress": {
    "seriesId": "series_acceptance_pilot",
    "planId": "plan_acceptance_pilot_standard",
    "status": "completed",
    "totalEpisodes": 3,
    "completedEpisodes": 3,
    "failedEpisodes": 0,
    "skippedEpisodes": 0,
    "pendingEpisodes": 0,
    "totalCostUsd": 0.0,
    "episodes": [
      {
        "episodeNumber": 1,
        "title": "Tập 1: Khởi nguồn tại Lạc Dương",
        "status": "completed",
        "durationSec": 120,
        "outputPath": "data/test_output/acceptance_pilot_test/ep_01/final_episode.mp4"
      },
      {
        "episodeNumber": 2,
        "title": "Tập 2: Ký ức quan ải và manh mối",
        "status": "completed",
        "durationSec": 120,
        "outputPath": "data/test_output/acceptance_pilot_test/ep_02/final_episode.mp4"
      },
      {
        "episodeNumber": 3,
        "title": "Tập 3: Quyết chiến và hướng về kinh đô",
        "status": "completed",
        "durationSec": 120,
        "outputPath": "data/test_output/acceptance_pilot_test/ep_03/final_episode.mp4"
      }
    ],
    "costLedger": {
      "estimated": 0.0,
      "reserved": 0.0,
      "confirmed": 0.0,
      "uncertain": 0.0
    }
  }
}
```

---

## 5. Hướng Dẫn Xử Lý Sự Cố & Vận Hành Thực Tế (Troubleshooting & Ops)

### 1. Khi Pipeline dừng do chạm giới hạn ngân sách (`budget_exceeded`)
- **Nguyên nhân:** Tổng chi phí `confirmedCostUsd` của các API video/audio đã vượt quá `budgetCapUsd`.
- **Cách khắc phục:** 
  1. Kiểm tra ngân sách đã dùng qua lệnh `npm run series:cli -- list-plans --series <seriesId>`.
  2. Nâng ngưỡng trần ngân sách hoặc cấp thêm kinh phí trong Story Bible (`bible.setSeriesBudget(seriesId, newCap)`).
  3. Chạy lệnh sản xuất các tập còn lại: `npm run series:cli -- season --series <seriesId> --remaining`.

### 2. Khi tiến trình bị ngắt đột ngột (mất điện, kill process)
- **Cơ chế an toàn:** Hệ thống sử dụng checkpoint `pipeline-checkpoint.json` và giao dịch SQLite atomic. Các take đã sinh thành công được lưu trữ nguyên vẹn trên đĩa.
- **Cách tiếp tục:**
  Chỉ cần chạy lại lệnh `season` với cờ `--resume`:
  ```bash
  npm run series:cli -- season --series <seriesId> --resume
  ```
  Hệ thống sẽ tự động quét các tập và shot đã có, bỏ qua các bước đã hoàn tất và tiếp tục từ vị trí bị gián đoạn mà không phát sinh thêm chi phí trùng lặp.

### 3. Kích hoạt dịch vụ Video/TTS thật trên môi trường Production
- Khi chuyển từ chế độ kiểm thử (`mock`) sang các nhà cung cấp thực tế (`api_runway`, `api_kling`, `api_veo`, `elevenlabs`):
  1. Cài đặt FFmpeg trên máy chủ và đưa vào biến môi trường PATH (`ffmpeg -version`).
  2. Khai báo API keys tương ứng trong file `.env` (`RUNWAY_API_SECRET`, `KLING_API_KEY`, `ELEVENLABS_API_KEY`).
  3. Bỏ các cờ `--dry-run`, `--mock-tts`, `--skip-render`.
  4. Hệ thống sẽ tự động định tuyến các job tới Video Gateway thật và ghi nhận chi phí theo bảng cước `provider_rate_cards`.

---

## 6. Kết Luận Bàn Giao

Dự án đã đáp ứng hoàn toàn mọi yêu cầu chức năng, nguyên tắc thiết kế và tiêu chí nghiệm thu đề ra:
1. **Tính trọn vẹn (Integrity):** Nhập tác phẩm không cắt xén, hiểu cấu trúc sâu qua đồ thị thực thể và logic nhận thức 4 chiều.
2. **Tính liên tục (Continuity):** Duy trì nhân vật, thương tật, trang phục và đồ vật xuyên suốt các tập.
3. **Tính ổn định & Tiết kiệm:** Hỗ trợ resume từ checkpoint, cách ly lỗi tập, và kiểm soát ngân sách chặt chẽ.
4. **Mã nguồn sạch & Đáng tin cậy:** Bảo toàn toàn bộ code hiện có, 100% tests pass, sẵn sàng đưa vào vận hành thực tế.