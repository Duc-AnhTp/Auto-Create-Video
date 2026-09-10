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
# Chạy thử nghiệm giả lập (Dry-run / Mock Media hợp chuẩn)
npm run series -- series:episode \
  --series "cyber-saigon" \
  --script "scripts/example-series/cyber-saigon-pilot-2min.txt" \
  --dry-run

# Chạy sản xuất thật với Kling AI hoặc Runway
npm run series -- series:episode \
  --series "cyber-saigon" \
  --script "scripts/example-series/cyber-saigon-pilot-2min.txt" \
  --provider api_kling
```

### Bước 7: Tiếp Tục Sau Gián Đoạn (Resume from Checkpoint)
Nếu quá trình sinh video bị ngắt quãng (mất mạng, timeout, hết quota tạm thời), hệ thống tự động lưu `checkpoint.json`. Bạn có thể tiếp tục sản xuất ngay mà không cần sinh lại các shot đã thành công:
```bash
npm run series -- series:resume \
  --series "cyber-saigon" \
  --episode 1
```

### Bước 8: Tái Tạo Riêng Shot Lỗi (Single-Shot Reroll)
Khi một shot cụ thể chưa đạt chất lượng (ví dụ biến dạng khuôn mặt hoặc sai chuyển động), tạo lại riêng shot đó với take mới mà không ảnh hưởng tới toàn bộ phim:
```bash
npm run series -- series:reroll \
  --series "cyber-saigon" \
  --episode 1 \
  --shot "sc1_sh2" \
  --prompt "Minh ngồi góc khuất ánh neon rực rỡ, ánh mắt sắc bén"
```

### Bước 9: Dựng Lại Video Từ Các Clip Đã Duyệt (Remux Only)
Ghép lại video hoàn chỉnh từ các take được duyệt gần nhất mà hoàn toàn không gọi lại AI Video hay TTS (tiết kiệm 100% chi phí):
```bash
npm run series -- series:remux \
  --series "cyber-saigon" \
  --episode 1
```

### Bước 10: Xem & Duyệt Trên Web Review Dashboard
Mở giao diện vi mô để đạo diễn xem danh sách cảnh, các shot, nghe thử âm thanh, kiểm tra điểm Face QA và bấm nút chọn take:
```bash
npm run series -- series:review \
  --series "cyber-saigon" \
  --episode 1 \
  --port 3001
```

---

## 📝 Định Dạng Kịch Bản Phân Cảnh Tiếng Việt (Screenplay Syntax v3.0)

Hệ thống hỗ trợ cú pháp phân cảnh chuyên nghiệp, linh hoạt và trực quan:
- **Tập phim:** `TẬP <số>: <TIÊU ĐỀ>` hoặc `EPISODE <số>: <TITLE>`
- **Tóm tắt / Logline:** `Logline: <Mô tả cốt truyện>` hoặc `Tóm tắt: <...>`
- **Nhạc nền:** `BGM: <tên_file_hoặc_preset>` (ví dụ: `cyber_suspense`)
- **Phân cảnh:** `CẢNH <số>: <TÊN BỐI CẢNH> - <THỜI ĐIỂM>` hoặc `SCENE <số>: <LOCATION> - <TIME>`
- **Nhân vật & Đạo cụ trong cảnh:** `Nhân vật: <Tên 1>, <Tên 2>`, `Đạo cụ: <Tên Đạo Cụ 1>, <Tên Đạo Cụ 2>`
- **Cú máy (Shot):**
  - Cú pháp chuẩn: `CÚ MÁY <số> (<loại_shot>, <thời_lượng>s): <Mô tả thị giác>`
  - Cú pháp tiếng Anh: `SHOT <number> (<shot_type>, <duration>s): <Visual prompt>`
  - Cú pháp khối có ngoặc vuông: `[SHOT 1: TOÀN CẢNH]`, `[SHOT 2: CẬN CẢNH]` kèm dòng `THỜI LƯỢNG: 4s` và `HÌNH ẢNH: ...`
  - Các loại góc máy được hỗ trợ: `establishing` (thiết lập), `wide` (toàn cảnh), `medium` (trung cảnh), `close_up` (cận cảnh), `extreme_close_up` (đại cận cảnh), `action` (hành động), `over_the_shoulder` (qua vai), `pov` (góc nhìn nhân vật).
- **Hội thoại đa lượt trong một cú máy (Multi-Turn Dialogue):**
  - Hỗ trợ nhiều câu thoại liên tiếp của nhiều nhân vật trong cùng một shot, bảo toàn 100% thứ tự nói.
  - Cú pháp thoại trực tiếp: `<TÊN NHÂN VẬT>: <Lời thoại>`
  - Cú pháp kèm chỉ dẫn diễn xuất: `<TÊN NHÂN VẬT> (<chỉ dẫn>): "<Lời thoại>"` (ví dụ: `MINH (thì thào): "Bọn chúng đến rồi!"`)
  - Cú pháp dẫn chuyện / Voiceover: `DẪN CHUYỆN: <Nội dung>` hoặc `VOICEOVER: <Nội dung>`
  - Bảo toàn dấu ngoặc kép và dấu hai chấm bên trong câu thoại (ví dụ: `MINH: "Chú ý: tín hiệu đã bật!"`).

### Ví dụ Kịch Bản Mẫu Đa Thoại & Chỉ Dẫn Diễn Xuất:
```text
TẬP 1: BẢN HỢP ĐỒNG BÓNG ĐÊM (PILOT 2-3 PHÚT)
Logline: Thám tử Minh bí mật bàn giao Con Chip Lượng Tử cho hacker An tại quán Bar Hẻm 9.
BGM: cyber_suspense

