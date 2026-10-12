# Hướng Dẫn Tối Ưu Hóa & Tiết Kiệm Token Khi Sinh Kịch Bản & Video AI (Token Optimization & Cost-Reduction Architecture)

Tài liệu này mô tả các cơ chế giảm prompt dư thừa trong **Auto-Create-Video**. Các tỷ lệ tiết kiệm trong ví dụ là giả định minh họa, chưa phải kết quả benchmark. Chi phí và độ trễ thực tế phụ thuộc nhà cung cấp, model, giá hiện hành, cache eligibility, cache hit, kích thước prompt và nội dung tập.

---

## 1. Bối Cảnh & Điểm Nghẽn Lãng Phí Token (The Token Bottleneck)

Trong quy trình sản xuất phim nhiều tập từ tiểu thuyết (Novel-to-Episodic-Series), việc gọi LLM thường gặp 4 nguồn làm tăng token và chi phí:

1. **Bất đối xứng giá thành (Asymmetric Pricing)**:
   - Giá input và output thay đổi theo nhà cung cấp/model; dùng rate card có ngày xác minh thay vì giả định một tỷ lệ cố định.
   - Prompt yêu cầu LLM viết văn xuôi dài dòng, lặp lại các chỉ dẫn camera/ánh sáng tiêu chuẩn gây phình to output tokens một cách vô ích.
2. **Context Dilution & N-Episode Context Bloat ($O(N)$ Growth)**:
   - Khi sản xuất đến Tập 15 hoặc Tập 30, nếu nhồi toàn bộ lịch sử 14 tập trước và toàn bộ hồ sơ nhân vật vào prompt:
     - Input token tăng theo cấp số cộng/nhân.
     - Hiện tượng "Needle-in-a-Haystack" khiến LLM bị loãng sự chú ý, dễ sinh ảo giác hoặc bỏ quên các tình tiết bắt buộc (mandatory beats).
3. **Lãng phí do Zero Prompt Caching**:
   - Phần chỉ dẫn chung có thể bị lặp giữa các tập nếu prompt không được chia thành prefix ổn định và phần nội dung thay đổi.
   - Cache chỉ giảm chi phí khi API/model chấp nhận cấu hình, prefix đủ điều kiện và usage xác nhận cache hit. Giá và yêu cầu cache thay đổi theo nhà cung cấp.
4. **Lãng phí do Full-Script Re-Roll**:
   - Khi lỗi chỉ nằm trong một cảnh, sửa cục bộ có thể tránh sinh lại toàn bộ kịch bản; token dùng thực tế cần đối chiếu API usage.

---

## 2. Kiến Trúc 6 Trụ Cột Tối Ưu Hóa Token (The 6 Pillars)

### Sáu nhóm tối ưu

- Cache-aware prompt structuring and provider usage telemetry.
- Semantic pruning and rolling context decay.
- Compact screenplay notation with supported round-trip parsing.
- Targeted scene repair when an audit identifies a repairable violation.
- Fast/economy and flagship model tiers.
- Persistent token usage and budget accounting with optional rate estimates.

---

### Trụ Cột 1: Cache-Aware Prompt Structuring (Two-Tier Layout)
- **Nguyên tắc**: Tách bạch tuyệt đối giữa hai vùng ngữ cảnh:
  1. **Khối Static Invariant Prefix**: Gồm chỉ dẫn đạo diễn, Hollywood 5-Shot Grammar, metadata ổn định của series và tối đa ba hồ sơ thị giác cố định.
     - Code ước lượng kích thước prefix bằng tỷ lệ ký tự/token; đây không phải bộ đếm token chính xác của nhà cung cấp.
     - Luồng hiện tại chỉ gắn `cache_control: { type: "ephemeral" }` cho Anthropic. Chưa triển khai prompt cache riêng cho OpenAI hoặc Gemini.
     - Ngưỡng ước lượng phụ thuộc model: hiện dùng mức nền 1.024 token và yêu cầu 4.096 token cho Claude Haiku 4.5. Đối chiếu lại [giới hạn cache Anthropic](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) khi đổi model.
     - Ràng buộc canon phụ thuộc trạng thái tập (bí mật, nhân vật hoặc đạo cụ) luôn nằm trong context động; chỉ giá trị bất biến được đưa vào prefix.
     - **Xác minh**: kiểm tra cache creation/read trong response usage. Tỷ lệ giảm chi phí và độ trễ chưa được benchmark trong repo.
  2. **Khối Dynamic Suffix**: Chứa mục tiêu tập, trạng thái canon, trích đoạn nguồn, tình tiết bắt buộc và tri thức nhân vật thay đổi theo tập.

