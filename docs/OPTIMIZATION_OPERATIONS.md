# Vận hành sau tối ưu A–E

Tài liệu này áp dụng cho một máy Windows hoặc một container có filesystem cục bộ, với các worker dùng chung database queue và các thư mục series. Không đặt SQLite trên network share. Không chạy các container có queue hoặc volume riêng rồi coi chúng là cùng một cụm worker.

## Bản build và khởi động

```sh
npm ci
npm run typecheck
npm run build
node dist/cli.js series:help
node dist/cli.js series:studio
```

Build backend và React vào staging. Chỉ publish bản phân phối khi cả hai build thành công; lỗi TypeScript không được emit thành bản chạy. Runtime phải có FFmpeg, ffprobe, fonts và render templates. Dockerfile có builder/runtime stages, chạy worker compiled; khả năng chạy container phải được kiểm tra bằng `npm run smoke:container` trên máy có Docker daemon.

`/` và `/studio` mở React; `/studio-next` là alias. `/studio-legacy` cũng mở React; bản HTML Studio cũ đã được loại bỏ sau kiểm thử parity. Server mặc định khởi động hai worker. Tất cả worker phải có cùng `STUDIO_JOB_DB` (mặc định `data/studio-jobs.db`) và cùng working directory/volume. CLI sản xuất cũng dùng dispatch store này.

## Cấu hình rollout và rollback

| Cấu hình | Mặc định | Khi cần tắt |
|---|---|---|
| `STUDIO_WORKERS` | `2` | Đặt `1` để giảm worker; không tăng hạn mức provider |
| Hedge trong request | `enabled: false`, delay `45000` ms | Bỏ cấu hình hoặc đặt `enabled: false` cho job mới |
| `PAID_HEDGE_DISABLED` | Chưa đặt | `1` chặn hedge mới trước reservation và submit |
| `MEDIA_RENDER_CACHE` | Bật | `0` bỏ cache render; giữ clip provider hợp lệ |
| `MEDIA_STREAM_COPY` | Bật khi stream phù hợp/cut | `0` trở về concat encode |
| `MEDIA_FILTER_FUSION` | Bật khi filter tương thích | `0` trở về các lượt encode riêng |
| `SEMANTIC_CACHE` | Bật | `0` dựng semantic index lại khi truy vấn |
| `STUDIO_LEGACY_DEFAULT` | Chưa đặt | `1` mở legacy tại route mặc định; React còn ở `/studio-next` |

Thay env rồi restart server/worker. Các cờ này không làm mất attempt đã submit; reconciliation phải tiếp tục. Sau migration, rollback ưu tiên chạy bản tương thích schema và tắt feature. Không chạy bản cũ không hiểu schema mới. Không restore snapshot trước khi đối chiếu toàn bộ remote attempt phát sinh sau snapshot.

## Migration và khôi phục

Bible nâng v9 → v10 (reference/artifact provenance) → v11 (attempt group, submitting, lease/audit) → v12 (canonical revision, semantic cache). Queue nâng v1 → v2. Khi mở database, kiểm tra integrity, tạo snapshot SQLite nhất quán trước upgrade và không đặt lại version của database đã nâng. Version mới hơn khả năng runtime bị từ chối.

Quy trình triển khai:

1. Dừng nhận request sản xuất/import/hậu kỳ mới và dừng server/worker cũ. Ghi lại job, attempt, remote ID, ledger và dispatch đang sống; pause không chứng minh remote đã dừng.
2. Lưu snapshot queue và từng Bible bằng SQLite backup/`VACUUM INTO`, kiểm tra integrity. Giữ cả artifact và manifest của đúng series. Không chỉ sao chép file `.db` đang mở rồi bỏ WAL.
3. Mở bằng runtime mới để thực hiện migration. Giữ các snapshot `pre-v*` do migration tạo. Reference/embedding thiếu bằng chứng trở thành `unknown`; số tiền, lịch sử và file cũ được giữ. Attempt cũ có group primary riêng.
4. Khởi động runtime mới với một worker, kiểm tra recovery và các attempt submitting/uncertain. Recovery chạy trước nhận công việc và định kỳ độc lập với parent job.
5. Chạy mock smoke, đọc artifact, kiểm tra metrics/reconciliation; sau đó dùng hai worker. Chỉ bật hedge theo request khi cần.