CẢNH 1: QUÁN BAR HẺM 9 - ĐÊM
Nhân vật: Minh, An
Đạo cụ: Con Chip Lượng Tử

CÚ MÁY 1 (establishing, 4s): Toàn cảnh Hẻm 9 Sài Gòn 2088 rực rỡ ánh neon phản chiếu trên vũng mưa axit.
DẪN CHUYỆN: Sài Gòn năm 2088, nơi những bí mật đắt giá hơn cả mạng sống con người.

CÚ MÁY 2 (medium, 5s): Minh và An ngồi đối diện nhau qua chiếc bàn kim loại ẩm ướt trong góc tối quán bar.
MINH (thì thào): "Cầm lấy con chip này: bọn tập đoàn đã lần ra vị trí rồi!"
AN (nghi hoặc): "Có bẫy không? Mã hóa này trông quá hoàn hảo."
MINH: "Không còn thời gian đâu, đi ngay!"

CÚ MÁY 3 (close_up, 3.5s): An cẩn thận đưa con chip phát ánh sáng xanh ngọc vào thiết bị giải mã di động.
AN: "Cần đúng 3 phút tại trạm phát ngầm."
```

---

## 🎯 3 Tầng Văn Bản Tách Biệt (Text Track Separation)

Để phục vụ hiển thị phụ đề điện ảnh chuẩn xác và tối ưu ngữ âm cho các mô hình AI TTS (ElevenLabs, LucyLab), mỗi câu thoại được tự động phân tách thành 3 tầng:
1. **`rawText` (Văn bản gốc):** Giữ nguyên toàn bộ cú pháp kịch bản người viết nhập, bao gồm cả tên người nói, chỉ dẫn diễn xuất `(thì thào)` và dấu câu.
2. **`subtitleText` (Văn bản phụ đề):** Văn bản sạch sẽ hiển thị trên màn hình video — tự động loại bỏ chỉ dẫn diễn xuất, làm sạch cặp dấu ngoặc kép bao ngoài nhưng giữ nguyên dấu hai chấm và dấu câu biểu cảm bên trong.
3. **`ttsText` (Văn bản đọc AI TTS):** Văn bản được chuẩn hóa ngữ âm tiếng Việt qua `normalizeVietnameseForTts`: chuyển đổi số đếm (ví dụ: `3 phút` → `ba phút`), đơn vị tiền tệ (`$500` → `năm trăm đô la`), đơn vị kỹ thuật (`5000mAh` → `năm nghìn mi li am pe giờ`), và viết hoa viết thường phù hợp ngữ điệu AI.

---

## 🛑 Báo Lỗi Kịch Bản Rõ Ràng & Có Vị Trí (`ScreenplayParseError`)

Hệ thống **tuyệt đối không âm thầm nuốt lỗi** hay tự gom kịch bản sai thành một shot duy nhất rồi báo thành công giả tạo:
- Khi kịch bản gặp lỗi cú pháp (ví dụ: câu thoại nằm ngoài phân cảnh, cú máy thiếu thời lượng, hoặc phân cảnh không có cú máy nào), parser sẽ ném ra ngoại lệ `ScreenplayParseError`.
- Thông báo lỗi hiển thị rõ ràng:
  - **Dòng và cột:** `[Lỗi Kịch Bản Dòng 14:1]`
  - **Mô tả lỗi:** Chi tiết nguyên nhân vi phạm.
  - **Đoạn code vi phạm:** Trích đoạn nội dung thực tế trên dòng lỗi (`Dòng lỗi: "..."`).
  - **Gợi ý khắc phục:** Hướng dẫn cụ thể để tác giả chỉnh sửa kịch bản ngay lập tức (`Gợi ý khắc phục: ...`).

---

## 👥 Nhận Diện Nhân Vật & Quản Lý Unresolved Characters

Hệ thống bảo vệ tính nhất quán giọng nói và vai diễn của Story Bible:
- **Tự động gắn kết:** Tên nhân vật trong kịch bản được tự động đối chiếu với danh bạ `characters` trong Story Bible SQLite. Nếu trùng khớp, hệ thống tự động gán `characterId` và `voiceProfileId` đã cấu hình.
- **Phát hiện vai chưa xác định (`isUnresolved`):**
  - Nếu xuất hiện nhân vật mới chưa từng đăng ký trong Story Bible (ví dụ: `LÍNH GÁC: "Dừng lại!"`), nhân vật này được đánh dấu `isUnresolved: true` và gom vào danh sách `unresolvedCharacters`.
  - **Chế độ kiểm tra nghiêm ngặt (`--strict-characters`):** Nếu bật cờ này trong CLI hoặc cấu hình pipeline, hệ thống sẽ **chặn đứng quá trình sản xuất** và yêu cầu người dùng đăng ký nhân vật hoặc cung cấp bản đồ ánh xạ `characterMapping`, tuyệt đối không tự ý gán giọng mặc định cho một vai có tên.
  - Bản đồ ánh xạ tùy biến: Cho phép truyền `characterMapping: { "LÍNH GÁC": "char_minh" }` để liên kết các vai phụ vào hồ sơ diễn viên tương ứng.

---

## 🔄 Hướng Dẫn Migration Nhanh (Schema v3.0 Migration Guide)

### Cập nhật Schema v3.0:
Phiên bản 3.0 bổ sung các trường dữ liệu bắt buộc và nâng cấp quan trọng:
- `schemaVersion: "3.0"`
- `sceneId` dạng chuẩn `sc01`, `sc02`,...
- `shotId` gắn liền với phân cảnh: `sc01_sh01`, `sc01_sh02`,...
- `dialogueId` gắn liền với cú máy: `sc01_sh01_d01`, `sc01_sh01_d02`,...
- `dialogues: DialogueLine[]` thay thế cho trường `dialogue` đơn lẻ cũ (hệ thống duy trì cơ chế tương thích ngược 2 chiều: `shot.dialogue` luôn trỏ về câu thoại đầu tiên `shot.dialogues[0]`).

### Chuyển đổi Kịch Bản JSON Cũ (v1.0 / v2.0):
Nếu bạn có các file JSON kịch bản được tạo từ các phiên bản trước, sử dụng hàm `migrateScriptToLatest` trong mã nguồn hoặc chạy tự động qua `parseRawScreenplay`:
```typescript
import { migrateScriptToLatest } from "./src/series/series-schema.js";