### Trụ Cột 2: Semantic Pruning & Rolling Exponential Context Decay
- **Rolling Context Decay** (`PromptOptimizer.applyRollingContextDecay`):
  - **Tập $N-1$ (Liền kề)**: Tóm tắt chi tiết (logline, 3 biến cố chính, state out).
  - **Tập $N-2$ & $N-3$**: Tóm tắt trung bình (1 câu logline duy nhất).
  - **Tập $1 \to N-4$**: Gom thành 1 câu vĩ mô duy nhất (Macro Era Arc $\le 100$ từ).
  - **Hiệu quả dự kiến**: giảm phần tóm tắt lịch sử lặp lại; đo token trước/sau bằng response usage trên tập dữ liệu đại diện.
- **Scene-Level Semantic Filtering**:
  - Dùng `PromptOptimizer.filterActiveCharactersForScene` kết hợp `SemanticMemoryEngine` (128-D vector embeddings).
  - Loại bỏ hoàn toàn hồ sơ của các nhân vật không xuất hiện trong cảnh hiện tại.

### Trụ Cột 3: Compact Cinema Shorthand Notation
- **Nguyên tắc**: Thay vì để LLM sinh các câu mô tả dài dòng:
  ```text
  CÚ MÁY 1 (establishing, 4s): Mô tả hình ảnh chi tiết phục vụ AI Video Generator: góc máy toàn cảnh rộng, ống kính 35mm wide lens, ánh sáng chiaroscuro mờ sương, volumetric fog...
  ```
- **Cú pháp nén Compact Cinema Notation**:
  ```text
  C1.1 [EST|4s|35mm|chiaroscuro|fog]: Toàn cảnh rừng già mờ sương, bóng đen ẩn hiện. [BEAT: b01]
  NAM [thì thầm, lo lắng]: Chúng ta không còn nhiều thời gian.
  C1.2 [CU|4s|85mm]: Gương mặt Mai căng thẳng, giọt mồ hôi rơi trên má.
  ```
- **Hàm chuyển đổi**:
  - `PromptOptimizer.toCompactCinemaNotation(rawScript)`: Nén kịch bản thô thành cú pháp điện ảnh cô đọng.
  - `PromptOptimizer.expandCompactCinemaNotation(compactScript)`: bung notation được parser hỗ trợ; các kiểu screenplay ngoài grammar cần round-trip kiểm thử.
  - **Hiệu quả dự kiến**: giảm độ dài cú pháp; tỷ lệ token phụ thuộc nội dung và cần benchmark theo model.

### Trụ Cột 4: Surgical Scene Micro-Repair (Vá Cục Bộ)
- **Cơ chế hoạt động** (`MicroScriptRepairer`):
  1. Phân tách kịch bản thành các khối AST phân cảnh (`SceneBlock[]`) với offset ký tự chính xác.
  2. Khi `ContinuityAuditor` phát hiện vi phạm (ví dụ vi phạm đạo cụ ở Cảnh 2):
  3. Xây dựng prompt vi sửa chữa siêu ngắn ($\sim 300$ tokens) chỉ chứa Cảnh 2 và ngữ cảnh 1 dòng của Cảnh 1 và Cảnh 3.
  4. Bộ vi sửa chữa trả về phân cảnh đã sửa và ghép nối (`spliceRepairedScene`) trở lại kịch bản gốc.
  - `estimatedTokensSaved` và `savingsPercentage` dùng bộ ước lượng ký tự/token. Chúng chỉ là ước tính; chi phí thật cần API usage của cả lần sửa và baseline full re-run.

### Trụ Cột 5: Hierarchical Model Cascading
- Phân tầng mô hình phù hợp theo độ phức tạp công việc:
  - **Tier 0 (Regex / Heuristic)**: Phân đoạn thô, tách cảnh, tính toán token $\implies$ **\$0.00**.
