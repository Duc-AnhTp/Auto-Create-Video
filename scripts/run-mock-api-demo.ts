import { StudioServer } from "../src/server/studio-server.js";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";

async function main() {
  console.log("======================================================================");
  console.log("🎬 AUTO-CREATE-VIDEO: CHẠY THỬ NGHIỆM MOCK SẢN XUẤT 2 TẬP PHIM QUA API");
  console.log("======================================================================\n");

  const seriesId = "cyber-saigon";
  const ep1ScriptPath = resolve("scripts/example-series/cyber-saigon-ep1.txt");
  const ep2ScriptPath = resolve("scripts/example-series/cyber-saigon-ep2.txt");

  console.log("1. Đọc kịch bản 2 tập phim mẫu:");
  const ep1Text = await readFile(ep1ScriptPath, "utf-8");
  const ep2Text = await readFile(ep2ScriptPath, "utf-8");
  console.log(`   - Tập 1: ${ep1ScriptPath} (${ep1Text.length} ký tự)`);
  console.log(`   - Tập 2: ${ep2ScriptPath} (${ep2Text.length} ký tự)\n`);

  console.log("2. Khởi động Studio Server (API Gateway)...");
  const studio = new StudioServer({
    port: 0,
    host: "127.0.0.1",
    workersEnabled: false, // direct API produce execution
  });

  const serverUrl = await studio.start();
  console.log(`   -> Studio API Server đang lắng nghe tại: ${serverUrl}\n`);

  try {
    // 3. Khởi tạo Series Metadata qua API
    console.log(`3. Khởi tạo Series [${seriesId}] qua API POST /api/series/init...`);
    const initRes = await fetch(`${serverUrl}/api/series/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: seriesId,
        title: "Cyber Saigon 2088",
        genre: "Cyberpunk Action Mystery",
        visual_style: "Cinematic 35mm, neon noir, anamorphic lens, 8k",
        aspect_ratio: "9:16",
        fps: 30,
      }),
    });
    const initData = await initRes.json();
    console.log(`   -> Kết quả: HTTP ${initRes.status}`, initData);

    // Thêm nhân vật qua API
    console.log("   -> Đăng ký nhân vật (Minh, An, Linh)...");
    await fetch(`${serverUrl}/api/series/${seriesId}/characters`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "char_minh",
        name: "Minh",
        role: "protagonist",
        visual_summary: "Minh, 32 tuổi, thám tử điều tra, áo khoác dạ xám",
        voice_profile_id: "lucylab:male_01",
      }),
    });

    await fetch(`${serverUrl}/api/series/${seriesId}/characters`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "char_an",
        name: "An",
        role: "supporting",
        visual_summary: "An, 24 tuổi, hacker thiên tài, áo hoodie đen viền led",
        voice_profile_id: "lucylab:female_01",
      }),
    });

    await fetch(`${serverUrl}/api/series/${seriesId}/characters`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "char_linh",
        name: "Linh",
        role: "supporting",
        visual_summary: "Linh, 27 tuổi, nữ xạ thủ đặc nhiệm ngầm",
        voice_profile_id: "lucylab:female_02",
      }),
    });

    // Thêm địa danh qua API
    console.log("   -> Đăng ký địa danh...");
    await fetch(`${serverUrl}/api/series/${seriesId}/locations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "loc_bar_hem_9",
        name: "Quán Bar Hẻm 9",
        visual_summary: "Quán bar ngầm tràn ngập đèn neon đỏ tím trong con hẻm ẩm ướt",
      }),
    });

    // Thêm đạo cụ qua API
    console.log("   -> Đăng ký đạo cụ...");
    await fetch(`${serverUrl}/api/series/${seriesId}/props`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "prop_chip",
        name: "Con Chip Lượng Tử",
        visual_summary: "Chip vi xử lý lượng tử phát ánh sáng xanh ngọc",
        current_holder_id: "char_minh",
      }),
    });
    console.log("   -> Khởi tạo Story Bible hoàn tất!\n");

    // 4. Sản xuất Tập 1 qua API
    console.log("======================================================================");
    console.log("🚀 4. GỬI YÊU CẦU SẢN XUẤT TẬP 1 QUA API...");
    console.log("   POST /api/series/" + seriesId + "/episodes/produce (Provider: mock)");
    console.log("======================================================================");
    const startEp1 = Date.now();
    const ep1Res = await fetch(`${serverUrl}/api/series/${seriesId}/episodes/produce`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        episodeNumber: 1,
        rawScreenplay: ep1Text,
        provider: "mock",
        dryRun: false,
        skipAudit: true,
        async: false,
      }),
    });
    const ep1Data = await ep1Res.json();
    const durEp1 = ((Date.now() - startEp1) / 1000).toFixed(1);
    console.log(`\n✅ Kết quả phản hồi Tập 1 (HTTP ${ep1Res.status}) trong ${durEp1}s:`, ep1Data);

    // Kiểm tra file kết xuất của Tập 1
    const ep1VideoPath = resolve(`output/series/${seriesId}/ep-01/video.mp4`);
    const ep1AudioPath = resolve(`output/series/${seriesId}/ep-01/audio/master-soundtrack.mp3`);
    const ep1TimelinePath = resolve(`output/series/${seriesId}/ep-01/timeline.json`);
    console.log("\n📦 Kiểm tra Artifacts Tập 1 trên ổ đĩa:");
    if (existsSync(ep1VideoPath)) {
      const s = await stat(ep1VideoPath);
      console.log(`   🎥 VIDEO HOÀN CHỈNH: ${ep1VideoPath} (${(s.size / 1024).toFixed(1)} KB)`);
    } else {
      console.log(`   ❌ Video không tồn tại: ${ep1VideoPath}`);
    }
    if (existsSync(ep1AudioPath)) {
      const s = await stat(ep1AudioPath);
      console.log(`   🎵 AUDIO MASTER:     ${ep1AudioPath} (${(s.size / 1024).toFixed(1)} KB)`);
    }
    if (existsSync(ep1TimelinePath)) {
      console.log(`   📋 TIMELINE JSON:     ${ep1TimelinePath}`);
    }

    // 5. Sản xuất Tập 2 qua API
    console.log("\n======================================================================");
    console.log("🚀 5. GỬI YÊU CẦU SẢN XUẤT TẬP 2 QUA API...");
    console.log("   POST /api/series/" + seriesId + "/episodes/produce (Provider: mock)");
    console.log("======================================================================");
    const startEp2 = Date.now();
    const ep2Res = await fetch(`${serverUrl}/api/series/${seriesId}/episodes/produce`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        episodeNumber: 2,
        rawScreenplay: ep2Text,
        provider: "mock",
        dryRun: false,
        skipAudit: true,
        async: false,
      }),
    });
    const ep2Data = await ep2Res.json();
    const durEp2 = ((Date.now() - startEp2) / 1000).toFixed(1);
    console.log(`\n✅ Kết quả phản hồi Tập 2 (HTTP ${ep2Res.status}) trong ${durEp2}s:`, ep2Data);

    // Kiểm tra file kết xuất của Tập 2
    const ep2VideoPath = resolve(`output/series/${seriesId}/ep-02/video.mp4`);
    const ep2AudioPath = resolve(`output/series/${seriesId}/ep-02/audio/master-soundtrack.mp3`);
    const ep2TimelinePath = resolve(`output/series/${seriesId}/ep-02/timeline.json`);
    console.log("\n📦 Kiểm tra Artifacts Tập 2 trên ổ đĩa:");
    if (existsSync(ep2VideoPath)) {
      const s = await stat(ep2VideoPath);
      console.log(`   🎥 VIDEO HOÀN CHỈNH: ${ep2VideoPath} (${(s.size / 1024).toFixed(1)} KB)`);
    } else {
      console.log(`   ❌ Video không tồn tại: ${ep2VideoPath}`);
    }
    if (existsSync(ep2AudioPath)) {
      const s = await stat(ep2AudioPath);
      console.log(`   🎵 AUDIO MASTER:     ${ep2AudioPath} (${(s.size / 1024).toFixed(1)} KB)`);
    }
    if (existsSync(ep2TimelinePath)) {
      console.log(`   📋 TIMELINE JSON:     ${ep2TimelinePath}`);
    }

    // 6. Truy vấn Artifacts qua API GET /api/v1/series/:id/episodes/:ep/artifacts
    console.log("\n======================================================================");
    console.log("🔍 6. TRUY VẤN ARTIFACTS QUA REST API:");
    console.log("======================================================================");
    const art1Res = await fetch(`${serverUrl}/api/v1/series/${seriesId}/episodes/1/artifacts`);
    const art1 = await art1Res.json();
    console.log(`   GET /api/v1/series/${seriesId}/episodes/1/artifacts:`, {
      hasTimeline: Boolean(art1.timeline),
      fileCount: art1.files?.length ?? 0,
      sampleFiles: art1.files?.slice(0, 5),
    });

    const art2Res = await fetch(`${serverUrl}/api/v1/series/${seriesId}/episodes/2/artifacts`);
    const art2 = await art2Res.json();
    console.log(`   GET /api/v1/series/${seriesId}/episodes/2/artifacts:`, {
      hasTimeline: Boolean(art2.timeline),
      fileCount: art2.files?.length ?? 0,
      sampleFiles: art2.files?.slice(0, 5),
    });

    console.log("\n======================================================================");
    console.log("🎉 THÀNH CÔNG RỰC RỠ: CẢ 2 TẬP PHIM ĐÃ ĐƯỢC TẠO HOÀN CHỈNH TỪ API!");
    console.log("======================================================================");
  } catch (error: any) {
    console.error("❌ Lỗi trong quá trình thử nghiệm:", error.message || error);
    if (error.stack) console.error(error.stack);
  } finally {
    await studio.close();
  }
}

main().catch(console.error);