Backup Studio v2 gồm data, output hiện đại, output legacy và reference nhân vật/bối cảnh của series. Hash mọi file, snapshot SQLite và validate toàn bộ trước restore. Restore dùng staging/rename và giữ bản trước để phục hồi. API chặn backup/restore khi series còn job hoặc remote dispatch cần đối soát. Snapshot v1 vẫn đọc được nhưng không có reference/legacy output. Backup series không thay thế snapshot queue của cả máy.

## Quy tắc mode, ngân sách và QA

Mode được resolve một lần và truyền xuyên pipeline. Demo/Vertical Slice chỉ tạo mock. Production không fallback thành mock khi provider, QA hoặc hậu kỳ lỗi. Input hậu kỳ lấy mode từ artifact, không từ yêu cầu hạ xuống mock.

Trần ngân sách ledger áp dụng cho **video attempts**, gồm primary, hedge và re-roll. LLM/TTS được báo riêng theo usage; không coi chúng đã nằm trong trần video. Cap 0/thiếu reservation không submit. Mock có chi phí 0.

Ledger có estimated, reserved, confirmed và uncertain. Confirmed phân biệt bằng chứng hóa đơn provider, rate card và đối soát thủ công. Ước tính rate card không phải hóa đơn. Giá 0 được giữ nguyên. Hóa đơn/capability/chất lượng provider thật vẫn phải xác minh ngoài vòng offline.

Reference có provenance ảnh riêng với embedding. Ảnh production đã import có thể dùng image reference khi embedding unavailable; không chứng nhận face consistency bằng vector mock. Phép QA bắt buộc thiếu backend/embedding cho UNAVAILABLE và needs_review. Mock, media hỏng, QA chưa đủ hoặc chi phí uncertain không tự commit production canon.

Nhập reference cũ tại Studio hoặc `POST /api/v1/series/:id/artifacts/import`, với path thuộc root series, `kind: image`, entityId, mode, source và trạng thái duyệt. Server đọc/kiểm định ảnh, hash và lưu provenance. Duyệt ảnh không tự tạo bằng chứng embedding.

## Hậu kỳ và artifact

Request mới qua `POST /api/v1/jobs`:

```json
{
  "kind": "postprocess",
  "seriesId": "my-series",
  "episodeNumber": 1,
  "inputArtifactId": "UUID_FROM_ARTIFACT_REGISTRY",
  "options": { "enableCdlGrading": true, "cdlPreset": "natural_balance" }
}
```

API trả 202 và jobId; theo dõi bằng job API/SSE. Không nhận outputDir tùy ý. Server chọn output riêng cho job. Endpoint `/api/v1/series/:id/cinematic-post/process` vẫn nhận payload tương thích, validate đường dẫn/artifact trước enqueue và cũng trả 202. Khi không truyền input, chỉ dùng master đã duyệt của đúng tập; thiếu input trả INPUT_MEDIA_REQUIRED.

Các root được đăng ký: `data/series/:id`, `output/series/:id`, `output/:id`, `assets/characters/:id`, `assets/locations/:id`. Root legacy không được bao phủ output của series khác. HTTP từ chối traversal, ngoài root, cross-series và ancestor symlink/junction trước I/O. Registry lưu hash, probe, mode, provenance và trạng thái hợp lệ; file tồn tại chưa đủ để reuse.

Encode toàn máy và GPU local mỗi loại chỉ một tác vụ. Queue lease 30 giây/heartbeat 5 giây; attempt lease 120 giây/heartbeat 20 giây. Ownership/version được kiểm tra khi checkpoint, publish và registry. Worker mất lease dừng local process; remote attempt còn được đối soát.

