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

Series: `mock-acceptance-20260929035347`.

- Hai tập liên tiếp: mỗi tập 150 giây, 1920×1080, 30 fps, sáu shot.
- Hai stream audio/video đều 150 giây; chênh lệch đo bằng ffprobe là 0 giây.
- Có MP4, SRT/VTT, bốn stems, manifest, OTIO và FCP7 XML.
- API media phục vụ byte range với HTTP 206.
- Chạy lại tập 1 giữ nguyên hash và thời gian sửa của shot đã tạo.
- Mock không ghi lịch sử canon sản xuất.
- Báo cáo `report.json` và kiểm tra stream riêng `media-streams.json` ghi bằng chứng.

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

## Phạm vi còn lại

Chưa nghiệm thu provider thật, đánh giá thẩm mỹ/giọng nói/continuity, nhập lại
timeline bằng GUI Premiere/Resolve, hoặc toàn bộ các tình huống mất điện,
hết dung lượng và timeout thanh toán. Studio mới tiếp tục ở `/studio-next`.
Không dùng kết quả mock để công nhận nghiệm thu sản xuất thật.
