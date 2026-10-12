# Bàn giao khắc phục audit F01–F17

Ngày: 12/10/2026. Triển khai trên working tree hiện có, giữ đợt tái cấu trúc và các thư mục cũ đã xóa. Không gọi API trả phí trong kiểm thử hoặc smoke. Không tự xóa các thế hệ tài sản cũ.

## Quyết định vận hành

- Studio chỉ bind `127.0.0.1` hoặc `::1`; `localhost` được chuẩn hóa thành loopback. Cấu hình mở mạng ngoài bị từ chối trước khi tạo server. Kiểm tra IP của socket, Host và Origin cùng được giữ.
- Khi thiếu bằng chứng khôi phục, giữ audio, timeline, remote ID và attempt; trả `needs_review`. Retry thông thường không cho phép submit TTS trả phí lần nữa khi kết quả lần trước chưa rõ.
- Ledger và trần ngân sách chỉ dành cho `video_attempts_only`. Chi phí TTS không biết không được trình bày thành hóa đơn $0. Hóa đơn provider, estimate, đối soát thủ công và mock được phân biệt bằng `cost_source`.

## Ma trận triển khai và bằng chứng

Các đường dẫn trong bảng tương đối với repository. Bộ kiểm thử `audit-remediation.test.ts` và `audit-recovery.test.ts` nằm tại `src/modules/production/adapters/qa/`.

| Mã | Thay đổi chính | Bằng chứng hồi quy |
| --- | --- | --- |
| F01 | `contracts/asset-id.ts`, `platform/filesystem/containment.ts`; kiểm tra ID trước TTS và containment theo ancestor thực | ID traversal, Windows reserved/drive/URI, ID dài; gọi assembler trực tiếp không ghi ngoài root; junction audio/artifacts và ancestor symlink treo bị chặn |
| F02 | `apps/http/http-safety.ts`, `bootstrap/studio-server.ts` | Host mở mạng bị từ chối; IP LAN giả Host; loopback IPv4/IPv6 và IPv4-mapped IPv6 |
| F03 | `modules/media/adapters/tts/safe-tts-download.ts`, `platform/filesystem/url-security.ts` | SSRF/redirect nội bộ, số byte thực vượt giới hạn, giữ destination, xóa staging; hủy/deadline trong lúc probe được truyền tới ffprobe; bộ URL/DNS/agent hiện có |
| F04 | `modules/media/adapters/media-validator.ts`, `assets/mock-media-generator.ts` | Media giả bị từ chối; bỏ fallback fabricated metadata; mock pipeline dùng FFmpeg thật |
| F05 | SSE, worker heartbeat, provider heartbeat và resource lock | Callback DB lỗi không thoát timer; lỗi snapshot/socket dọn stream, timer và listener; đóng store dọn resource timer; các hồi quy lease/process lifecycle |
| F06 | Migration queue v3, `SeriesOperationCoordinator`, restore journal | Hai connection và process độc lập; hơn 200 job; khóa vẫn giữ khi owner sống; phục hồi sau kill; rollback rename chưa cập nhật journal; attempt TTS chưa hoàn tất chặn bảo trì, bảo trì chặn chuẩn bị TTS trong cùng transaction |
| F07 | `DurableTtsClient`, `TtsAttemptStore`; mỗi paid POST chỉ một lần | Timeout không rõ không resubmit; remote ID lưu trước poll; lỗi publish phục hồi từ bytes local; reopen không tăng POST |
| F08 | `ProduceAudio`, `FileAudioGenerationStore`, checkpoint v2 | Timeline thiếu không gọi TTS; audio/timeline cùng manifest; kill child sau staging không thay checkpoint và không tự chọn generation đó; resume thời lượng overflow |
| F09 | `rerender.ts`, `tsconfig.tooling.json`, package typecheck | Import rerender; kiểm tra duration renderer; application/Studio/tooling cùng typecheck |
| F10 | `contracts/invoice.ts`, adapter provider và `BudgetLedger` | `undefined`, `null`, boolean, chuỗi rỗng, NaN, Infinity, âm bị từ chối; số 0 hợp lệ; failure chưa rõ giữ ngân sách uncertain |
| F11 | Invoice inbox queue, receipt Bible trong transaction, reconciliation phân trang | Invoice sau terminal; replay không cộng lại; kill giữa Bible commit và inbox ack; invoice giảm về 0; invoice xung đột giữ uncertain và vẫn tính vào ngân sách |
| F12 | `ResolvedVoicePlan`, fingerprint v2 và chuẩn hóa text ở bootstrap | Đổi voice Bible làm đổi hash; cùng plan dùng cho synthesis; reference hash bất đồng bộ; không đọc môi trường trong fingerprint |
| F13 | `nle-conformer.ts`, parser XML đọc thẻ lồng | Subtitle theo đúng dialogue, giữ offset; round-trip không chỉnh sửa; XML do ứng dụng xuất không bị đọc thành track rỗng |
| F14 | Ánh xạ và cắt cue khi conform; chặn apply timeline rỗng | Xóa shot loại cue neo shot; global cue cắt theo master; trim/reorder, dịch in-point dù duration không đổi, frame count; cue mồ côi yêu cầu review; apply rỗng/không hợp lệ không publication |
| F15 | `StreamingReferenceHasher`, caller dùng await | Digest theo bytes; file thiếu/quá 64 MiB/hủy; thay reference tại ranh giới kiểm định bị từ chối; event loop vẫn được phục vụ |
| F16 | Factory TTS dùng chung, cấu hình F5 reference/profile/speed, mock rõ ràng | Factory truyền reference; client F5 chỉ nhận profile đã đăng ký; bỏ fallback theo `NODE_ENV`; các test client/factory |
| F17 | Bible v13 backfill ownership duy nhất; bỏ LIKE wildcard | Series `_` không chia sẻ chi phí; owner duy nhất được gán; owner mơ hồ giữ log và chặn paid work; migration mở lại không trùng |

