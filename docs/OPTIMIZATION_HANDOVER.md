# Bàn giao triển khai tối ưu Auto-Create-Video A–E

Ngày triển khai: 07–08/10/2026. Nguồn đối chiếu: HEAD `dee282acf589e6e3eb358eddde609b09a466b749` cùng working tree đã có thay đổi trước khi triển khai. Không reset, stash hoặc ghi đè toàn bộ working tree. Chưa tạo commit/PR; các phần triển khai dưới đây là ranh giới review đề xuất, không phải PR đã mở.

## Phần đã triển khai

| Phần review | Thay đổi cụ thể | Mã chính |
|---|---|---|
| PR 1 / A | Contract metadata, fixture timeline/subtitle, 9:16 mặc định, noEmitOnError và build staging | story-to-screenplay, timeline fixture, build.mjs |
| PR 2 / B | ExecutionPolicy, demo mock, durable dispatch guard, reservation/cap, nguồn chi phí và zero-dollar | execution-policy, video-gateway, budget-ledger |
| PR 3 / B | Reference/embedding provenance riêng, hash/probe/import, ownership và ranh giới HTTP | artifact-store, project-paths, concept-art, turnaround |
| PR 4 / C | Queue hậu kỳ 202, dedup, hai worker, dependency canon, lease/version fencing, process runner | job-store, media-job-service, production-worker, media-process-runner |
| PR 5 / C | Dispatch dùng chung, remote slot, RPM từng HTTP/poll/retry, submitting, webhook inbox, crash repair | provider-dispatcher, provider-dispatch-store, webhook-ingress, provider-reconciler |
| PR 6 / C | Paid hedge opt-in, group/reservation/QA winner riêng, losing attempt, manual audit | durable-hedge, manual-reconciliation |
| PR 7 / D | Fingerprint toàn cấu hình/nội dung LUT, manifest/hash/probe, dependencies, concat copy/filter fusion | artifact-cache, hierarchical-assembler, episode-production-use-case, cinematic-post-pipeline |
| PR 8 / D | Canonical revision, semantic index persistent, scope/tie ổn định, usage evidence và payload benchmark | semantic-memory, context-builder, story-analyzer, micro-script-repairer |
| PR 9 / E | React route chính, scope generation/AbortController, selection/SSE/version checks và các workspace | studio/main.tsx, scoped-requests, studio/components |
| PR 10 / E | Bible facade/repositories, Pipeline facade/use cases, contract frontend thuần và error mapping | bible repositories, episode use cases, contracts, application-error |
| PR 11 / E | Nhóm test, CI OS/Node, build sạch, runtime/browser/container smoke, Docker runtime | vitest.config, workflows/test.yml, Dockerfile, scripts |

Các thay đổi dùng chung một số tệp facade/schema/route. Khi tách PR cần phân chia file/hunk thành commit theo domain và dependency; không commit toàn bộ thay đổi có trước của người dùng như thể đều do vòng triển khai này tạo. Giữ migration theo thứ tự và luôn build/test mỗi phần.

React có workspace cho draft/generation, settings, tạo series/nhân vật/bối cảnh và reference/import, production/season, queue, take/player/audio, timeline/NLE, canon/branches, semantic, hậu kỳ, usage/reconciliation và backup. Browser smoke thực hiện các luồng tạo series, tạo nhân vật, reference mock, lưu draft, production mock và đổi nhanh series/tập; round-trip/backup/branches và reconciliation có DB/HTTP regressions riêng. Việc có 17 workspace không thay thế kiểm thử nghiệp vụ của từng API.

## Regression cho 9 finding

| Finding | Bằng chứng regression |
|---|---|
| F01 | Typecheck/build, build-publication.test, season-orchestrator, novel-to-series-acceptance, timeline fixtures |
| F02 | production-boundaries, vertical-pipeline-optimization, budget-and-rate, durable-dispatch: zero cap/missing reservation |
| F03 | video-gateway guards, durable-dispatch: primary/QA fail/budget/restart/cancel/unavailable, interprocess coordination |
| F04 | vertical-slice-turnaround, production-boundaries: ảnh thật + synthetic embedding, concept-art provenance |
| F05 | production-boundaries: outside/../cross-series/junction/ancestor; studio-v1, project-backup |
| F06 | interprocess-coordination: shared cap/slot/RPM/same attempt/POST crash; durable-webhook: inbox và chữ ký |
| F07 | hierarchical-assembler/cache regressions, media-cache-regression: resume 0 submit/encode và dialogue 0 generation |
| F08 | job-store, production-boundaries: stale ownership/postprocess manifest/dedup; media-process-runner; compiled restart smoke |
| F09 | studio/scoped-requests.test: A chậm/B nhanh, late catch, abort; browser scope/episode smoke; draft version conflicts |