FFprobe timeout 30 giây. Render timeout `max(120 giây, 10 × duration)`, tối đa hai giờ; không có media progress 300 giây thì dừng. Output viết riêng, kiểm định rồi rename cùng volume. Pause chặn phase/submit tiếp theo; cancel dừng local và yêu cầu cancel provider khi hỗ trợ. Cancel không chứng minh miễn phí.

## Xử lý submitting, uncertain và losing hedge

1. Mở Usage/Reconciliation của đúng series, xem attempt ID/group/role, remote ID, state, nguồn chi phí và audit. Metrics gateway cho số remote job sống và HTTP thực tế trong 60 giây.
2. Nếu POST có kết quả không rõ, giữ reservation/uncertain và slot. Không retry POST mù. Tìm remote ID bằng bằng chứng tài khoản provider; adapter idempotency chưa được chứng minh mặc định bảo thủ.
3. Dùng thao tác `attach_remote_id` kèm bằng chứng để gắn ID. Reconciler tiếp tục poll theo shared RPM. Callback chỉ quyết định trạng thái khi signature hợp lệ; poll là fallback.
4. Chỉ xác nhận không phí khi có bằng chứng remote không chạy hoặc hóa đơn/đối soát xác nhận 0. Dùng `confirmed_success`, `confirmed_no_charge` hoặc `confirmed_billed_failure` và số tiền tường minh, kể cả 0. Studio gọi `POST /api/v1/series/:id/reconciliation`; thao tác lưu audit nguồn `manual_reconciliation`.
5. Với hedge, kiểm tra **cả hai attempt**. Winner là media hợp lệ + QA PASS. Attempt thua đã submit vẫn giữ chi phí và đối soát sau khi parent có output hoặc bị cancel. Remote terminal được xác nhận giải phóng slot, nhưng phần tài chính chưa rõ tiếp tục uncertain.
6. Khi uncertainty đã được giải quyết, kiểm tra QA/artifact/canon rồi retry parent qua queue để sử dụng lại kết quả hợp lệ. Không sửa trực tiếp số tiền/trạng thái trong SQLite.

## Kiểm thử và khả năng hỗ trợ

```sh
npm run test:unit
npm run test:integration
npm run test:media
npm run test:frontend
npm run build
npm run smoke:runtime
npm run smoke:browser
npm run benchmark
npm run smoke:container
```

Unit thuần chạy song song; media concurrency nhỏ. DB/HTTP có fixture legacy chưa hoàn toàn độc lập nên tiếp tục tuần tự. Test setup chặn mạng provider trả phí; HTTP giả chạy localhost, paid adapter giả giữ chi phí/status riêng. Interprocess tests dùng process con và database file thật, gồm crash trước/sau POST, persist remote ID và publication.

CI cấu hình Ubuntu/Windows × Node 22/24 cùng typecheck, nhóm test, build, compiled CLI và runtime/browser smoke; container smoke trên Ubuntu. Cấu hình CI không chứng minh ma trận đã chạy: xem báo cáo bàn giao và kết quả CI của revision được phát hành.

| Thành phần | Trạng thái nghiệm thu |
|---|---|
| Mock pipeline, queue, media FFmpeg, registry, browser React | Kiểm chứng offline bằng fixture |
| Paid dispatch/hedge/loser/reconciliation | Kiểm chứng logic bằng adapter giả + HTTP local |
| Webhook HMAC, early/duplicate/out-of-order inbox | Kiểm chứng cơ chế offline; signature từng provider thật chưa xác minh |
| Provider thật: capability, chất lượng, idempotency, hóa đơn | Chưa xác minh |
| Face QA với backend/embedding thật, AI lip sync/upscale | Phụ thuộc backend; thiếu backend hiển thị unavailable |
| Token cache billing/savings và LLM/TTS usage thật | Chỉ công bố khi có usage; offline xác nhận payload/logic |
| Docker và ma trận OS/Node | Chỉ xác nhận sau smoke/CI tại môi trường tương ứng |

Kết quả kiểm thử và benchmark cụ thể được ghi trong [báo cáo bàn giao](OPTIMIZATION_HANDOVER.md).
