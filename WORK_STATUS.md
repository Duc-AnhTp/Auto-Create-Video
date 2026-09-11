# BẢNG THEO DÕI TIẾN ĐỘ THI CÔNG & KIỂM CHỨNG (WORK_STATUS.md)

- **Thời điểm khởi tạo**: 2026-09-11
- **Commit Baseline tham chiếu**: `117955745292de6699f2ab6c0a89ec2f0199fc6a`
- **Nhánh Git hiện tại**: `main`
- **Mục tiêu**: Hoàn thiện tính đúng đắn luồng sản xuất phim dài tập AI (Nhóm A đến H) theo kế hoạch 7 giai đoạn, duy trì tính nguyên vẹn của pipeline tạo video tin tức hiện hữu.

---

## 1. Danh Sách Tệp Đang Sửa Đổi So Với Baseline 1179557

| STT | Đường Dẫn Tệp | Mục Đích Sửa Đổi |
| :--- | :--- | :--- |
| 1 | `src/series/episodic-pipeline.ts` | Khóa chặt commit canon (mock/dry-run không sửa canon production), atomic checkpoint, probe audio/video, gated take selection, unified transition, trích xuất ảnh tham chiếu thật. |
| 2 | `src/series/series-cli.ts` | Cưỡng chế `--dry-run` chuyển provider thành `mock`, cấm `--commit-canon` ghi đè canon khi chạy mock/dry-run/skipRender. |
| 3 | `src/bible/bible-manager.ts` | `BEGIN IMMEDIATE TRANSACTION;` cho budget reservation, worker lease lock (`worker_id`, `lock_expires_at`), chặn commit khi thiếu lifecycle approved. |
| 4 | `src/orchestration/budget-ledger.ts` | Tích hợp trần ngân sách người dùng (`budgetCapUsd`) và ủy quyền cho `atomicReserveProviderJob`. |
| 5 | `src/orchestration/job-orchestrator.ts` | Kiểm tra cả `provider` và `spec_hash` trên in-flight job, tạo job ID phiên bản mới (`_v<timestamp>`) khi spec thay đổi. |
| 6 | `src/qa/face-evaluator.ts` | Trích xuất embedding ảnh thật, cache embedding theo hash ảnh SHA-256 + model/version, trả về `UNAVAILABLE` khi thiếu mặt/backend vắng mặt, gắn chứng cứ QA. |
| 7 | `src/pipeline/shot-chaining.ts` | Hỗ trợ chuyển cảnh cắt thẳng 0s (`crossfadeSec <= 0`) bằng bộ lọc `concat=n=N:v=1:a=0[vout]`. |
| 8 | `src/media/media-validator.ts` | Thêm `AudioProbeInfo` và hàm `probeAudioFile` đo elementary audio stream qua `ffprobe`. |
| 9 | `src/orchestration/concurrency-safety.test.ts` | Kiểm chứng Giai đoạn 2: 2 kết nối độc lập tranh chấp ngân sách, worker lease lock, resume polling không submit mù, rollback transaction, dry-run & skipRender. |
| 10 | `src/series/resume-timeline-fidelity.test.ts` | Kiểm chứng Giai đoạn 3: timeline.json, clean resume 100%, sửa riêng thoại invalidate audio giữ video, sửa prompt invalidate video giữ audio, shot reordering, overflow extension, corrupt file recovery. |
| 11 | `src/qa/qa-and-take-selection.test.ts` | Kiểm chứng Giai đoạn 4: cache ảnh tham chiếu theo hash SHA-256, thiếu ảnh/mặt báo UNAVAILABLE, uninstalled backend báo UNAVAILABLE, gắn chứng cứ QA, take selection gating bảo toàn take cũ khi reroll. |
| 12 | `src/series/episodic-pipeline.test.ts` | Kiểm chứng `skipRender`, cấm mock commit canon nếu không có cờ test isolation, test full produce. |
| 13 | `src/series/series-cli.test.ts` | Kiểm chứng CLI: `--dry-run` và `--provider mock` không bao giờ commit canon dù có `--commit-canon`. |
| 14 | `src/qa/face-evaluator.test.ts` | Kiểm chứng vector rỗng trả về `UNAVAILABLE` kèm chuyển giao review, kiểm chứng gắn chứng cứ QA. |
| 15 | `src/pipeline/shot-chaining.test.ts` | Kiểm chứng bộ lọc concat cho cut transition 0s. |
| 16 | `src/bible/bible-manager.test.ts` | Kiểm chứng ràng buộc lifecycle khi `commitEpisode`, kiểm chứng worker lease contention. |

