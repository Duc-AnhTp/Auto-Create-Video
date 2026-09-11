# 🎬 HƯỚNG DẪN THỰC NGHIỆM PROVIDER THẬT & KẾ HOẠCH SẢN XUẤT PHIM (GIAI ĐOẠN 5 – 7)

Tài liệu này xác lập quy trình kiểm nghiệm nghiêm ngặt khi chuyển tiếp từ **môi trường kiểm thử cục bộ (mock/offline)** sang **môi trường thực thi thực tế (real paid/local GPU providers)** và lộ trình sản xuất phim từ bản thử nghiệm ngắn đến quy mô 10 phút.

---

## 📌 Nguyên Tắc Bất Khả Xâm Phạm Trước Khi Kích Hoạt

1. **Ủy Quyền Tường Minh (Explicit User Authorization)**:
   - Không tự động kích hoạt API trả phí nếu người dùng chưa phê duyệt và chưa cấu hình biến môi trường chứa API Key.
   - Luôn sử dụng cờ giới hạn ngân sách cứng `--budget-cap <USD>` trong mọi lệnh thực thi sản xuất có phát sinh chi phí.

2. **Không Thay Thế Bằng Mock Để Báo Hoàn Thành**:
   - Provider trả phí và chất lượng phim thực tế là các mốc nghiệm thu độc lập.
   - Tuyệt đối không dùng kết quả giả lập (mock) để đánh dấu hoàn thành cho Giai đoạn 5, 6, hoặc 7.

3. **Bảo Toàn Dữ Liệu & Cách Ly Canon**:
   - Mọi thử nghiệm đều thực hiện trên bản sao lưu SQLite riêng hoặc series test (`--series test-real-pilot`).
   - Chỉ commit vào Story Bible canon chính thức khi tập phim đạt đầy đủ tiêu chí kỹ thuật, được đạo diễn duyệt và bản ghi lifecycle có trạng thái `approved`.

---

## 🚀 Giai Đoạn 5: Thử Nghiệm Một Provider Thật Phạm Vi Nhỏ

### 1. Chuẩn Bị & Lựa Chọn Provider
- **Lựa chọn khuyến nghị**:
  - **Phương án A (Cloud API)**: Kling AI v2 (`api_kling`) qua API Gateway.
    - Cấu hình biến môi trường trong `.env`:
      ```bash
      KLING_API_KEY="your_actual_kling_api_key"
      KLING_BASE_URL="https://api.klingai.com/v1"
      ```
    - Bảng giá tham chiếu: ~$0.50 – $0.70 cho mỗi video 5 giây (chế độ tiêu chuẩn).
  - **Phương án B (Local GPU - Miễn phí API)**: ComfyUI / Wan 2.2 (`local_comfyui`).
    - Cấu hình:
      ```bash
      COMFYUI_HOST="127.0.0.1"
      COMFYUI_PORT="8188"
      ```

### 2. Kịch Bản Thử Nghiệm Tối Thiểu (Single-Shot Smoke Test)
Tạo kịch bản test 1 shot duy nhất dài 5 giây, có hình ảnh chân dung nhân vật tham chiếu:

```text
TẬP 99: THỬ NGHIỆM PROVIDER THẬT
Logline: Kiểm tra khả năng kết nối và tạo video từ provider thật.

CẢNH 1: QUÁN BAR HẺM 9 - ĐÊM
Nhân vật: Minh

CÚ MÁY 1 (close_up, 5s): Thám tử Minh ngồi trong góc tối quán bar, ánh đèn neon đỏ hắt lên gương mặt trầm ngâm, khói thuốc bay lững lờ.
MINH: Mọi thứ đã sẵn sàng cho đêm nay.
```

### 3. Lệnh Chạy Có Khóa Ngân Sách
Chạy với trần ngân sách người dùng đặt là **$1.50** (đủ cho 1 shot + tối đa 1 lần retry tự động nếu cần):

```bash
npm run series -- series:episode \
  --series "cyber-saigon" \
  --script "scripts/smoke_test_ep99.txt" \
  --provider "api_kling" \
  --budget-cap 1.50 \
  --output "output/smoke_test_real"
```

### 4. Quy Trình Kiểm Chứng & Nghiệm Thu Giai Đoạn 5
1. **Kiểm tra nhật ký Submit & Poll**:
   - Xác nhận có gọi `submitJob` thật, nhận về `provider_job_id` hợp lệ.
   - Quá trình polling kiểm tra trạng thái định kỳ và hoàn tất mà không bị timeout.
2. **Tải tệp & Kiểm định luồng Video (`ffprobe`)**:
   - Tệp video được tải về an toàn tại `output/smoke_test_real/shots/sc01_sh01.mp4`.
   - Chạy `probeVideoFile` xác nhận:
     - `isValid === true`
     - Video codec: `h264` hoặc `hevc`
     - Duration thực tế xấp xỉ 5.0 giây (sai lệch < 0.2s)
     - Không có lỗi moov atom hoặc macroblocking.