const legacyScript = JSON.parse(fs.readFileSync("old-script-v2.json", "utf8"));
const modernScript = migrateScriptToLatest(legacyScript);
// modernScript hiện đã có schemaVersion: "3.0", đầy đủ dialogues array, dialogueId, và text tracks!
```

---

## ⏱️ Unified Timeline Engine & Phân Tách 4 Audio Stems (Timeline v3.0)

Để giải quyết triệt để vấn đề lệch pha hình–tiếng khi video chạy theo lịch shot độc lập với âm thanh, hệ thống áp dụng bộ lập lịch dòng thời gian thống nhất (`TimelineScheduler`):

### 1. Timebase Nguyên Khung Hình (Integer Frame-Locked Timebase):
- Mọi mốc thời gian của shot hình ảnh, câu thoại, hiệu ứng SFX và phụ đề đều được khóa theo số nguyên frame:
  $$\text{frame} = \text{round}(\text{sec} \times \text{fps})$$
  $$\text{sec} = \frac{\text{frame}}{\text{fps}}$$
- Triệt tiêu tích lũy sai số làm tròn số thực dấu phẩy động qua nhiều cảnh.

### 2. Đo Thời Lượng TTS Thật Trước Khi Chốt Timeline:
- Hệ thống tổng hợp hoặc giả lập đo đạc giọng đọc TTS thật (`measuredTtsDurations`) trước khi chốt mốc thời gian của shot.
- Không suy đoán thời lượng từ số chữ trên văn bản khi sản xuất thật.

### 3. Chính Sách Xử Lý Khi Thoại Dài Hơn Cú Máy (Dialogue Overflow Policies):
Khi thời lượng thoại thực tế vượt quá thời lượng cú máy trong kịch bản:
- **`extend_shot` (Mặc định):** Tự động kéo dài thời lượng của cú máy (cả hình và tiếng) để chứa trọn vẹn toàn bộ các câu thoại cộng với khoảng đệm sau thoại (mặc định 0.3s). Không âm thầm cắt thoại, không tăng tốc độ giọng đọc làm biến dạng âm sắc.
- **`split_shot`:** Chia tách cú máy thành các nhịp hình ảnh tương ứng với từng lượt thoại.
- **`error`:** Ném ngoại lệ `DialogueOverflowError`, báo rõ cú máy, câu thoại, số giây vượt quá và hướng dẫn tác giả kéo dài cú máy hoặc rút gọn thoại.

### 4. Bảo Toàn Khoảng Lặng & Cú Máy Không Thoại:
- Các cú máy không thoại (toàn cảnh mở đầu, cú máy hành động) được tạo khối im lặng chính xác bằng độ dài cú máy trên stem thoại.
- Các khoảng lặng tự nhiên giữa 2 lượt đối thoại (mặc định 0.15s - 0.2s) được xếp lịch thành khoảng lặng nguyên frame, giữ đúng nhịp điệu điện ảnh.

### 5. Tính Toán Chồng Lấn Chuyển Cảnh (Transition Overlap):
- Khi sử dụng chuyển cảnh hoà tan (crossfade $\Delta_{\text{trans}} = 0.4\text{s}$):
  $$\text{Tổng thời lượng} = \sum \text{thời lượng shot} - \sum \text{thời lượng overlap}$$
- Dòng thời gian hình ảnh và âm thanh được đồng bộ theo đúng tổng thời lượng sau khi trừ phần giao thoa, triệt tiêu độ lệch pha tích lũy.

### 6. Phân Tách 4 Audio Stems & Master Soundtrack:
Hệ thống tự động xuất các track âm thanh riêng biệt tại thư mục `audio/stems/`:
- `stem_dialogue.mp3`: Toàn bộ giọng thoại và voiceover, có đệm khoảng lặng tuyệt đối.
- `stem_sfx.mp3`: Toàn bộ hiệu ứng âm thanh đặt đúng mốc frame.
- `stem_ambience.mp3`: Âm thanh khí quyển/môi trường bối cảnh (mưa, tiếng đường phố, tiếng quán bar).
- `stem_bgm.mp3`: Nhạc nền đã hòa âm Auto-Ducking (tự động hạ âm lượng khi có người nói).
- `master-soundtrack.mp3`: Bản mixdown tổng hợp từ 4 stems.

### 7. Xuất Phụ Đề Tự Động (SRT & WebVTT):
- Tạo file `subtitles.srt` và `subtitles.vtt` tự động.
- Sử dụng **văn bản phụ đề hiển thị gốc** (`subtitleText`), tuyệt đối không dùng văn bản ngữ âm biến đổi cho TTS (`ttsText`).

### 8. Loại Bỏ Cờ `-shortest` & Kiểm Soát Sai Lệch Thực Đo:
- **Tuyệt đối không dùng `-shortest`** trong FFmpeg để che giấu sự chênh lệch giữa video và audio.
- Quá trình dựng đo đạc thực tế thời lượng video và audio qua `ffprobe`:
  - Dung sai cho phép: 1 frame ($\frac{1}{\text{fps}} \approx 33.3\text{ms}$) + dung sai đóng gói codec audio ($\approx 50\text{ms}$) = $\approx 83.3\text{ms}$.
  - Nếu độ lệch vượt ngưỡng, hệ thống phát cảnh báo rõ ràng kèm số mili-giây sai lệch thực tế.
- **Lưu ý minh bạch theo Quy tắc 10:** Việc đặt audio đúng timecode theo khung hình cú máy là đồng bộ dòng thời gian (*cue timecode synchronization*), **không phải và không được tuyên bố là đồng bộ khẩu hình (*lip-sync*)** (vốn đòi hỏi mô hình hoạt họa biến dạng điểm mút môi Wav2Lip/SadTalker).

---

## 🗄️ Cấu Trúc Dữ Liệu SQLite Story Bible

Toàn bộ ngữ cảnh của series được lưu trữ bền vững tại `data/series/<series-id>/story_bible.db`:
- `series_metadata`: Lưu thông tin series, Art Style, tỷ lệ khung hình, negative prompt, fps.
- `characters`: Nhân vật, vai trò, vết sẹo nhận dạng, giọng nói, trạng thái sống/chết/bị thương.
- `character_wardrobes`: Bộ sưu tập trang phục của từng nhân vật xuyên suốt các cảnh.
- `locations`: Danh sách địa điểm, quy tắc ánh sáng, khí quyển không gian.
- `key_props`: Danh sách đạo cụ đặc biệt, tình trạng hư hại, người đang nắm giữ hiện tại.
- `world_state`: Các biến cố lớn làm thay đổi thế giới (ví dụ `corporation_alert_level: RED`).
- `character_knowledge`: Nhân vật nào đã biết bí mật gì từ tập mấy.
- `episode_summaries`: Tóm tắt chi tiết các sự kiện và Canon Delta của từng tập đã phát sóng.
- `shot_takes`: Lưu trữ toàn bộ các lần tạo/phiên bản của từng shot (provider, prompt, seed, local_path, qa_status, qa_score, cost_usd, is_approved).
- `api_usage_logs`: Lưu vết từng lệnh gọi API, thời gian, chi phí USD để kiểm soát ngân sách.

---

## 💻 Tạo Video Cục Bộ Miễn Phí Với Local GPU (ComfyUI / Wan 2.1 - 2.2)

Hệ thống hỗ trợ chạy sinh video hoàn toàn cục bộ trên GPU nội bộ (NVIDIA RTX 3090/4090 hoặc cao hơn) với chi phí $0 API:

1. **Khởi động ComfyUI:**
   Chạy ComfyUI với model Wan 2.1 / Wan 2.2 (ví dụ `wan2.1_i2v_720p_14B.safetensors`) và ComfyUI-VideoHelperSuite (`VHS_VideoCombine`).
   ```bash
   # Mặc định lắng nghe tại http://127.0.0.1:8188
   python main.py --listen 127.0.0.1 --port 8188
   ```

2. **Cấu hình môi trường:**
   Thiết lập biến môi trường trong `.env`:
   ```env
   COMFYUI_BASE_URL=http://127.0.0.1:8188
   ```

3. **Sản xuất tập phim bằng local ComfyUI:**
   ```bash
   npm run series -- series:episode \
     --series "cyber-saigon" \
     --script "scripts/example-series/cyber-saigon-pilot-2min.txt" \
     --provider local_comfyui
   ```

---

## 🛡️ Cơ Chế Tự Động Dự Phòng (Auto-Failover) & Ngắt Mạch (Circuit Breaker)

Để bảo đảm quá trình render không bị gián đoạn giữa chừng do provider đám mây sập hoặc mất kết nối GPU cục bộ, Video Gateway được trang bị cơ chế tự động chuyển vùng dự phòng:

- **Auto-Failover:** Khi provider chính gặp lỗi (HTTP 500, mạng timeout, hoặc mất kết nối ComfyUI), Gateway ghi nhận cảnh báo và tự động chuyển sang provider tiếp theo trong chuỗi dự phòng (`fallbackChain`).
- **Circuit Breaker:** Sau 3 lần thất bại liên tiếp trên một provider, Circuit Breaker tự động chuyển sang trạng thái `OPEN` để tránh tiêu tốn thời gian timeout lặp đi lặp lại.
- **Budget Cap Protection:** Kiểm soát chi phí thời gian thực, tự động ngắt ngay lập tức nếu tổng chi phí vượt quá giới hạn ngân sách cấu hình (mặc định $25/tập).

---

## 🧩 Ma Trận Năng Lực Provider & Cơ Chế Tạo/Nối Shot Đa Phân Đoạn (Provider Contracts v3.0)

Để đảm bảo tính tương thích tuyệt đối với tài liệu chính thức của các mô hình video AI và loại bỏ việc gửi dữ liệu sai quy chuẩn:

### 1. Ma Trận Năng Lực Chính Thức (Provider Capability Matrix)

| Tiêu Chí Năng Lực | Kling AI (`api_kling`) | Google DeepMind Veo 3.1 (`api_veo`) | ByteDance Seedance 2.0 (`api_seedance`) | RunwayML Gen-3 (`api_runway`) | Local ComfyUI (`local_comfyui`) | Mock Simulator (`mock`) |
|---|---|---|---|---|---|---|
| **Phiên bản API / Model** | v1.5 / v3.0 (`kling-v3`, I2V/T2V) | Veo 3.1 (`veo-3.1:predictLongRunning`) | Seedance 2.0 (`seedance-2.0` Ark API) | `gen3a_turbo` (Version `2024-09-13`) | Wan 2.1 / Wan 2.2 / ComfyUI v0.3+ | v3.0 Deterministic Media Generator |
| **Tài liệu chính thức** | [Kling API Docs](https://klingai.com/api/document) | [Vertex AI Veo Docs](https://cloud.google.com/vertex-ai/generative-ai/docs/image/generate-videos) | [Volcengine Ark Docs](https://www.volcengine.com/docs/82379/1344400) | [Runway API Docs](https://docs.dev.runwayml.com) | [ComfyUI Official Repo](https://github.com/comfyanonymous/ComfyUI) | `local://tests/mock-adapter` |
| **Xác thực (Auth)** | `Authorization: Bearer <KLING_KEY>` | `x-goog-api-key: <KEY>` hoặc `Bearer <TOKEN>` | `Authorization: Bearer <SEEDANCE_KEY>` | `Authorization: Bearer <KEY>` + `X-Runway-Version` | Không yêu cầu (Localhost port 8188) | Không yêu cầu |
| **Chế độ hỗ trợ** | `t2v`, `i2v` | `t2v`, `i2v` | `t2v`, `i2v` | `t2v`, `i2v` | `t2v`, `i2v` | `t2v`, `i2v` |
| **Thời lượng cho phép** | Rời rạc: strictly `[5, 10]` giây | Rời rạc: strictly `[5, 10]` giây | Rời rạc: strictly `[5, 10]` giây | Rời rạc: strictly `[5, 10]` giây | Liên tục: `1` đến `15` giây | Liên tục: `0.1` đến `60` giây |
| **Tỷ lệ khung hình** | `9:16`, `16:9`, `1:1` | `16:9`, `9:16` | `9:16`, `16:9`, `1:1` | `768:1280` (9:16), `1280:768` (16:9) | `9:16`, `16:9`, `1:1` (tùy biến) | `9:16`, `16:9`, `1:1` |
| **Hỗ trợ Seed cố định** | ✅ Có (Kling 3.0 integer seed) | ✅ Có (integer seed tái tạo) | ✅ Có (integer seed tái tạo) | ✅ Có (integer 1..4294967295) | ✅ Có (KSampler integer seed) | ✅ Có |
| **Nối frame cuối (I2V)** | ✅ Có (via image2video) | ✅ Có (via image input bytes/URI) | ✅ Có (via image_url content) | ✅ Có (via promptImage) | ✅ Có (via LoadImage node) | ✅ Có |
| **Giao thức ảnh chấp nhận**| `public_url`, `base64_data_uri` | `public_url`, `base64_data_uri` | `public_url`, `base64_data_uri` | `public_url`, `base64_data_uri` | `local_path`, `multipart_upload` | `local_path`, `public_url`, `data_uri` |
| **Tải về tự động từ CDN** | ✅ Bắt buộc (URL tạm thời hết hạn) | ✅ Bắt buộc (Signed URL / GCS URI) | ✅ Bắt buộc (Ark CDN URL) | ✅ Bắt buộc (URL hết hạn) | ✅ Có (qua `/view` endpoint) | ❌ Tạo file trực tiếp cục bộ |
| **Đơn giá tính toán** | $0.12 / giây video | $0.20 / giây video | $0.09 / giây video | $0.15 / giây video | $0.00 / giây | $0.00 / giây |