## Hợp đồng tài sản và khôi phục

Generation mới nằm trong `outputDir/audio-generations/<generationId>/`. Manifest chứa fingerprint, SHA-256 audio/timeline/script, FPS, thời lượng probe, sai số codec được khai báo, thời lượng shot lập kế hoạch và thời lượng sau overflow. Thời lượng visual dùng để submit không bị đổi theo overflow audio.

Thứ tự công bố: ghi tài sản → kiểm định → ghi manifest → ghi checkpoint tham chiếu generation → xuất timeline/script tương thích. Checkpoint là điểm commit. Thư mục chưa được checkpoint tham chiếu được giữ nhưng không được tự chọn làm kết quả đã hoàn tất. `timeline.json` và `artifacts/unified_timeline.json` có thể dựng lại cục bộ từ generation đã commit.

TTS attempt được persist trước POST. LucyLab có remote ID được lưu trước poll; resume poll/download bằng ID đó. Với provider trả bytes trực tiếp, response đã được tải và băm được giữ trong staging để phục hồi publication. Không có remote ID hoặc bytes đã xác thực thì không suy luận rằng request chưa được tính phí.

Các mã cần xử lý:

| Mã | Hành động |
| --- | --- |
| `AUDIO_RESUME_REVIEW_REQUIRED` | Kiểm tra checkpoint, manifest và timeline/hash. Giữ nguyên tài sản. Khi quyết định tạo mới, dùng hành động tạo lại audio rõ ràng. |
| `TTS_SUBMIT_UNCERTAIN` / `TTS_RECOVERY_REQUIRED` | Đối chiếu provider và remote ID/response staging. Retry không submit lại khi chưa có bằng chứng. |
| `CHECKPOINT_REVIEW_REQUIRED` | Khôi phục checkpoint từ bản sao nhất quán hoặc kiểm tra thủ công; không sửa bằng cách xóa checkpoint để ép pipeline gọi provider. |
| `PROJECT_BUSY` | Kiểm tra job, handle và maintenance đang dùng series. Không xóa khóa của process còn sống. |
| `LEGACY_USAGE_RECONCILIATION_REQUIRED` | Xác minh ownership log cũ; báo cáo Gateway hiển thị số lượng và các hàng cần xử lý. |

Studio có hành động **Tạo lại audio (có thể phát sinh phí)** ở job episode cần kiểm tra audio/TTS. API: `POST /api/v1/jobs/<id>/regenerate-audio`. Job phải không còn worker sở hữu. CLI `series:episode` và `series:resume` nhận `--regenerate-audio`:

```text
npm run series -- series:resume --series <id> --episode <n> --script <path> --regenerate-audio
```

Đây là hành động cho phép một scope TTS mới; cần kiểm tra chế độ mock/production và provider trong cấu hình trước khi chạy.

## Các điểm commit và đối soát

`TTS`: persist attempt → một POST → persist remote ID (nếu có) → poll/download → probe/hash staging → persist downloaded → publish local → completed. Nếu POST không rõ kết quả và không có remote ID/bytes đủ bằng chứng, chuyển uncertain; không tự submit lại. Lỗi publication khi đã có bytes phục hồi bằng copy/rename local.

`Audio generation`: ghi audio/timeline/script → kiểm định và băm → ghi manifest → **commit checkpoint** → xuất compatibility timeline/script. Kill trước checkpoint giữ generation cũ; kill sau checkpoint có thể dựng lại compatibility exports từ manifest đã commit.

`Invoice`: persist inbox queue → transaction Bible cập nhật chi phí **và receipt** → ack inbox queue. Kill giữa Bible commit và ack làm replay receipt, không cộng tiền lần nữa. Invoice xung đột giữ uncertain cho đến khi có đối soát rõ ràng.

## Migration và phát hành

1. Dừng Studio và mọi worker/CLI ghi dữ liệu. Xác nhận process đã thoát và không còn handle.
2. Sao lưu đồng bộ queue DB, từng Story Bible, checkpoint và tài sản liên quan. Khi dùng SQLite `VACUUM INTO`, bản sao bao gồm dữ liệu đã commit trong WAL; không chỉ copy riêng file `.db` lúc process đang chạy.
3. Chạy binary mới trên bản sao dữ liệu, trong workspace riêng, trước khi mở bản thật. `STUDIO_JOB_DB` phải trỏ đúng queue. Không dùng provider trả phí trong lần kiểm tra này.
4. Queue nâng từ v2 → v3 qua một migrator dùng chung cho JobStore/ProviderDispatchStore/TtsAttemptStore. Bản sao trước migration có hậu tố `.pre-v3-<uuid>.bak`. Schema gồm series sessions/maintenance, TTS attempts và invoice events, cùng index phục vụ queue/reconciliation (bao gồm series/state/time của TTS qua JSON payload).
5. Story Bible nâng đến v13, có snapshot `.pre-v13-<timestamp>.bak`, `provider_invoice_receipts` và `legacy_usage_ownership`. Chỉ backfill khi quan hệ shot/episode → provider jobs cho đúng một owner. Không slugify ID cũ.
6. Khởi động Studio: journal restore dang dở được xử lý trước readiness và nhận job. Journal nằm trong `data/maintenance/`, ngoài các thư mục bị thay thế. Owner còn sống không được tự thu hồi quyền. Sau khi xác nhận owner đã chết, rollback journal chưa commit rồi thu hồi khóa bỏ lại.
7. Kiểm tra schema, ownership cần đối soát, remote attempt và hóa đơn chưa áp dụng. Gateway hiển thị số TTS attempt chưa hoàn tất, invoice pending và maintenance lock; nhóm log cũ mơ hồ được báo riêng.

Invoice event không bị xóa khi chưa áp dụng. Hóa đơn và receipt được ghi cùng transaction Bible, sau đó inbox mới được ack. Invoice hợp lệ thay estimate, kể cả 0. Hai invoice khác nhau không có revision đáng tin cậy giữ trạng thái chi phí uncertain; trạng thái execution vẫn terminal. Khi đối soát thủ công có thu phí, phải chỉ rõ số tiền hữu hạn không âm. Nguồn được ghi `manual_reconciliation`. CLI `series:reconcile --series <id>` chỉ xem; thay đổi cần `--job <attemptId> --action confirm|fail|discard`. Confirm/fail cần `--cost <amount>` rõ ràng; action không hợp lệ hoặc job thuộc series khác bị từ chối.

Để xử lý ownership legacy thủ công, dừng các process, sao lưu trước, tìm bằng chứng quan hệ owner và cập nhật **cả** `api_usage_logs.series_id` và `legacy_usage_ownership.status/candidates` trong cùng transaction. Không tự gán theo tiền tố shot ID. Hàng không xác định được vẫn giữ lại. Hàng ứng viên rỗng được xem là có khả năng ảnh hưởng mọi series và chặn paid work cho đến khi đối soát.