3. **Thử nghiệm ngắt tiến trình & khôi phục (Crash Recovery Test)**:
   - Trong quá trình polling remote task, ngắt tiến trình bằng `Ctrl+C`.
   - Chạy lại lệnh với cờ `--resume`:
     ```bash
     npm run series -- series:resume \
       --dir "output/smoke_test_real" \
       --provider "api_kling"
     ```
   - **Tiêu chuẩn đạt**: Hệ thống đọc checkpoint, nhận diện `provider_job_id` đang có trên Kling, tiếp tục polling kết quả mà **KHÔNG gọi `submitJob` mới**, không bị trừ tiền lần hai.
4. **Đối soát số dư & sổ cái ngân sách**:
   - Kiểm tra bảng `provider_jobs` trong SQLite:
     ```sql
     SELECT id, provider, provider_job_id, status, estimated_cost_usd, confirmed_cost_usd 
     FROM provider_jobs WHERE series_id = 'cyber-saigon';
     ```
   - Xác nhận chi phí chuyển từ `reserved` sang `confirmed` đúng với số tiền thực tế trừ trên hóa đơn provider.

---

## 🎬 Giai Đoạn 6: Sản Xuất Phim Thử Nghiệm 2–3 Phút (Pilot Film)

Sau khi Giai đoạn 5 nghiệm thu thành công, tiến hành sản xuất một tập phim ngắn 2–3 phút hoàn chỉnh.

### 1. Cấu Trúc Kịch Bản Chuẩn (Pilot Film Script Outline)
- **Thời lượng**: Khoảng 2 phút 30 giây (~150 giây), chia làm 12 – 15 shot (mỗi shot 8 – 12 giây).
- **Nhân vật**: 2 nhân vật có ảnh chân dung chuẩn trong Story Bible:
  - `char_minh` (Thám tử Minh, 35 tuổi, áo măng tô dạ sờn vai).
  - `char_an` (Hacker An, 22 tuổi, tóc xanh neon, áo hoodie phản quang).
- **Bối cảnh**: 3 địa điểm luân chuyển:
  - Cảnh 1: Quán Bar Hẻm 9 (Ánh đèn neon đỏ, khói mờ ảo).
  - Cảnh 2: Hẻm Mưa Neon (Mưa rơi trên mặt đường nhựa, phản chiếu ánh đèn thành phố).
  - Cảnh 3: Phòng Thí Nghiệm Ngầm (Ánh sáng trắng xanh lạnh, màn hình dữ liệu holo).
- **Đạo cụ chuyển giao**: `prop_chip` (Con Chip Lượng Tử phát sáng xanh ngọc).
- **Âm thanh & Dựng phim**:
  - Đối thoại nhiều lượt có khoảng lặng kịch tính giữa các câu nói.
  - BGM có tiết tấu hồi hộp, tự động hạ âm lượng (ducking -14dB) khi nhân vật thoại.
  - SFX đồng bộ: tiếng mưa rơi, tiếng mở nắp hộp kim loại, tiếng bước chân trên vũng nước.
  - Chuyển cảnh: Kết hợp cắt thẳng 0s (`cut`) và hòa tan 0.4s (`crossfade`) giữa các cảnh.

### 2. Kịch Bản Thử Nghiệm Re-roll & Duyệt Take
Cố ý đưa vào quy trình 1 cú máy cần tinh chỉnh diện mạo hoặc biểu cảm:
1. Tạo shot đầu tiên -> Đạt kết quả cơ bản.
2. Thực hiện re-roll với prompt điều chỉnh ánh sáng hoặc biểu cảm:
   ```bash
   npm run series -- series:reroll \
     --series "cyber-saigon" \
     --episode 1 \
     --shot "sc01_sh02" \
     --prompt "Minh ngồi trong góc tối, nét mặt căng thẳng nhìn quanh, ánh đèn neon đỏ hắt lên sẹo mày trái" \
     --provider "api_kling"
   ```
3. Kiểm tra:
   - Take 1 vẫn được lưu trữ nguyên vẹn trên đĩa (`sc01_sh02_take01.mp4`).
   - Take 2 được tạo mới (`sc01_sh02_take02.mp4`).
   - So sánh QA của cả 2 take.
   - Nếu Take 2 đẹp hơn: thực hiện duyệt chính thức bằng lệnh review hoặc cờ `--force-approve`.