### 2. Tiền Kiểm Định Năng Lực (Pre-Flight Capability Check)
- Trước khi submit bất kỳ job nào lên gateway, hàm `validateSpecAgainstCapabilities(spec, capabilities)` được kích hoạt.
- Nếu một shot yêu cầu thời lượng không hỗ trợ (ví dụ đòi 7.5s trên Kling/Runway) hoặc tỷ lệ không hỗ trợ (ví dụ 1:1 trên Runway), hệ thống lập tức ném lỗi `CapabilityMismatchError` kèm danh mục tùy chọn hợp lệ để chỉnh sửa, hoàn toàn không gửi job lỗi lên máy chủ gây tốn chi phí.

### 3. Quy Tắc Xử Lý Ảnh Tham Chiếu & Chống Rò Rỉ Đường Dẫn Cục Bộ (Rule 3)
- **Tuyệt đối không gửi đường dẫn file cục bộ** (ví dụ `C:\...` hay `/home/...`) lên API đám mây từ xa.
- Hàm `resolveImageToDataUriOrUrl()`:
  - Nếu là `http://` hoặc `https://`: giữ nguyên URL.
  - Nếu là `data:image/...;base64,...`: giữ nguyên Data URI.
  - Nếu là đường dẫn cục bộ: kiểm tra sự tồn tại trên đĩa (ném lỗi nếu thiếu file) và tự động mã hóa thành chuẩn `data:${mimeType};base64,...`.
  - Đối với ComfyUI cục bộ: file được tải trực tiếp lên thư mục input của ComfyUI qua giao thức chuẩn `multipart/form-data` tại endpoint `/upload/image`.