## Rollback

- Dừng toàn bộ process trước khi phục hồi.
- Khôi phục cả binary cũ và bộ queue/Bible/checkpoint/tài sản tương ứng từ snapshot trước migration. Không chạy binary cũ trên queue v3 hoặc Bible v13.
- Giữ các generation đã tạo sau migration và journal để đối soát; không garbage-collect trong đợt sửa này.
- Không tự reset attempt uncertain hoặc invoice receipt để chạy lại; việc đó có thể gọi dịch vụ trả phí lặp hoặc cộng hóa đơn hai lần.

## Xác minh và giới hạn

Môi trường đã kiểm tra: Windows, Node v24.13.1. Mọi lượt test dùng `scripts/run-tests.mjs`, giữ TEMP/TMP phù hợp Windows, dùng media thực, tệp/DB tạm và barrier cho race/crash.

Đã chẩn đoán và sửa hai lỗi môi trường/fixture mà không nới validator: đường dẫn Windows hơn 260 ký tự của FFmpeg/ffprobe; browser smoke đợi initial scope requests hoàn tất trước khi sửa Bible. Renderer duration và fixture reference được sửa theo hợp đồng thực.

CI đã khai báo Windows/Linux và Node 22/24, cùng typecheck, architecture, unit/frontend/integration/media, build, runtime/browser smoke. Container smoke dùng `docker exec` gọi API loopback trong container với `--network none`, giữ chính sách local-only. Lượt CI Linux, Node 22 và container chưa được thực thi từ phiên này. Docker Desktop trên máy hiện trả HTTP 500 khi đọc `docker info`, vì vậy smoke container local chưa xác minh. Không kiểm chứng provider trả phí thật trong nghiệm thu offline.

Phần sao lưu/restore và phục hồi journal nằm trong adapter `modules/projects/adapters/filesystem/backup.ts`. Bootstrap cung cấp `ProjectMaintenance` cho HTTP; public module API chỉ xuất hợp đồng. Không còn `Set` bảo trì trong HTTP. TTS attempt mới lưu series trong payload; attempt legacy không rõ series mà chưa hoàn tất chặn bảo trì để tránh làm mất bằng chứng.

## Kết quả nghiệm thu cục bộ

- Lượt đầy đủ trên mã cố định: **923/923 test, 135 tệp test; 0 lỗi, 0 pending/skip**, report `output/audit-acceptance-frozen.json`.
- Sau bổ sung signal cho probe trong bước download, media suite được chạy lại: **214/214 test, 32 tệp; 0 lỗi, 0 pending/skip**, report `output/audit-media-acceptance.json`. Hai hồi quy mới dùng barrier cho caller cancellation và deadline sau download; không tăng timeout. Các số liệu này có overlap, không cộng thành tổng.
- Application, Studio và tooling typecheck đạt; kiểm tra kiến trúc: **477 tệp, 1073 runtime edges, 0 vi phạm**.
- Build cuối, compiled CLI, runtime restart/resume/dedup và browser smoke 17 tab đều đạt. Browser kiểm tra scope race, episode switch, tạo series/character/reference, lưu draft, mock production, artifact registration và targeted reroll/review gate/master preservation. Số liệu lưu tại [audit-verification-2026-10-12.json](audit-verification-2026-10-12.json).
- Lượt test đầy đủ được khởi động khi mã đang thay đổi trước đó có 1 test lệch phiên bản; đã chạy lại với source cố định và đạt 923/923. Không sửa assertion hoặc bỏ test để che lỗi.
- Một lượt build gặp `EPERM` lúc rename staging → dist khi media runner còn hoạt động; rollback giữ build cũ. Log được giữ tại `output/audit-build-publication-eperm.log`; xác minh publication sau khi runner đóng đã thành công; runtime/browser smoke được chạy lại trên build này.
- Docker engine kiểm tra lại vẫn trả **HTTP 500**, exit code 1; stderr lưu tại `output/audit-container-engine.log`. Smoke container, CI Linux và Node 22 **chưa xác minh**. Vì các gate này chưa chạy, chưa kết luận nghiệm thu production toàn bộ.
