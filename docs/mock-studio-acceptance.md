# Nghiệm thu Studio bằng mock và FFmpeg

Ngày kiểm tra: 29/09/2026, Windows, Node 24.13.1, FFmpeg 6.1.1.
Không gọi provider AI trả phí. Kết quả này xác nhận vận hành phần mềm,
không xác nhận chất lượng phim, giọng đọc hay continuity trên hình ảnh AI thật.

## Chạy lại

```sh
npm run typecheck
npm test
npm run build
npx tsx scripts/verify-mock-studio.ts --serve
```

Script tạo một series riêng, queue SQLite riêng và xóa biến môi trường chứa
credential khỏi tiến trình nghiệm thu. Không đọc cấu hình cá nhân. Bỏ `--serve`
để đóng server sau kiểm tra. Báo cáo nằm trong `output/upgrade/mock-acceptance-*/`;
video nằm trong `output/series/<seriesId>/ep-01/` và `ep-02/`.

## Kết quả pilot phần mềm

Series mới nhất: `mock-acceptance-20260929135534`.
Lượt trước: `mock-acceptance-20260929035347`.

- Hai tập liên tiếp: mỗi tập 150 giây, 1920×1080, 30 fps, sáu shot.
- Hai stream audio/video đều 150 giây; chênh lệch đo bằng ffprobe là 0 giây.
- Có MP4, SRT/VTT, bốn stems, manifest, OTIO và FCP7 XML.
- API media phục vụ byte range với HTTP 206.
- Chạy lại tập 1 giữ nguyên hash và thời gian sửa của shot đã tạo.
- Mock không ghi lịch sử canon sản xuất.
- Báo cáo `report.json` và kiểm tra stream riêng `media-streams.json` ghi bằng chứng.

## Kết quả kiểm thử tự động

- Typecheck backend/frontend và build: đạt 100% (đã khắc phục lỗi cú pháp TS5076 trong `job-orchestrator.ts` và mismatch API trong `system-invariants.test.ts`).
- Toàn bộ 18 ca kiểm thử hệ thống bất biến (System Invariants M0 – M5) tại `src/modules/production/adapters/qa/system-invariants.test.ts`: ĐẠT.
- Lượt toàn bộ mới nhất: 535 ca, 529 đạt và 6 lỗi, không bỏ qua ca nào
  (`output/upgrade/current-tests.json`).
- Các lỗi đã sửa và chạy lại: tải CDN/stream/finalize (18/18), điều phối mùa
  phim/resume (7/7), API/schema/finalize cuối (19/19). Các nhóm có phần giao nhau.
- Sau đối chiếu theo tệp và tên ca kiểm thử: **535/535 ca có bằng chứng đạt**,
  không còn lỗi chưa xử lý (`output/upgrade/verified-tests.json`). Đây là lượt
  toàn bộ cộng các lượt chạy lại sau sửa, không phải một lượt toàn bộ xanh duy nhất.
- Pilot mock mới nhất đạt hai tập, kiểm tra stream, byte range, NLE và resume.
- Đã khắc phục 15 lỗi rà soát mã nguồn chuyên sâu (F01 – F15):
  1. F01: Sửa TS5076 và falsy zero `$0` trong `job-orchestrator.ts`.
  2. F02: Đồng bộ hóa `JobStore`, `BibleManager`, và alias `HierarchicalAssembler` trong `system-invariants.test.ts`.
  3. F03: Bổ sung trạng thái `needs_review` vào `SeasonProgress` và không mask thành công giả.
  4. F04: Đảm bảo tính nguyên tử 2-phase commit với file backup trong NLE atomic staging.
  5. F05: Đọc video bất đồng bộ và chặn nguy cơ tràn V8 string heap (>150MB) trong Visual QA.
  6. F06: Thắt chặt chính sách SSRF ngăn chặn redirect HTTP tới IP nội bộ trong `media-validator.ts`.
  7. F07: Giới hạn thời gian tối đa (timeout) cho `pollTimer` trong Studio Server.
  8. F08: Tách biệt rành mạch `skippedCount` và `completedCount` trong resume metrics.
  9. F09: Thắt chặt CAS verification trong `BibleManager.recordSourceWorkWithRevision`.
  10. F10: Sửa logic boolean fallback localhost cho môi trường kiểm thử trong `url-security.ts`.
  11. F11: Truyền tường minh `exportResolution` vào schema parse trong Studio Server.
  12. F12: Đảm bảo cô lập và khôi phục `this.faceQa.backend` sau mỗi lượt chạy pipeline.
  13. F13: Thiết lập deadline 120s cho synchronous produce request tránh treo socket HTTP.
  14. F14: Fail-closed khi clip tồn tại nhưng không hash được trong `hierarchical-assembler.ts`.
  15. F15: Chuẩn hóa tài liệu nghiệm thu phản ánh trung thực toàn bộ trạng thái hệ thống.