---

## 2. Bảng Theo Dõi Finding A–H: Hiện Trạng & Tiến Độ Kiểm Chứng

| Nhóm | Vấn Đề Kỹ Thuật | Trạng Thái Triển Khai | Trạng Thái Kiểm Chứng Thực Nghiệm | Ghi Chú & Bằng Chứng |
| :--- | :--- | :---: | :---: | :--- |
| **A** | CLI ưu tiên `--provider` trước `--dry-run`; `skipRender` sinh file mock video giả; mock sửa canon production. | **ĐÃ TRIỂN KHAI** | **ĐÃ KIỂM CHỨNG** | `resolveExecutionMode` cưỡng chế mock; `skipRender` trả `unrendered` không tạo file; cấm tuyệt đối mock commit canon production. Kiểm chứng trong `concurrency-safety.test.ts` & `series-cli.test.ts`. |
| **B** | `atomicReserveForJob` đọc - kiểm tra - ghi riêng rẽ; thiếu worker lease lock; job $0.00 bị gán giá mặc định. | **ĐÃ TRIỂN KHAI** | **ĐÃ KIỂM CHỨNG** | `BEGIN IMMEDIATE TRANSACTION;` trong SQLite; worker lease 60s; bảo toàn $0.00 cho mock/free job. Kiểm chứng 2 kết nối độc lập tranh chấp trong `concurrency-safety.test.ts`. |
| **C** | Resume bỏ qua spec hash; tái sử dụng media hỏng; ghi checkpoint dở dang khi ngắt tiến trình. | **ĐÃ TRIỂN KHAI** | **ĐÃ KIỂM CHỨNG** | Thêm audio fingerprint SHA-256 & video spec hash; probe stream trước khi tái sử dụng; ghi checkpoint atomic qua `.tmp` + `rename`. Kiểm chứng trong `resume-timeline-fidelity.test.ts`. |
| **D** | Lệch timeline giữa audio (0s) và video (0.4s); dùng `-shortest` che giấu độ trôi. | **ĐÃ TRIỂN KHAI** | **ĐÃ KIỂM CHỨNG** | Thống nhất `transitionDurationSec`; hỗ trợ `concat` 0s; đo elementary stream duration không dùng `-shortest`. Kiểm chứng trong `resume-timeline-fidelity.test.ts`. |
| **E** | QA dùng embedding giả định `generateDeterministicEmbedding`; thiếu mặt vẫn tự báo PASS. | **ĐÃ TRIỂN KHAI** | **KIỂM CHỨNG PHẦN MỀM ĐẠT** | Trích xuất ảnh thật; cache SHA-256 theo nội dung ảnh; thiếu mặt trả `UNAVAILABLE` leo thang đạo diễn; gắn chứng cứ QA. *Chất lượng mô hình thật: NOT_VERIFIED*. Kiểm chứng trong `qa-and-take-selection.test.ts`. |
| **F** | Reroll tự động thay take vào `shotVideos` trước QA; auto-approve take mới. | **ĐÃ TRIỂN KHAI** | **ĐÃ KIỂM CHỨNG** | Giữ take cũ hợp lệ nếu take mới FAIL/UNAVAILABLE; chỉ duyệt khi QA PASS hoặc `forceApprove`; đồng bộ SQLite & manifest. Kiểm chứng trong `qa-and-take-selection.test.ts`. |
| **G** | Story Bible tự động commit; thiếu lifecycle vẫn lọt; mock/dry-run tự commit canon. | **ĐÃ TRIỂN KHAI** | **ĐÃ KIỂM CHỨNG** | Bắt buộc lifecycle `approved`; cấm mock/dry-run/skipRender commit canon; transaction atomic rollback. Kiểm chứng trong `concurrency-safety.test.ts` & `episodic-pipeline.test.ts`. |
| **H** | Lỗi import `VideoJobStatus`; nguy cơ hồi quy pipeline video tin tức. | **ĐÃ TRIỂN KHAI** | **ĐÃ KIỂM CHỨNG** | Đã import chuẩn xác `VideoJobStatus`; pipeline tin tức `src/pipeline.ts` hoàn toàn độc lập và an toàn. |