### 4. Trích Xuất Frame Cuối Thật & Chống Truyền File MP4 Vào Trường Ảnh (Rule 4)
- Khi thực hiện nối shot (autoregressive extension cho shot > 5s):
  - Hàm `extractLastFrame(prevVideo, lastFramePath)` sử dụng FFmpeg với tham số `-sseof -0.1` để trích xuất **frame cuối cùng dạng ảnh tĩnh thực sự** (`.jpg` / `.png`).
  - Kiểm tra tính toàn vẹn của file ảnh (tồn tại trên đĩa và kích thước > 100 bytes).
  - **Tuyệt đối không truyền đường dẫn file video `.mp4` vào trường ảnh tham chiếu**.

### 5. Chuẩn Hóa Toàn Diện Trước Khi Nối Đa Phân Đoạn (Rule 6, 7 & 8)
- Thay thế giả định hard-code `[5, 5]` bằng bộ lập lịch phân đoạn linh hoạt `decomposeShotDuration(shotId, totalDurationSec, options)`.
- Khi tính toán các phân đoạn, hệ thống tính bù trừ chính xác phần hao hụt do chồng lấn chuyển cảnh (crossfade overlap $(N - 1) \times \Delta_{\text{fade}}$), bảo đảm thời lượng xuất ra đạt đúng yêu cầu.
- Trước khi thực hiện hòa trộn qua bộ lọc `xfade`, **mọi clip phân đoạn đều được chuẩn hóa đồng bộ**:
  - `scale` và `pad` về đúng kích thước chuẩn (chẵn điểm ảnh cho H.264).
  - Khóa fps chuẩn (30 fps).
  - Đưa về pixel format chuẩn: `yuv420p`.
  - Đặt lại mốc thời gian: `setpts=PTS-STARTPTS` để triệt tiêu lỗi PTS không liên tục.
  - Cắt chính xác theo thời lượng mục tiêu: `trim=duration=targetDurationSec`.