### 3. Rubric Nghiệm Thu 5 Tiêu Chí Bắt Buộc (Pilot Film Acceptance)
| Tiêu Chí | Yêu Cầu Cụ Thể | Phương Pháp Kiểm Tra |
| :--- | :--- | :--- |
| **1. Kỹ Thuật (Technical)** | Video 1080x1920 (9:16), 30fps mượt mà, âm thanh 48kHz stereo. Hình-tiếng khớp nhau từ đầu đến cuối phim, không bị giật, lệch pha hoặc mất tiếng. | `ffprobe` đo elementary streams, độ lệch tổng thể < 0.08s. |
| **2. Nhất Quán (Consistency)** | Gương mặt Minh và An nhất quán qua các cảnh; trang phục đúng quy định; Con Chip Lượng Tử giữ nguyên hình dạng và ánh sáng xanh ngọc. | Đạo diễn xem trực quan và so khớp báo cáo Face QA. |
| **3. Kể Chuyện (Storytelling)** | Nhịp điệu kịch tính, thoại rõ ràng truyền cảm, SFX tạo không khí chân thực, phụ đề SRT hiển thị đúng từng câu thoại. | Trải nghiệm người xem trực tiếp. |
| **4. Vận Hành (Ergonomics)** | Khi cần sửa 1 câu thoại hoặc 1 góc máy, hệ thống chỉ render lại đúng phần tử đó mà không phải dựng lại cả tập phim từ đầu. | Chạy lệnh sửa và đối soát thời gian/chi phí sinh mới. |
| **5. Chi Phí Thực Tế (Cost Audit)** | Chi phí tổng thể của tập phim không vượt trần dự toán ($15 – $25 cho tập 2.5 phút). | Đối chiếu sổ cái `budget_ledger` và hóa đơn cổng thanh toán. |

---

## 📈 Giai Đoạn 7: Nâng Lên Phim 10 Phút & Đánh Giá Dài Hạn

Khi tập phim thử nghiệm 2–3 phút đã được nghiệm thu đạt chuẩn chất lượng, bước tiếp theo là mở rộng quy mô sản xuất lên các tập phim dài tiêu chuẩn (8 – 10 phút/tập).

### 1. Bảng Chỉ Số Giám Sát Hiệu Năng & Chi Phí (Monitoring KPIs)
Trong suốt quá trình sản xuất tập 10 phút (~50 – 60 shot), cần ghi nhận và đo lường các chỉ số:
- **Tỷ lệ Clip cần Re-roll (Re-roll Rate)**:
  - $\text{Re-roll Rate} = \frac{\text{Số shot phải re-roll}}{\text{Tổng số shot}} \times 100\%$
  - *Mục tiêu*: < 25%. Nếu > 40%, cần tinh chỉnh lại prompt mẫu và ảnh chân dung tham chiếu.
- **Thời Gian Hậu Kỳ Trung Bình Mỗi Phút Phim**:
  - Đo thời gian từ khi có kịch bản thô đến khi xuất bản file video master hoàn chỉnh.
  - *Mục tiêu*: < 15 phút xử lý máy tính / 1 phút phim thành phẩm.
- **Chi Phí Bình Quân Trên 1 Phút Phim (Cost Per Minute)**:
  - *Mục tiêu*: Khống chế trong khoảng $6.00 – $10.00 / phút phim thành phẩm khi dùng Cloud API, hoặc < $1.00 / phút chi phí điện khi dùng cụm GPU ComfyUI cục bộ.
- **Tải Phần Cứng Khi Ghép Timeline Dài**:
  - Theo dõi mức chiếm dụng RAM và CPU khi ghép 60 shot qua FFmpeg filter-complex. Đảm bảo bộ nhớ RAM không bị tràn (OOM).

### 2. Điểm Quyết Định Về Web Review Dashboard (Decision Gate)
Hiện tại, toàn bộ quy trình kiểm duyệt, xem QA, nghe thử thoại và chọn take đều hoạt động thông qua giao diện dòng lệnh CLI và tệp báo cáo JSON.

**Điều kiện kích hoạt xây dựng Web Review Dashboard**:
- Chỉ bắt đầu phát triển Web Dashboard chuyên dụng khi:
  1. Quy trình duyệt qua CLI phát sinh nút thắt: Đạo diễn hoặc biên tập viên cần giao diện trực quan hai màn hình (Side-by-side Video Comparison) để so sánh Take 1 và Take 2 cùng lúc trước khi bấm nút duyệt.
  2. Số lượng take trong một tập vượt quá 50 take, việc duyệt thủ công qua dòng lệnh làm giảm tốc độ sản xuất.
  3. Có sự tham gia của nhiều người trong ê-kíp (Đạo diễn hình ảnh, Biên kịch, Kỹ sư âm thanh) cùng xem và phê duyệt trên mạng nội bộ.
- Nếu việc sản xuất vẫn do 1 kỹ sư kiêm đạo diễn vận hành trơn tru qua CLI, ưu tiên tập trung tài nguyên vào tối ưu hóa chất lượng video và tự động hóa kịch bản thay vì xây dựng UI thừa.
