# Benchmark tối ưu offline — 08/10/2026

Đo năm lượt cho mỗi cấu hình trên cùng máy, không chạy build hoặc test nặng đồng thời. Script: `scripts/benchmark-optimization.ts`, fixture version 2. Báo cáo gốc và từng mẫu nằm ở `output/optimization-benchmark/report.json`; thư mục này bị gitignore. Các số liệu dưới đây đã được tổng hợp từ báo cáo gốc. Bản lưu để review: [205 mẫu JSON](benchmarks/optimization-offline-2026-10-08.json), đã bỏ hostname và đổi root thành đường dẫn tương đối.

## Phạm vi

- Video dọc 45 giây ở 72×128; pilot ngang 150 giây ở 128×72; season gồm ba tập 45 giây ở 128×72. FPS nguồn là 30; biến thể render-options dùng 24 FPS. Đây là fixture kiểm chứng logic/cache và độ dài, không đại diện 1080p/4K.
- Cold nghĩa là chưa có cache ứng dụng tại output của lượt đo; không xóa cache filesystem của hệ điều hành. Warm/resume kiểm tra lại manifest, hash và probe thay vì chỉ kiểm tra file tồn tại.
- Sửa shot thay clip và take của một scene trong mỗi tập; dataset season vì vậy sửa ba scene, một scene/tập. Sửa lời thoại tại assembler thay subtitle, chưa burn vào video; render-options đổi FPS ở từng tập. Regression pipeline riêng chứng minh sửa lời thoại không tạo video generation mới; benchmark này không đo TTS thật.
- Hai lượt encode và filter fusion dùng cùng clip, kích thước đích, encoder, preset ultrafast và CRF 18. Stream copy so với concat encode được đo ở toàn luồng ghép, gồm kiểm định, audio fixture và I/O.
- Cold/warm/resume và các phép sửa của season ghép đủ ba tập. Phép filter của dataset season so sánh một clip nguồn 45 giây, không phải ba tập nối thành 135 giây.
- Context dùng 1.000/10.000 entity và beat, kèm mandatory canon, source citation và bí mật chỉ xuất hiện ở tập 99. Full-index dùng scope mới; cached-index đọc đúng scope vừa persist. Pruning phải giữ canon/citation và loại future knowledge.
- Prompt cache và micro-repair dùng payload/LLM giả. Không có network latency, chất lượng câu trả lời, cache billing hoặc usage provider thật trong phép đo này. Không công bố tiết kiệm tiền hay token được tính phí.
- RSS chỉ là bộ nhớ tiến trình Node, không cộng process FFmpeg. Lấy mẫu mỗi 25 ms cùng giá trị đầu/cuối; công việc đồng bộ không lấy được mẫu giữa lúc chặn event loop. Mỗi cấu hình chạy trong cùng process có cache/GC của runtime; số RSS không đủ để kết luận riêng một tối ưu làm giảm RAM. Media async có histogram event-loop độ phân giải 10 ms; phép context/repair đồng bộ ghi thời gian chặn và để lag p95 unavailable.

## Môi trường và bằng chứng

Windows; Node v24.13.1; CPU 12th Gen Intel(R) Core(TM) i5-12450H.

FFmpeg: ffmpeg version 6.1.1-essentials_build-www.gyan.dev Copyright (c) 2000-2023 the FFmpeg developers. FFprobe: ffprobe version 4.0.2 Copyright (c) 2007-2018 the FFmpeg developers. Các phiên bản trên là runtime thực tế đã dùng, không giả định chúng cùng version.

Nguồn: HEAD `dee282acf589e6e3eb358eddde609b09a466b749` và working tree đã triển khai; benchmark bắt đầu 23:57:41 ngày 07/10 và hoàn tất 00:15:45 ngày 08/10/2026, giờ Bangkok. 205 mẫu, 41 cấu hình, mỗi cấu hình năm mẫu.

Báo cáo chi tiết: `output/optimization-benchmark/2026-10-07T16-57-41-770Z/report.json`. Bản trỏ kết quả cuối: `output/optimization-benchmark/report.json`.

## Ghép media

Thời gian tính bằng giây; RSS là lớn nhất quan sát được của Node trong năm lượt. Mọi hàng có n = 5.