- **Nguyên tắc xử lý lỗi (Rule 8):** Nếu quá trình ghép đa phân đoạn gặp sự cố FFmpeg, hệ thống **bắt buộc ném ngoại lệ rõ ràng**, tuyệt đối không âm thầm lấy phân đoạn đầu tiên làm đại diện cho toàn bộ shot.

### 6. Phân Biệt Kiểm Thử Mock Contract vs Smoke Test Thật (Rule 3 & 4)
- **Kiểm thử Mock Contract (`provider-contract.test.ts`):** Sử dụng `nock` giả lập máy chủ HTTP để kiểm tra cấu trúc payload, headers xác thực, mã trạng thái polling và xử lý lỗi mà không phát sinh bất kỳ cuộc gọi API trả phí nào ($0 chi phí).
- **Kiểm thử Media Fixture Cục Bộ:** Dùng FFmpeg cục bộ để kiểm chứng trích xuất frame cuối thật, nối 1 đoạn, 2 đoạn, 3 đoạn và đo kiểm sai lệch thời lượng qua `ffprobe`.
- **Smoke Test Sản Xuất Thực Tế (Yêu cầu phê duyệt riêng):** Chỉ thực hiện khi người dùng cung cấp API Key thật và chỉ định rõ provider (`--provider api_kling` hoặc `--provider api_runway`). Khi đó, Gateway sẽ kích hoạt Circuit Breaker và Budget Cap bảo vệ ngân sách.

---

## 🎬 Động Cơ Dựng Phim Phân Cấp & Cache Cảnh (Hierarchical Assembly Engine)

Quy trình dựng các bộ phim nhiều tập từ hàng chục đến hàng trăm shot được phân bổ theo 2 cấp độ độc lập, giải quyết triệt để rào cản tài nguyên:

### 1. Dựng Phân Cấp 2 Cấp Độ (Two-Level Hierarchical Assembly)
- **Cấp 1: Shot $\to$ Scene (`scene_XX.mp4`):**
  - Mỗi phân cảnh tập hợp các shot nội bộ thành một file video phân cảnh hoàn chỉnh.
  - Áp dụng băm mã nội dung **SHA-256 (`sceneHash`)** từ danh sách `takeId` đã duyệt, đường dẫn source clip, phạm vi trim (`trimStartSec`, `trimEndSec`), và các chuyển cảnh nội cảnh (`transitionIn`, `transitionOut`).
  - **Cơ chế Cache Bỏ Qua Render:** Nếu `sceneHash` trùng khớp với lần dựng trước và file `scene_XX.mp4` tồn tại nguyên vẹn trên đĩa, FFmpeg bỏ qua hoàn toàn việc render lại cảnh đó (`isCacheHit: true`).
- **Cấp 2: Scene $\to$ Episode Master (`master.mp4`):**
  - FFmpeg chỉ nhận đầu vào là các file `scene_XX.mp4` đã render (thay vì dồn hàng chục shot cùng lúc).
  - Ghép nối nhanh các phân cảnh thành video Master tổng thể.
- **Giải Quyết Giới Hạn Hạ Tầng:**
  - **Giới hạn 8192 ký tự trên Windows:** Tránh lỗi sập dòng lệnh khi danh sách input hoặc filter graph FFmpeg quá dài.
  - **Giới hạn bộ nhớ RAM:** Tránh mở đồng thời hàng chục decoder luồng video độ phân giải cao cùng lúc, giữ heap memory ổn định (< 150MB).

### 2. Phân Biệt Rõ Ràng Hard Cut vs. Transition Được Chỉ Định
- **Hard Cut (Mặc định):** Mặc định sử dụng filter `concat` trực tiếp, bảo đảm **zero frame loss**, không tự ý chèn mờ ảo hoặc chồng lấn khung hình.
- **Crossfade Transition (Chỉ khi chỉ định):** Chỉ áp dụng bộ lọc `xfade` khi kịch bản hoặc timeline khai báo rõ ràng `durationSec > 0` và kiểu chuyển cảnh (`fade`, `wipeleft`, v.v.).
- **Frame-Accurate Trimming:** Hỗ trợ cắt bỏ phần thừa đầu/đuôi của từng shot qua bộ lọc `trim=start=...:end=...; setpts=PTS-STARTPTS`.

---

## 📦 Gói Sản Phẩm Đầu Ra Toàn Diện (Full Delivery Package)

Mỗi lần xuất bản hoàn chỉnh một tập phim đều tạo ra cấu trúc thư mục phân phối tiêu chuẩn:
```text
output/series/<seriesId>/ep-<episodeNumber>/
├── master.mp4                      # Video Master hoàn chỉnh (H.264 / AAC 1080x1920 hoặc 720x1280)
├── master-audio.wav                # Audio Master đa kênh uncompressed (48kHz 24-bit PCM)
├── subtitles.srt                   # Phụ đề chuẩn SubRip SRT
├── subtitles.vtt                   # Phụ đề chuẩn WebVTT
├── stems/                          # 4 Audio Stems tách rời phục vụ hậu kỳ
│   ├── stem-dialogue.wav           # Kênh giọng thoại nhân vật + khoảng lặng frame-accurate
│   ├── stem-sfx.wav                # Kênh hiệu ứng âm thanh (Foley, va chạm, máy móc)
│   ├── stem-ambience.wav           # Kênh âm thanh khí quyển / không gian bối cảnh
│   └── stem-bgm.wav                # Kênh nhạc nền đã ducking âm lượng khi có thoại
├── nle/                            # Định dạng trao đổi cho phần mềm dựng phim chuyên nghiệp
│   ├── timeline.xml                # FCP7 XML (xmeml v4) cho DaVinci Resolve & Premiere Pro
│   └── timeline.otio               # OpenTimelineIO JSON (chuẩn trao đổi phim Hollywood)
├── scenes/                         # Video cache từng phân cảnh
│   ├── scene_01.mp4
│   └── scene_02.mp4
└── assembly-manifest.json          # Manifest cấu trúc 1:1 lưu vết đầy đủ để dựng lại
```

---

## 🎞️ Định Dạng Trao Đổi NLE Chuẩn (FCP7 XML & OpenTimelineIO)

Để hỗ trợ đạo diễn và dựng phim chuyển đổi linh hoạt sang các công cụ hậu kỳ chuyên nghiệp (DaVinci Resolve, Adobe Premiere Pro, Final Cut Pro):
- **FCP7 XML (`timeline.xml`):** Tuân thủ cấu trúc `xmeml version="4"` với timebase chuẩn, các track Video, Audio thoại, SFX, Ambience, BGM và các điểm `in/out` frame-accurate theo trim.
- **OpenTimelineIO (`timeline.otio`):** Tuân thủ schema `Timeline.1` và `Stack.1`, biểu diễn cấu trúc track đa tầng và các clip media tham chiếu.
- **Lưu ý minh bạch kiểm chứng:** Cú pháp XML và schema OpenTimelineIO JSON đã được xác minh tính hợp lệ qua parser tự động; hệ thống chưa kiểm tra import trực tiếp trên giao diện GUI DaVinci Resolve hoặc Premiere Pro.

---

## 🔍 Bộ Kiểm Định QA Bản Dựng Tự Động (Automated Assembly QA Verifier)