- Ảnh UI: `output/upgrade/studio-acceptance-latest.png`.

## Kiểm tra giao diện trực tiếp

- Chọn series/tập, mở preview; trình duyệt đọc video 150 giây ở 1080p và phát được.
- Chọn shot, đổi thứ tự, lưu bản nháp; preview vẫn báo cần dựng lại sau khi lưu.
- Hoàn tác và lưu lại trả kịch bản về bản trước.
- Tạm dừng rồi tiếp tục job đang dựng qua hàng đợi.
- Gửi yêu cầu sản xuất mock và yêu cầu hủy ngay trên giao diện.

## Lỗi đã sửa

- Bộ dựng phân cấp bỏ qua cấu hình khung hình: truyền kích thước xuất thực tế
  từ pipeline; worker Studio xuất 1080p. Cache scene phân biệt kích thước, FPS
  và cấu hình màu.
- Burn ASS lỗi với đường dẫn Windows có dấu/nháy: dùng thư mục tạm và tên
  phụ đề cố định cho filter, giữ đường dẫn media tuyệt đối. Lỗi burn phụ đề
  được trả ra, không thay bằng video mock rồi báo thành công.
- Preview mất cảnh báo bản dựng cũ sau khi lưu: đối chiếu với kịch bản của
  job đã tạo video. Job mới chưa có kết quả vẫn giữ preview gần nhất.
- Hủy tác vụ dài chưa có phản hồi rõ: hiển thị đang chờ hủy trong khi thao tác
  hiện tại kết thúc và worker tới điểm kiểm tra.
- Kiểm thử MP3 giả định sai header khi FFmpeg thêm ID3; chuyển sang probe audio.
- Kiểm thử burn phụ đề dùng MP4 giả; thay bằng media thật có thể giải mã.
- Fixture dài dùng độ phân giải quá nặng cho giới hạn thời gian kiểm thử;
  giữ nguyên số shot/thời lượng, giảm kích thước fixture kiểm tra cấu trúc.
- Vitest kế thừa cấu hình khiến nhóm unit chạy trùng integration; tách include
  của hai nhóm. Loại bỏ điểm chất lượng gán sẵn trong kiểm thử pilot.
- Hồi quy sau thay đổi bộ tải: fixture CDN dùng URL công khai được Nock chặn
  và trả media cục bộ; giữ nguyên kiểm tra SSRF và chặn mạng ngoài. Fixture
  tải stream trả `Readable` đúng hợp đồng mới.
- Fixture API độ phân giải dùng series riêng để không xung đột job tạm dừng.
  Fixture finalize dùng thư mục tạm riêng và retry xóa file bị khóa ngắn hạn
  trên Windows. Fixture resume tạo checkpoint thật qua dịch vụ để có spec hash.
- Sửa tham chiếu cấu hình transition không tồn tại trong assembler và bổ sung
  sceneId/takeId còn thiếu trong fixture kiểm tra hash, không nới kiểu dữ liệu.
- Các ca nhiều tập với FFmpeg thật có thời hạn riêng; các bài thuần giữ giới
  hạn ngắn. Không bỏ qua bài kiểm thử để báo đạt.

## Phạm vi còn lại

Chưa nghiệm thu provider thật, đánh giá thẩm mỹ/giọng nói/continuity, nhập lại
timeline bằng GUI Premiere/Resolve, hoặc toàn bộ các tình huống mất điện,
hết dung lượng và timeout thanh toán. React là Studio chính tại `/` và `/studio`; `/studio-next` là alias. `/studio-legacy` là alias của React Studio.
Không dùng kết quả mock để công nhận nghiệm thu sản xuất thật.


## Kiểm chứng triển khai A–E

Kết quả của vòng 07/10/2026, các regression mới và giới hạn Docker/CI/provider thật được ghi riêng trong [báo cáo bàn giao](OPTIMIZATION_HANDOVER.md). Các số đo cũ ở trên giữ nguyên phạm vi của lần nghiệm thu ban đầu.