- **Tier 1 (Fast / Economy)**: Trích xuất thực thể, tóm tắt chương và vi sửa chữa cục bộ; chọn model/rate card đang được xác minh.
- **Tier 2 (Flagship)**: Dành cho biên kịch chính; chọn model/rate card đang được xác minh.
- Model IDs được điều khiển qua Settings hoặc biến môi trường; kiểm tra [danh sách và lịch nghỉ model Anthropic](https://docs.anthropic.com/en/docs/about-claude/model-deprecations) và [model Gemini hiện hành](https://ai.google.dev/gemini-api/docs/models) trước khi phát hành cấu hình mới.

### Trụ Cột 6: Token Telemetry & Real-Time Cost Accounting
- `BudgetLedger.recordTokenUsage`: Lưu input/output, cache read và cache creation theo series. Không lưu nội dung prompt hoặc thông tin xác thực.
- `BudgetLedger.getTokenSavingsSummary`: Báo cáo cache hit ratio từ usage của provider. `totalEstimatedSavingsUsd` là `null` cho đến khi caller cung cấp ước tính theo rate card; hệ thống không áp giá cố định.

---

## 3. Ví Dụ Tính Toán Minh Họa (Chưa Phải Benchmark)

| Tiêu Chí Đánh Giá | Trước Khi Tối Ưu (Traditional) | Sau Khi Tối Ưu (Token Engine) | Mức Độ Cải Thiện |
| :--- | :--- | :--- | :--- |
| **Input tokens trong giả định** | 6,500 | 1,800 (gồm 1,200 cache read) | Token volume giảm khoảng 72%; chưa suy ra mức giảm chi phí |
| **Output tokens trong giả định** | 2,800 | 1,500 | Token volume giảm khoảng 46%; cần xác nhận bằng response usage |
| **Sửa kịch bản trong giả định** | 3,500 token full re-run | 400 token micro-repair | Ước tính giảm khoảng 89%; chưa phải benchmark |

Chi phí, cache write, cache read và TTFT không được ước lượng trong bảng này. Hãy chạy benchmark với cùng model/rate card và lưu usage metadata để báo cáo các chỉ số đó.

---

## 4. Hướng Dẫn Sử Dụng Trong Codebase

### 4.1. Kích Hoạt Trong `StoryToScreenplayGenerator`
```typescript
import { StoryToScreenplayGenerator } from "./src/modules/story/index.js";

const generator = new StoryToScreenplayGenerator(bible);

const result = await generator.generateEpisodeFromPlan({
  seriesId: "cyber_saigon",
  planId: "plan_season_1",
  episodeNumber: 5,
  useLlm: true,
  llmProvider: "anthropic",
  enablePromptOptimization: true,          // Bật prompt structuring và rolling context decay
  enableCompactCinemaNotation: true,       // Dùng định dạng kịch bản ngắn gọn
  enableMicroRepairOnAuditViolation: true, // Tự động vi sửa chữa cục bộ nếu vi phạm audit
});
```

### 4.2. Gọi Vi Sửa Chữa Độc Lập Với `MicroScriptRepairer`
```typescript
import { MicroScriptRepairer } from "./src/modules/story/index.js";

const result = await MicroScriptRepairer.executeSurgicalRepair(
  rawScript,
  {
    sceneNumber: 2,
    violationType: "canon_prop_state",
    violationMessage: "Nam không thể cầm kiếm vì Mai đang giữ ở Cảnh 1.",
    fixInstruction: "Mai chuyền kiếm cho Nam hoặc Nam dùng vũ khí khác.",
  },
  async (prompt, systemPrompt) => {
    return callFastLlm(prompt, systemPrompt); // Dùng Tier 1 (Haiku / Flash)
  }
);

console.log(`Đã tiết kiệm được: ${result.estimatedTokensSaved} tokens (${result.savingsPercentage}%)`);
```

### 4.3. Truy Vấn Thống Kê Tiết Kiệm Từ `BudgetLedger`
```typescript
import { BudgetLedger } from "./src/modules/production/index.js";

const ledger = new BudgetLedger(bible);
const savings = ledger.getTokenSavingsSummary("cyber_saigon");

console.log(`Tỷ lệ Cache Hit: ${(savings.cacheHitRatio * 100).toFixed(1)}%`);
console.log(
  savings.totalEstimatedSavingsUsd === null
    ? "Chưa có rate card/ước tính chi phí để tính tiền tiết kiệm."
    : `Tổng tiết kiệm ước tính: $${savings.totalEstimatedSavingsUsd.toFixed(4)} USD`
);
```