---

## 3. Nhật Ký Tiến Độ Và Bằng Chứng Kiểm Chứng Theo Từng Giai Đoạn

### Giai Đoạn 1: Chốt Quy Tắc Mock/Canon & Baseline
- **Trạng thái**: HOÀN THÀNH.
- **Quy tắc cốt lõi**:
  1. Cấm tuyệt đối `provider === "mock"`, `--dry-run`, `skipRender` hoặc `narrativeDelta` đơn lẻ làm biến đổi Story Bible canon production.
  2. Bỏ qua cờ `--commit-canon` nếu chạy ở chế độ mock/dry-run/skip-render kèm cảnh báo rõ ràng.
  3. Chỉ cho phép commit trong môi trường kiểm thử cô lập (`:memory:` hoặc database đường dẫn `test`) khi có cờ tường minh `_testOnlyAllowMockCommit: true`.
- **Tệp kiểm chứng**: `src/series/episodic-pipeline.test.ts`, `src/series/series-cli.test.ts`.

### Giai Đoạn 2: Kiểm Chứng An Toàn Dữ Liệu & Rủi Ro Phát Sinh Phí
- **Trạng thái**: HOÀN THÀNH.
- **Bộ test xây dựng**: `src/orchestration/concurrency-safety.test.ts` (6 kịch bản kiểm thử):
  1. **Hai kết nối SQLite độc lập tranh chấp ngân sách đồng thời (`Promise.all`)**: Trần ngân sách $1.00; Worker 1 đòi $0.70; Worker 2 đòi $0.60. Kết quả: Đúng 1 worker được chấp thuận, worker còn lại bị từ chối với lý do `Budget cap exceeded`. Tổng chi phí giữ chỗ tuyệt đối không vượt $1.00 (chống triệt để double-spending).
  2. **Worker Lease Lock**: Worker 1 giữ chỗ job với lease 60s; Worker 2 cố tình tranh chấp job này khi lease chưa hết hạn -> bị chặn ngay lập tức.
  3. **Khôi phục sau sự cố Worker (Crash Recovery)**: Worker bị sập sau khi đã submit remote task. Khi khởi động lại hoặc worker khác tiếp quản: chuyển sang polling `provider_job_id` đã có, không submit lại mù gây tốn tiền hai lần.
  4. **Fail-Safe Transaction Rollback**: Gặp lỗi giữa giao dịch commit Story Bible -> toàn bộ thay đổi nhân vật và canon được rollback 100%, không bị cập nhật dở dang.
  5. **`--dry-run` kết hợp provider thật**: Không bao giờ gọi API thật (`submitJob` = 0).
  6. **`skipRender`**: Giữ nguyên tệp video hợp lệ đã có (so khớp SHA-256 byte payload), trả về `unrendered`, không commit canon.

### Giai Đoạn 3: Khóa Tính Đúng Đắn Của Resume & Unified Timeline
- **Trạng thái**: HOÀN THÀNH.
- **Bộ test xây dựng**: `src/series/resume-timeline-fidelity.test.ts` (7 kịch bản kiểm thử):
  1. **Produce lần đầu**: Ghi nhận `timeline.json`, `script-normalized.json`; kiểm tra elementary stream duration của audio và video độc lập; độ trôi đo được nằm trong dung sai `1/fps + 0.05s` (~0.083s), không dùng `-shortest`.
  2. **Clean Resume**: Tái sử dụng 100% media clips cũ (mtime không đổi), không phát sinh job mới.
  3. **Sửa riêng lời thoại**: Invalidate audio master và tái tạo soundtrack; bảo toàn 100% video clip (mtime video shot 2 giữ nguyên vì visual prompt không đổi).
  4. **Sửa Visual Prompt**: Invalidate video shot 1 và sinh lại (mtime tăng); bảo toàn toàn bộ audio soundtrack (mtime audio giữ nguyên vì dialogue không đổi).
  5. **Thêm, xóa, đổi thứ tự shot**: Xử lý reordering mượt mà, pipeline không crash, gán đúng clip cho đúng shot ID.
  6. **Thoại dài hơn shot (Dialogue Overflow)**: Shot 2s mở rộng thành ~5-6s theo chính sách `extend_shot`; timeline và remux giữ nguyên thời lượng mở rộng này.
  7. **Phát hiện media hỏng trước khi ghép**: Phát hiện video 0 bytes qua `probeVideoFile`, tự động kích hoạt tái tạo clip và xuất bản video thành công.