Bổ sung recovery cho khoảng hở remote terminal đã ghi nhưng ledger/media chưa cập nhật; reconciler xử lý tiếp mà không parent retry/POST mới hoặc giữ live slot. 23 regression dispatch/interprocess mới nhất PASS (`terminal-gap-regressions.json`). Bổ sung kiểm tra publication bằng hai process độc lập, snapshot v2 đủ năm root, semantic future state, usage missing = unavailable, emergency hedge switch không reservation/submit. Lỗi season độc lập sau F01 được sửa: `skipRender` không được bỏ ghép các pass của take. Canon vẫn không được commit bằng mock exemption. Context giữ entity legacy chưa gắn series, loại entity đã gắn rõ với series khác.

## Kết quả kiểm chứng

Môi trường local: Windows, Node v24.13.1; adapter paid giả, server HTTP localhost và fixture FFmpeg. Không gọi provider trả phí.

| Kiểm tra | Kết quả |
|---|---|
| Typecheck backend + Studio | PASS, `output/code-review-2026-10-06/acceptance-typecheck.log` |
| Build staging backend + React | PASS, `acceptance-build.log`; React JS 380,46 kB / gzip 110,16 kB |
| Compiled CLI help | PASS, `acceptance-cli.log` |
| Season/novel/context/reference/path regression sau sửa | 47 PASS, 0 FAIL, `season-final-regressions.json` |
| Full suite cuối cùng | 769 PASS, 0 FAIL, 0 bỏ qua; 113 file; `acceptance-frozen-tests.json` |
| Runtime compiled sạch: hai worker, pause/restart/resume/dedup/read artifact | PASS, `acceptance-runtime.log` |
| Browser offline bản build cuối | PASS: 17 workspace, series/tập race, tạo series/nhân vật/reference, lưu draft và mock production; `acceptance-browser.log` |
| Docker smoke local | Chưa kiểm chứng: Docker CLI có, daemon không hoạt động; `docker desktop start --detach` thất bại vì thiếu registry cài đặt Docker Desktop (`docker-start.log`) |
| Ma trận Ubuntu/Windows × Node 22/24 | Đã cấu hình; chưa chạy CI bên ngoài phiên local này |
| Provider thật, invoice, capability, chất lượng face/video, token billing | Chưa xác minh; ngoài vòng offline |

Các báo cáo ở `output/` là bằng chứng local bị gitignore. Những lượt test thất bại trước đó được giữ để truy vết, không dùng làm kết quả nghiệm thu cuối. Kết quả Docker/CI chưa chạy không được tính là PASS.

## Benchmark và giới hạn công bố

Script `scripts/benchmark-optimization.ts` dùng fixture version 2, năm lượt trên cùng máy. Dataset: video dọc 45 giây, ngang 150 giây, season ba tập 45 giây; context 1.000/10.000 entity; script 20 scene. Các trường hợp cold/warm/resume/shot edit/dialogue edit/render option, concat encode baseline, filter fusion, semantic cache/pruning, prompt cache và micro-repair có số đo riêng.

RSS đo tiến trình Node, không cộng bộ nhớ process FFmpeg; event-loop histogram có độ phân giải 10 ms cho media async. Context/micro-repair đồng bộ ghi thời gian chặn Node riêng và để histogram p95 unavailable, tránh báo lag 0 khi timer chưa được lấy mẫu. Media fixture dùng 72×128/128×72 để nghiệm thu offline nhanh. Chúng giữ duration/FPS, kiểm tra drift tối đa một frame và SSIM giữa filter outputs; không đại diện tốc độ hay chất lượng 1080p/4K. Dialogue-edit benchmark ở assembler đo dependency subtitle; regression pipeline riêng xác nhận sửa thoại không tạo video attempt mới. Stream copy/filter fusion chỉ áp dụng khi stream/filter tương thích.

Payload/token estimate được ghi riêng với actual usage. Offline không chứng minh token tiết kiệm được tính tiền, prompt cache hit trên provider hay TTS invoice. Dollar savings để null khi thiếu usage thật. Model/provider hiện có được giữ. Local semantic vectorizer là backend truy xuất offline, không phải bằng chứng embedding sinh trắc học.

Benchmark hoàn tất 205 mẫu / 41 cấu hình / năm lượt. Cả 15 lượt resume có 0 encode/stream-copy mới. Filter fusion giảm median 44,9–47,9%; concat copy giảm toàn luồng 6,1–9,9%, chưa đạt 20% trên các fixture này. Context 10.000 entity/beat giảm median index/query từ 2336 xuống 324 ms, giữ coverage. Prefix prompt cache nhỏ chưa đủ eligibility; actual token/cost savings vẫn unavailable. Xem [bảng median/min/max và giới hạn](OPTIMIZATION_BENCHMARK_2026-10-08.md); không thay kết quả đo bằng phần trăm mục tiêu.

## Hướng dẫn sử dụng kết quả

Đọc [vận hành/migration/rollback/reconciliation](OPTIMIZATION_OPERATIONS.md) trước rollout. Giữ hedge tắt mặc định; xác minh capability/QA/backend trước production thật. Không xóa hoặc hoàn reservation của remote attempt chỉ vì worker mất lease, parent cancel hoặc có winner. Những phần chưa được xác minh cần hoàn thành tại môi trường Docker/CI/provider tương ứng trước khi coi dự án đạt toàn bộ cổng phát hành của kế hoạch.