| Dataset | Cấu hình | Median s | Min–max s | RSS MiB |
|---|---|---:|---:|---:|
| Dọc 45 s | Cold, stream copy khi phù hợp | 7,151 | 6,617–7,822 | 172,9 |
| Dọc 45 s | Baseline concat encode | 7,617 | 7,223–7,776 | 174,7 |
| Dọc 45 s | Warm | 2,384 | 2,288–2,549 | 118,5 |
| Dọc 45 s | Resume | 2,367 | 2,062–2,511 | 117,9 |
| Dọc 45 s | Sửa shot | 3,065 | 2,997–4,357 | 119,0 |
| Dọc 45 s | Sửa subtitle/thoại | 2,471 | 2,348–2,520 | 126,3 |
| Dọc 45 s | Đổi FPS | 3,922 | 3,526–4,928 | 127,0 |
| Ngang 150 s | Cold, stream copy khi phù hợp | 20,779 | 20,303–22,145 | 132,7 |
| Ngang 150 s | Baseline concat encode | 23,057 | 22,379–23,724 | 126,2 |
| Ngang 150 s | Warm | 3,001 | 2,770–3,226 | 135,4 |
| Ngang 150 s | Resume | 3,029 | 2,954–3,132 | 135,3 |
| Ngang 150 s | Sửa shot | 4,770 | 4,610–9,624 | 135,6 |
| Ngang 150 s | Sửa subtitle/thoại | 2,981 | 2,645–3,152 | 141,0 |
| Ngang 150 s | Đổi FPS | 6,197 | 5,579–6,368 | 135,3 |
| Season 3 × 45 s | Cold, stream copy khi phù hợp | 22,158 | 21,593–22,860 | 135,4 |
| Season 3 × 45 s | Baseline concat encode | 24,088 | 23,627–24,787 | 129,0 |
| Season 3 × 45 s | Warm | 7,323 | 6,980–7,886 | 135,6 |
| Season 3 × 45 s | Resume | 7,543 | 7,390–9,323 | 135,3 |
| Season 3 × 45 s | Sửa shot | 10,119 | 9,433–10,756 | 137,3 |
| Season 3 × 45 s | Sửa subtitle/thoại | 7,381 | 6,899–7,497 | 158,5 |
| Season 3 × 45 s | Đổi FPS | 11,849 | 11,322–12,008 | 135,4 |

## Filter fusion và concat

| Fixture | Hai encode: median [min–max] s | Gộp: median [min–max] s | Giảm median | SSIM giữa outputs |
|---|---:|---:|---:|---:|
| Dọc 45 s | 0,907 [0,762–0,925] | 0,494 [0,425–0,533] | 45,5% | 0,991742–0,991742 |
| Ngang 150 s | 1,832 [1,706–1,890] | 1,010 [0,984–1,108] | 44,9% | 0,987069–0,987069 |
| Clip 45 s của fixture season | 0,846 [0,833–0,857] | 0,441 [0,409–0,496] | 47,9% | 0,987673–0,987673 |

Filter fusion giảm số encode từ 2 xuống 1 và đạt mục tiêu 20% trên các fixture tương thích này. SSIM là so sánh hai output nén mất dữ liệu; không chứng nhận chất lượng provider hay delivery 1080p/4K. Tất cả output được probe hợp lệ, duration/filter kiểm tra sai lệch tối đa một frame.

| Dataset | Giảm median toàn luồng khi concat copy thay concat encode |
|---|---:|
| Dọc 45 s | 6,1% |
| Ngang 150 s | 9,9% |
| Season 3 × 45 s | 8,0% |

Stream copy giảm một encode/tập nhưng chưa đạt 20% thời gian toàn luồng trên các fixture này. Audio, kiểm định và I/O vẫn nằm trong thời gian đo; không công bố mức giảm của filter như mức giảm chung mọi render.

## Cache và dependency

| Dataset / thay đổi | Encode | Stream copy/mux | Cache hit | Probe | Hash |
|---|---:|---:|---:|---:|---:|
| Dọc 45 s / Resume | 0 | 0 | 3 | 20 | 22 |
| Dọc 45 s / Sửa shot | 1 | 2 | 1 | 23 | 20 |
| Dọc 45 s / Sửa subtitle/thoại | 0 | 0 | 3 | 20 | 22 |
| Dọc 45 s / Đổi FPS | 2 | 2 | 1 | 24 | 20 |
| Ngang 150 s / Resume | 0 | 0 | 3 | 20 | 22 |
| Ngang 150 s / Sửa shot | 1 | 2 | 1 | 23 | 20 |
| Ngang 150 s / Sửa subtitle/thoại | 0 | 0 | 3 | 20 | 22 |
| Ngang 150 s / Đổi FPS | 2 | 2 | 1 | 24 | 20 |
| Season 3 × 45 s / Resume | 0 | 0 | 9 | 60 | 66 |
| Season 3 × 45 s / Sửa shot | 3 | 6 | 3 | 69 | 60 |
| Season 3 × 45 s / Sửa subtitle/thoại | 0 | 0 | 9 | 60 | 66 |
| Season 3 × 45 s / Đổi FPS | 6 | 6 | 3 | 72 | 60 |

Cả 15 lượt resume có 0 encode và 0 stream copy/mux mới. Median lag p95 của các lượt resume: dọc 26,92 ms, ngang 24,87 ms, season 29,57 ms.

Encode counter đếm process xuất media không dùng stream copy, gồm audio/video; streamCopy cũng gồm video-copy/audio-encode mux. Hai counter này không chỉ đếm video generation. Provider submit không thuộc benchmark assembler: regression `media-cache-regression.test.ts` riêng chứng minh resume 0 submit/encode và sửa thoại 0 video generation. Probe/hash vẫn phải chạy khi reuse; vì vậy resume không có nghĩa 0 I/O.