### Giai Đoạn 4: Hoàn Thiện QA & Duyệt Take
- **Trạng thái**: HOÀN THÀNH PHẦN KIỂM CHỨNG PHẦN MỀM (Chất lượng mô hình: `NOT_VERIFIED`).
- **Bộ test xây dựng**: `src/qa/qa-and-take-selection.test.ts` (7 kịch bản kiểm thử):
  1. **Cache Reference Embedding theo Hash SHA-256**: Vector được lưu trong cache theo `hash(file_content):model_version`. Thay đổi nội dung tệp ảnh lập tức làm thay đổi hash và làm mất hiệu lực cache cũ.
  2. **Thiếu ảnh tham chiếu hoặc khuôn mặt**: Trả về `UNAVAILABLE`, ghi chú lý do và leo thang review đạo diễn (`reviewEscalation.required = true`). Nghiêm cấm giả mạo `PASS`.
  3. **Visual QA Backend chưa cài đặt**: Trả về `UNAVAILABLE` kèm lý do `BACKEND_UNAVAILABLE`. Tuyệt đối không tự phong `PASS`.
  4. **Gắn chứng cứ QA**: Báo cáo QA gắn chặt với `takeId`, `mediaHash`, `referenceVersion`, và `isMockVector`.
  5. **Post-QA Take Selection Gating**: Take mới sinh ra trong re-roll mặc định có `is_approved = false`. Nếu take mới không pass QA hoặc chưa duyệt, bản dựng tiếp tục bảo lưu take đã duyệt trước đó trong `shotVideos` và SQLite.
  6. **Duyệt thủ công (`forceApprove`)**: Quyết định của đạo diễn cập nhật take chính thức nhất quán trên cả SQLite `shot_takes` và checkpoint JSON.
  7. **Minh bạch chất lượng mô hình**: Ghi nhận rõ năng lực mô hình thị giác trên môi trường thử nghiệm là mô phỏng/mock; chất lượng sinh trắc học thực tế được đánh dấu `NOT_VERIFIED` cho đến khi kiểm chứng trên tập dữ liệu ảnh/video thật.

---

## 4. Kế Hoạch Các Giai Đoạn Tiếp Theo (Giai Đoạn 5–7)

- **Giai Đoạn 5 — Thử Nghiệm Một Provider Thật Phạm Vi Nhỏ**:
  - *Điều kiện kích hoạt*: Chỉ bắt đầu khi có sự ủy quyền chính thức từ người dùng và cung cấp API Key / endpoint ComfyUI cục bộ.
  - Chọn 1 provider duy nhất (ví dụ Kling API v2 hoặc ComfyUI local).
  - Khóa trần chi phí người dùng tối đa (ví dụ: $1.50 cho 1 shot test).
  - Kiểm tra luồng: submitJob -> polling -> safe download -> ffprobe -> stitch.
- **Giai Đoạn 6 — Sản Xuất Phim Thử 2–3 Phút**:
  - 2 nhân vật (Minh, An), 3 bối cảnh, 1 đạo cụ chuyển giao.
  - Đánh giá 5 tiêu chí: Kỹ thuật, Nhất quán, Kể chuyện, Vận hành, Chi phí.
- **Giai Đoạn 7 — Nâng Lên Phim 10 Phút & Đánh Giá Dài Hạn**:
  - Đo đạc tỷ lệ re-roll, thời gian hậu kỳ trung bình, chi phí/phút thành phẩm.
