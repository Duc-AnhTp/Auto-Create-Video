# 🎬 Hướng Dẫn Sản Xuất Phim Dài Tập Bằng AI (Episodic AI Film Series Engine)

Hệ thống cho phép sản xuất các bộ phim dài tập bằng AI (mặc định định dạng **9:16** dọc cho TikTok/Shorts/Reels, hoặc **16:9** ngang cho YouTube/Web Series) với cơ chế **Canon Memory vĩnh viễn** lưu trong SQLite — **hoàn toàn không bị quên ngữ cảnh từ các tập trước**.

---

## 🌟 Tính Năng Cốt Lõi (Core Capabilities)

1. **Nhất Quán Phong Cách Hình Ảnh (Visual & Art Style Consistency):**
   - Lưu trữ `visual_style` chung của toàn series (ví dụ: *Cinematic 35mm, Cyberpunk Noir, High Contrast, Photorealistic 8K*).
   - Tự động gắn phong cách nghệ thuật vào đầu mọi visual prompt của tất cả các shot và tập phim.

2. **Nhất Quán Khuôn Mặt Nhân Vật (Face Consistency Across Episodes):**
   - Mỗi nhân vật có một ảnh chân dung tham chiếu (`face_reference_image`) làm visual anchor.
   - Khi tạo video I2V (Image-to-Video) qua Kling AI hoặc Runway Gen-3, ảnh này được truyền vào mô hình để khóa diện mạo nhân vật.
   - Tích hợp kiểm định Face QA (`FaceQaEvaluator`) dựa trên ArcFace Cosine Similarity để đảm bảo khuôn mặt không bị biến dạng qua các tập.

3. **Nhất Quán Trang Phục & Dấu Hiệu Nhận Dạng (Wardrobe & Distinguishing Marks):**
   - Quản lý trang phục nhân vật trong bảng `character_wardrobes`. Nhân vật giữ nguyên trang phục qua các cảnh trừ khi kịch bản yêu cầu thay đồ.
   - Lưu các đặc điểm đặc biệt không thể quên: vết sẹo, nốt ruồi, hình xăm, kính mắt (`distinguishing_marks`).

4. **Đạo Cụ Đặc Biệt & Trạng Thái Thế Giới (Canon Memory & Key Props):**
   - Theo dõi các vật phẩm quan trọng trong bảng `key_props` (ví dụ: *Con Chip Lượng Tử, Chiếc Bật Lửa Khắc Chữ, Bản Đồ Mật*).
   - Lưu trữ chính xác ai đang nắm giữ đồ vật (`current_holder_id`) và tình trạng đồ vật (`intact`, `damaged`, `lost`, `destroyed`).

5. **Chuẩn Hóa Kịch Bản Text Tự Động (Script Normalizer):**
   - Nhập kịch bản dưới dạng văn bản tiếng Việt tự do (phân cảnh, hành động, thoại).
   - Tự động bóc tách nhân vật, địa điểm, góc máy, chuyển động camera.
   - Tự động kiểm tra tính logic và mâu thuẫn cốt truyện bằng `ContinuityAuditor` (ví dụ: nhân vật đã chết có xuất hiện lại không, đạo cụ có bị phân thân không).

6. **Đa Giọng Thoại Nhân Vật & Hòa Âm Điện Ảnh (Multi-Character Audio):**
   - Mỗi nhân vật được gán một giọng đọc riêng (`voice_profile_id` từ ElevenLabs hoặc LucyLab).
   - Chuẩn hóa phát âm tiếng Việt (ngày tháng, số hiệu, từ vay mượn) qua `normalizeVietnameseForTts`.
   - Hòa âm SFX và nhạc nền BGM với thuật toán **Auto-Ducking Sidechain Compression** (nhạc nền tự động giảm âm khi nhân vật cất tiếng nói).

7. **Video Gateway Đa Provider:**
   - **Kling AI (`api_kling`)**: Hỗ trợ I2V / T2V thế hệ mới với image reference.
   - **Runway Gen-3 Alpha Turbo (`api_runway`)**: Chất lượng điện ảnh cao cấp.
   - **Local ComfyUI / Wan 2.2 (`local_comfyui`)**: Chạy GPU cục bộ không tốn chi phí.
   - **Mock Adapter (`mock`)**: Giả lập video để thử nghiệm kịch bản, âm thanh và dòng chảy phân cảnh tức thì mà không tốn tiền API.

---

## 🚀 Hướng Dẫn Sử Dụng Nhanh (Quick Start)

### Bước 1: Khởi tạo Series mới
```bash
npm run series -- series:init \
  --series "cyber-saigon" \
  --title "Sài Gòn 2088" \
  --genre "Cyberpunk Noir" \
  --style "Cinematic 35mm, gritty cyberpunk, neon lights, rainy Saigon alleys, photorealistic 8k" \
  --ratio 9:16
```