Trước khi đóng gói bàn giao, module `verifyAssemblyQa` tự động quét toàn bộ sản phẩm:
- **Dò tìm frame đen bất thường (`blackdetect`):** Sử dụng filter FFmpeg `blackdetect=d=0.5:pix_th=0.10` để phát hiện các đoạn hình ảnh đen kéo dài bất thường do lỗi render.
- **Đo kiểm sai lệch hình–tiếng (`driftSec`):** Phân tích thời lượng thực tế của master video và master audio qua `ffprobe`. Nếu độ lệch vượt quá dung sai cho phép ($|\text{drift}| > 0.1\text{s}$), hệ thống gắn cờ cảnh báo.
- **Kiểm tra tính toàn vẹn file:** Xác minh tất cả các file source take đã duyệt và file output đều tồn tại trên đĩa, dung lượng > 0 và không bị hỏng container.

---

## 📊 Bảng Phân Nhóm Trạng Thái Tính Năng

Tuân thủ Quy tắc 10, hệ thống phân định rành mạch 3 nhóm tính năng:

| Trạng Thái | Tính Năng | Bằng Chứng / Ghi Chú Kỹ Thuật |
|---|---|---|
| **Hoạt Động Ổn Định (Production Ready)** | Dựng phim phân cấp (Hierarchical Assembly) | Ghép cảnh $\to$ tập, băm cache SHA-256, test suite tích hợp chạy qua 100%. |
| **Hoạt Động Ổn Định (Production Ready)** | Quản lý Take đã duyệt (Approved Take Locking) | Manifest khóa chặt ID take, kiểm tra tính hợp lệ qua Zod schema. |
| **Hoạt Động Ổn Định (Production Ready)** | Phân tách 4 Audio Stems & Subtitles | Xuất `stem-dialogue`, `stem-sfx`, `stem-ambience`, `stem-bgm`, SRT/VTT. |
| **Hoạt Động Ổn Định (Production Ready)** | Tự động kiểm định QA bản dựng | Dò tìm frame đen (`blackdetect`), kiểm tra file hỏng qua `ffprobe`, đo A/V drift. |
| **Hoạt Động Ổn Định (Production Ready)** | Dòng thời gian nguyên khung hình (Frame-locked) | Timebase 30fps cố định, bảo toàn khoảng lặng không thoại. |
| **Đang Thử Nghiệm (Beta)** | Xuất Timeline trao đổi NLE (FCP7 XML & OTIO) | Cú pháp XML xmeml v4 và OTIO JSON đã qua kiểm thử schema; chưa kiểm tra trên GUI DaVinci/Premiere. |
| **Đang Thử Nghiệm (Beta)** | Face QA Cosine Similarity | Thuật toán so khớp vector embedding ArcFace; cần GPU và model trích xuất cục bộ cho production. |
| **Đang Thử Nghiệm (Beta)** | Tự động ngắt mạch & Ngân sách (Circuit Breaker) | Kiểm thử mock contract qua `nock`; cần kích hoạt API key thật trong môi trường thực. |
| **Chưa Hỗ Trợ (Roadmap Limitations)** | Đồng bộ khẩu hình diễn viên (Lip-sync AI) | Hệ thống hiện chỉ đồng bộ timecode thoại vào cú máy; chưa tích hợp model biến dạng cơ môi (Wav2Lip). |
| **Chưa Hỗ Trợ (Roadmap Limitations)** | Diễn xuất cơ mặt phức tạp (Micro-expression AI) | Các model video AI hiện tại chưa kiểm soát được vi biểu cảm theo từng frame. |
| **Chưa Hỗ Trợ (Roadmap Limitations)** | Nhất quán tuyệt đối 100% hình thể nhân vật | AI sinh hình ảnh video có sự biến thiên góc nhìn tự nhiên giữa các shot; cần human review phê duyệt take. |

---

## 🚀 Điều Kiện Cần Đạt Trước Khi Chuyển Sang Phim 10 Phút Hoặc Dài Hơn

Để nâng quy mô từ phim thử nghiệm 2–3 phút lên tập phim tiêu chuẩn 10 phút hoặc dài hơn:
1. **Lưu trữ phân tán hoặc SSD tốc độ cao:** Phim 10 phút (~120–150 shots) sản sinh 10GB–25GB raw clips và intermediate takes; cần tối thiểu 100GB dung lượng trống.
2. **Hàng đợi Job phân tán (BullMQ / Redis):** Nâng cấp từ bộ nhớ SQLite in-process lên hàng đợi background worker để quản lý render đa luồng song song trên nhiều máy trạm hoặc GPU nodes.
3. **Mô hình Lip-sync cục bộ (Wav2Lip / SadTalker / MuseTalk):** Tích hợp bước hậu kỳ khẩu hình tự động cho các shot cận cảnh có thoại trước khi đưa vào bộ dựng.
4. **Kiểm tra Import trực tiếp trên DaVinci Resolve Studio:** Thử nghiệm kéo thả file `timeline.xml` và `timeline.otio` vào DaVinci Resolve và Premiere Pro trên máy trạm thực tế để xác nhận các track audio và video liên kết hoàn hảo.
5. **Cơ chế Garbage Collection cho Intermediate Takes:** Tự động dọn dẹp hoặc nén lưu trữ các take bị từ chối (`is_approved = 0`) sau khi tập phim đã được xuất bản master và cam kết vào Canon.



