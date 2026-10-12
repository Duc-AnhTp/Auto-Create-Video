# Khắc phục finding sau refactor — 08/10/2026

Đã xử lý 10 finding trong báo cáo đính kèm, giữ vị trí dữ liệu và schema SQLite. Các kiểm tra dưới đây bổ sung cho lần nghiệm thu trong [báo cáo refactor](SOLID_REFACTOR_2026-10-08.md); kết quả 824 tests ở báo cáo đó thuộc lượt chạy trước các sửa lỗi này.

## Thay đổi và bằng chứng

| Finding | Thay đổi | Kiểm chứng hành vi |
|---|---|---|
| 1. Re-render thiếu template | `rerender.ts` lấy CSS/JS ở thư mục media mới; tách hàm gọi được từ test và giữ cách chạy CLI | Fixture dùng voice đã có, copy đúng nội dung template và đi đến render; audio và Hyperframes được giả lập, không gọi TTS |
| 2. Resume mất duration trong checkpoint | Khôi phục `durationSec` cho cả script và `job.shots` | Test pha audio giữ thời lượng lập kế hoạch visual cũ, không sinh lại audio; test pipeline có thoại dài kiểm tra checkpoint sau resume |
| 3. Re-roll làm lại cả tập | Studio gửi `targetShotId`/`promptOverride`; schema và queue giữ hai trường; worker gọi use case re-roll một shot | Chỉ thêm một take cho shot đích, giữ shot khác/audio/script/timeline/Master; take mới chưa được duyệt, artifact có loại `shot` |
| 4. NLE export đọc sai thư mục | Đọc `output/series/:id/ep-XX/`; hỗ trợ timeline ở root, assembly và artifacts; conform dùng cùng resolver | HTTP export tạo XML/EDL/OTIO từ timeline output thật và conform preview đọc cùng tập |
| 5. Lighting đọc sai thư mục | Dùng cùng resolver output và schema timeline | Hai alias HTTP sử dụng shot ID thật của fixture thay vì coverage giả |
| 6. Doctor rò connection | Doctor dùng connection do composition root CLI cấp; không mở connection thứ hai | CLI mở một lần, dispose một lần khi thành công hoặc lỗi đọc DB |
| 7. Client mất mã lỗi legacy | `ApiError` nhận cả `{error: string, code}` và `{error: {message, code}}` | Test constructor và fetch giữ nguyên status, code và message; fallback khi không có code |
| 8. File URL lỗi trên Windows | Dùng `fileURLToPath` | Đọc cùng ảnh qua path và URL có khoảng trắng, Unicode, `#`, `%`; file thiếu báo lỗi; URL HTTP/data URI giữ nguyên |
| 9. Worker standalone thoát ngay | Chỉ kiểm tra parent khi PID là số nguyên dương | Worker không có parent xử lý job; parent đã mất thì không claim; bản compiled được kiểm tra độc lập |
| 10. Return trùng | Xóa 36 return thừa ở routes và 18 ở legacy | Quét AST toàn cây routes xác nhận không còn cặp return trùng; tổng 54 file |

## Re-roll và recovery

Request vẫn dùng `kind: "episode"`, với hai trường optional mới. Target chỉ được phép ở job episode; prompt override cần có target. Guard production vẫn yêu cầu provider thật và budget rõ ràng. Shot ID không được chứa thành phần đường dẫn.

Worker tạo candidate take, trả `result.reroll` và trạng thái `needs_review`. Không tự phê duyệt, remux hay commit canon từ candidate này. Studio loại candidate shot khỏi lựa chọn Preview Master, và tải lại takes khi nhận kết quả qua subscription. Luồng duyệt take hiện có tiếp tục là nơi cập nhật take chính thức.

Port `RerollReservationStore` được nối với filesystem adapter ở bootstrap. Journal riêng trong `ep-XX/rerolls/<jobId>.json` giữ ánh xạ queued job sang take đã reserve, giúp lần chạy lại dùng cùng take/spec và đường durable dispatch. Đây là artifact recovery mới; không đổi bảng SQLite hoặc cấu trúc checkpoint hiện có. Journal ghi atomically dưới ownership guard. Candidate hoàn tất có checksum; file bị đổi dẫn đến `needs_review`, không tự submit lại.

Cache dispatch được scope theo take đã reserve: yêu cầu re-roll mới có cùng prompt vẫn submit một take mới; retry cùng job dùng lại take trước. Test đã bắt được trường hợp hai yêu cầu mới chỉ submit một lần trước khi bổ sung scope này. Scope chỉ tham gia fingerprint nội bộ, không thay payload, seed hoặc thuật toán provider.

Test recovery mô phỏng mất lease sau khi provider hoàn tất nhưng trước checkpoint: lần chạy tiếp theo chỉ có một lần submit và một take mới. Test cũng kiểm tra retry sau hoàn tất và candidate bị hỏng. Các provider đều được kiểm tra bằng mock/fixture, không phát sinh gọi provider trả phí.

## Nghiệm thu

| Kiểm tra | Kết quả |
|---|---|
| Typecheck backend và Studio | Qua |
| Build backend, Studio và asset copy | Qua |
| Architecture | 463 files, 1.033 runtime edges, 0 violations |
| Test hồi quy mới | 23 tests ở 8 files qua; recovery/resume chạy riêng 12/12 qua |
| Full suite trước guard cache riêng cho take | 846/846 tests, 131 files; 0 failed/skipped |
| Dispatch/budget/recovery/approval sau guard cache | 50/50 tests, 6 files |
| Full suite source cuối | 847/847 tests, 131 files; 0 failed/skipped |
| Runtime smoke | Qua: compiled worker, pause/restart/resume, deduplication và đọc artifact |
| Compiled standalone worker | Qua: không truyền parent PID, vẫn claim và xử lý job fixture |
| Browser smoke | Qua: 17 màn hình, scope/episode switch, UI production và re-roll; nhận trạng thái chờ duyệt, tải lại takes của shot được chọn và giữ Preview Master |

Đối chiếu hash 619 file source/config trong lượt nghiệm thu cuối không có thay đổi.

Evidence chính: `output/solid-refactor-2026-10-08/followup-final-full.json`, `followup-dispatch-final.json`, `followup-final-source-manifest.json`; browser `output/browser-smoke-2fdd529b-b4ed-4621-915b-5bd1c5df582e/browser-result.json` và `studio.png`; runtime `output/clean-runtime-smoke-531e3c65-daa5-44f2-b8f1-006f4dfe22db/smoke-result.json`. Bản compiled standalone được xác nhận trong `output/clean-runtime-smoke-9cc83b7c-7fd5-450d-ad6e-e3354c568e41/standalone-result.json`. Output test không được đưa vào source.

Kết quả local xác nhận Windows/Node 24. Không gọi provider trả phí; chưa có kết quả CI Linux/container cho thay đổi này. Không tạo commit/PR hoặc reset các thay đổi có sẵn trong working tree.