## Semantic/context

| Dataset | Cấu hình | Median ms | Min–max ms | RSS MiB |
|---|---|---:|---:|---:|
| 1.000 entity/beat | Full index + query | 202,185 | 166,907–330,377 | 159,0 |
| 1.000 entity/beat | Index persist + query | 25,217 | 22,776–38,033 | 166,6 |
| 1.000 entity/beat | Payload không pruning | 0,143 | 0,097–0,298 | 169,2 |
| 1.000 entity/beat | Pruning + coverage | 2,881 | 1,711–5,240 | 158,5 |
| 1.000 entity/beat | Prompt cache tắt, fixture | 0,113 | 0,080–0,209 | 158,5 |
| 1.000 entity/beat | Dựng prompt cache, fixture | 1,646 | 1,511–2,406 | 158,5 |
| 10.000 entity/beat | Full index + query | 2335,857 | 2276,186–2384,613 | 445,1 |
| 10.000 entity/beat | Index persist + query | 324,013 | 280,444–360,120 | 445,1 |
| 10.000 entity/beat | Payload không pruning | 0,105 | 0,098–0,179 | 372,1 |
| 10.000 entity/beat | Pruning + coverage | 20,810 | 18,040–29,369 | 372,1 |
| 10.000 entity/beat | Prompt cache tắt, fixture | 0,079 | 0,072–0,148 | 372,1 |
| 10.000 entity/beat | Dựng prompt cache, fixture | 15,773 | 12,702–22,456 | 373,4 |

Persisted index giảm median full-index/query 87,5% ở 1.000 entity/beat và 86,1% ở 10.000. Không kết luận giảm RAM: cache lớn vẫn phải deserialize và query, trong cùng process có trạng thái/GC tích lũy. 10.000 entity vẫn có khoảng 324 ms công việc đồng bộ; lag histogram để unavailable, không báo 0.

| Context | Số nhân vật trước → sau | Token ước tính trước → sau | Coverage |
|---|---:|---:|---|
| 1.000 entity/beat | 999 → 24 | 20906 → 1046 | Mandatory canon/source citation giữ; future knowledge loại, 5/5 lượt |
| 10.000 entity/beat | 9999 → 24 | 215905 → 1067 | Mandatory canon/source citation giữ; future knowledge loại, 5/5 lượt |

Một entity trong mỗi dataset là mandatory story beat, phần còn lại là nhân vật. Ước lượng dùng heuristic ký tự/3, không phải tokenizer hay usage API. Context không pruning đếm mô tả nhân vật; context pruning còn giữ rule/beat bắt buộc. Chỉ dùng các số này để đánh giá kích thước fixture, không quy đổi thành savings tính phí.

Prompt cache: prefix fixture chỉ 232 token ước tính nên chưa đủ ngưỡng heuristic 1.024; cả cấu hình bật và tắt đều không gửi cache marker. Đây là kiểm chứng eligibility của prefix nhỏ, không chứng minh provider cache hit. Regression prompt/usage riêng kiểm tra prefix đủ lớn và evidence usage. Actual input/output/cache-read/cache-write trong benchmark đều unavailable.

## Micro-repair

| Thao tác fixture, invoker giả | Median ms | Min–max ms | Input ký tự | Output ký tự |
|---|---:|---:|---:|---:|
| Ghi payload toàn script giả | 0,103 | 0,076–0,334 | 12210 | 12210 |
| Micro-repair, invoker giả | 0,441 | 0,294–2,776 | 2757 | 609 |

Full-repair fixture chỉ ghi payload toàn script; micro-repair chạy parser/thay scene với invoker giả. Thời gian trên không so sánh độ trễ hai request LLM thật. Input micro-repair gồm prompt/system, output chỉ scene được thay. Có thể xác nhận payload nhỏ hơn trong fixture; không xác nhận chất lượng repair hay token/tiền tiết kiệm.

## Cổng nghiệm thu và phần chưa xác minh

- PASS offline: đủ năm mẫu/cấu hình, resume không render lại, cache invalidate theo shot/FPS, media hợp lệ/frame drift trong giới hạn, mandatory canon/source/episode scope giữ đúng.
- Mục tiêu 20%: đạt cho filter fusion ở fixture tương thích; chưa đạt cho thời gian toàn luồng stream-copy concat. Không chứng minh tốc độ hoặc QA tại độ phân giải production.
- Provider/RPM/429/retry/ledger và các crash không thuộc phép đo media/context này; được kiểm tra bằng DB/HTTP/interprocess regression riêng trong báo cáo bàn giao.
- Actual token usage, cache billing, TTS/video invoice, chất lượng/capability provider thật: unavailable/chưa xác minh. Dollar savings giữ null.
- Docker/ma trận CI phải chạy ở môi trường tương ứng; kết quả local không thay thế các cổng này.

Xem [bàn giao triển khai](OPTIMIZATION_HANDOVER.md) và [vận hành/migration/đối soát](OPTIMIZATION_OPERATIONS.md).