### Bước 2: Đăng ký Nhân Vật
```bash
# Nhân vật chính: Thám tử Minh
npm run series -- series:character \
  --series "cyber-saigon" \
  --id "char_minh" \
  --name "Minh" \
  --role "protagonist" \
  --face "assets/characters/minh_face.jpg" \
  --voice "elevenlabs:voice_minh_123" \
  --wardrobe "Áo măng tô dạ màu nâu xám sờn vai, sơ mi trắng mở cúc cổ" \
  --marks "Vết sẹo mảnh ngang mày trái"

# Nhân vật hỗ trợ: Hacker An
npm run series -- series:character \
  --series "cyber-saigon" \
  --id "char_an" \
  --name "An" \
  --role "supporting" \
  --face "assets/characters/an_face.jpg" \
  --voice "lucylab:voice_an_456" \
  --wardrobe "Áo hoodie dạ quang xanh lá, tai nghe chụp cổ"
```

### Bước 3: Đăng ký Bối Cảnh Lặp Lại (Locations)
```bash
npm run series -- series:location \
  --series "cyber-saigon" \
  --id "loc_bar_hem9" \
  --name "Quán Bar Hẻm 9" \
  --summary "Quán bar ngầm dưới lòng đất ngập khói thuốc, đèn neon đỏ mờ ảo, quầy bar gỗ cũ" \
  --lighting "neon red and cyan contrast"
```

### Bước 4: Đăng ký Đạo Cụ Đặc Biệt "Không Được Quên" (Key Props)
```bash
npm run series -- series:prop \
  --series "cyber-saigon" \
  --id "prop_chip" \
  --name "Con Chip Lượng Tử" \
  --summary "Chip vi xử lý lượng tử kích thước nhỏ, phát ánh sáng xanh ngọc khi được kích hoạt" \
  --holder "char_minh" \
  --status "intact"
```

### Bước 5: Xem Trạng Thái Story Bible
```bash
npm run series -- series:status --series "cyber-saigon"
```

### Bước 6: Sản Xuất Tập Phim
```bash
# Chạy thử nghiệm giả lập (Dry-run / Mock)
npm run series -- series:episode \
  --series "cyber-saigon" \
  --script "scripts/example-series/cyber-saigon-ep1.txt" \
  --dry-run

# Chạy sản xuất thật với Kling AI hoặc Runway
npm run series -- series:episode \
  --series "cyber-saigon" \
  --script "scripts/example-series/cyber-saigon-ep1.txt" \
  --provider api_kling
```

---

## 📝 Định Dạng Kịch Bản Text Thô Mẫu (`scripts/example-series/cyber-saigon-ep1.txt`)

```text
TẬP 1: BẢN HỢP ĐỒNG BÓNG ĐÊM
Logline: Thám tử Minh bí mật bàn giao Con Chip Lượng Tử cho hacker An tại quán Bar Hẻm 9.

CẢNH 1: QUÁN BAR HẺM 9 - ĐÊM
Nhân vật: Minh, An
Đạo cụ: Con Chip Lượng Tử

CÚ MÁY 1 (establishing, 4s): Khung cảnh hẻm tối Sài Gòn 2088 ngập tràn ánh đèn neon đỏ và xanh mờ ảo dưới màn mưa lất phất.
CÚ MÁY 2 (medium, 4s): Minh ngồi trong góc khuất của quán Bar Hẻm 9, ánh mắt cảnh giác nhìn ra cửa, tay cầm chiếc hộp kim loại.
MINH: Cầm lấy con chip này. Bọn chúng đã lần theo tín hiệu đến tận đây rồi.
CÚ MÁY 3 (close_up, 4s): An mở chiếc hộp nhỏ, ánh sáng xanh ngọc từ con chip vi xử lý lượng tử phản chiếu vào mắt.
AN: Chip mã hóa 5 lớp... Tôi sẽ cần ít nhất 3 giờ để giải mã toàn bộ dữ liệu.
CÚ MÁY 4 (action, 3s): Đột nhiên tiếng bước chân dồn dập vang lên từ cầu thang, bóng đen sát thủ xuất hiện sau tấm rèm.
MINH: Cửa sau! Đi mau!
```

---

## 🗄️ Cấu Trúc Dữ Liệu SQLite Story Bible

Toàn bộ ngữ cảnh của series được lưu trữ bền vững tại `data/series/<series-id>/story_bible.db`:
- `series_metadata`: Lưu thông tin series, Art Style, tỷ lệ khung hình, negative prompt.
- `characters`: Nhân vật, vai trò, vết sẹo, giọng nói, trạng thái sống/chết.
- `character_wardrobes`: Bộ sưu tập trang phục của từng nhân vật.
- `locations`: Danh sách địa điểm, quy tắc ánh sáng, bầu không khí.
- `key_props`: Danh sách đạo cụ, tình trạng hư hại, ai đang cầm.
- `world_state`: Các sự kiện lớn đã xảy ra làm thay đổi thế giới.
- `character_knowledge`: Nhân vật nào biết bí mật gì.
- `episode_summaries`: Tóm tắt chi tiết các sự kiện của từng tập đã phát sóng.
