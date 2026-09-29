/** Isolated, repeatable acceptance. No credentials and no paid provider calls. */
import { resolve, join } from "node:path";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import type { StudioJob } from "../src/server/studio-contract.js";

for (const key of Object.keys(process.env)) if (/(KEY|TOKEN|SECRET|PASSWORD)/i.test(key)) delete process.env[key];
process.env.NODE_ENV = "test";
process.env.DOTENV_CONFIG_PATH = resolve("output/upgrade/nonexistent-test.env");
await import("../src/utils/media-runtime.js");
const { StudioServer } = await import("../src/server/studio-server.js");
const { EpisodicScriptSchema } = await import("../src/series/series-schema.js");
const { probeVideoFile, probeAudioFile } = await import("../src/media/media-validator.js");
const { BibleManager } = await import("../src/bible/bible-manager.js");

const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
const seriesId = `mock-acceptance-${stamp}`;
const reportDir = resolve("output/upgrade", seriesId);
await mkdir(reportDir, { recursive: true });
const studio = new StudioServer({ port: 0, workersEnabled: true, queuePath: join(reportDir, "jobs.db"), settingsPath: join(reportDir, "settings.env") });
const base = await studio.start();
console.log(`STUDIO_URL=${base}/studio-next`);
console.log(`SERIES_ID=${seriesId}`);
await writeFile(resolve("output/upgrade/active-acceptance.json"), JSON.stringify({ base, seriesId, reportDir }));

async function request(path: string, body?: unknown) {
  const response = await fetch(base + path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json() as any;
  assert(response.ok, `${response.status}: ${JSON.stringify(data)}`);
  return data;
}
async function waitForJob(id: string): Promise<StudioJob> {
  const deadline = Date.now() + 20 * 60_000;
  let last = "";
  while (Date.now() < deadline) {
    const { job } = await request(`/api/v1/jobs/${id}`) as {job:StudioJob};
    const message = `${job.status}: ${job.progress?.message || ""}`;
    if (message !== last) { console.log(message); last = message; }
    if (["succeeded", "failed", "needs_review", "cancelled"].includes(job.status)) {
      assert.equal(job.status, "succeeded", JSON.stringify(job.error)); return job;
    }
    await delay(1000);
  }
  throw new Error("Acceptance job timed out");
}
const results: unknown[] = [];
try {
  await request("/api/series/init", { id: seriesId, title: "Nghiệm thu mock — Chiếc chìa khóa", aspect_ratio: "16:9", fps: 30 });
  for (const [id, name] of [["minh", "Minh"], ["lan", "Lan"]]) await request(`/api/series/${seriesId}/characters`, { id, name, role: "protagonist", visual_summary: `${name}, áo khoác xanh, giữ nguyên qua hai tập` });
  for (const [id, name] of [["river", "Bến sông"], ["warehouse", "Nhà kho"], ["courtyard", "Sân trong"]]) await request(`/api/series/${seriesId}/locations`, { id, name });
  await request(`/api/series/${seriesId}/props`, { id: "key", name: "Chìa khóa đồng", current_holder_id: "minh" });
  let firstRequest: unknown;
  let firstJob: StudioJob | undefined;
  for (const episode of [1, 2]) {
    const script = EpisodicScriptSchema.parse({
      seriesId, episodeNumber: episode, title: `Chiếc chìa khóa — Tập ${episode}`, logline: "Minh và Lan tìm bản đồ bằng chìa khóa đồng.", aspectRatio: "16:9", fps: 30,
      scenes: ["river", "warehouse", "courtyard"].map((locationId, index) => ({
        sceneId: `sc${index + 1}`, sceneNumber: index + 1, locationId, locationName: locationId, charactersPresent: ["minh", "lan"], propsPresent: ["key"], timeOfDay: "day",
        shots: [1, 2].map(number => ({ shotId: `sc${index + 1}_sh${number}`, shotType: number === 1 ? "wide" : "medium", durationSec: 25,
          visualPrompt: `Minh và Lan tại ${locationId}; chiếc chìa khóa đồng trong tay Minh, tập ${episode}.`,
          dialogues: [{ characterId: number === 1 ? "minh" : "lan", speakerName: number === 1 ? "Minh" : "Lan", text: episode === 1 ? "Chúng ta sẽ tìm được cánh cửa." : "Bản đồ nằm sau cánh cửa này." }],
        })),
      })),
    });
    const rawScreenplay = JSON.stringify(script);
    await request(`/api/v1/series/${seriesId}/episodes/${episode}/draft`, { baseVersion: 0, text: rawScreenplay });
    const body = { seriesId, episodeNumber: episode, rawScreenplay, mode: "mock", provider: "mock" };
    const start = Date.now();
    const queued = await request("/api/v1/jobs", body);
    const job = await waitForJob(queued.jobId);
    assert(job.result?.isMock);
    const video = await probeVideoFile(job.result!.videoPath), audio = await probeAudioFile(job.result!.videoPath);
    assert(video.isValid && audio.isValid, "Master must contain decodable video and audio streams");
    assert(Math.abs(video.durationSec - 150) < 0.1, `Unexpected duration ${video.durationSec}`);
    const videoDuration = video.videoStream?.durationSec;
    const audioDuration = video.audioStream?.durationSec;
    assert(videoDuration !== undefined && audioDuration !== undefined, "Missing stream durations");
    assert(Math.abs(videoDuration - audioDuration) <= 1 / 30 + .05, "Audio/video stream drift");
    assert.equal(video.videoStream?.width, 1920); assert.equal(video.videoStream?.height, 1080);
    const manifest = JSON.parse(await readFile(join(job.result!.outputDir, "assembly", "assembly-manifest.json"), "utf8"));
    const artifacts = await request(`/api/v1/series/${seriesId}/episodes/${episode}/artifacts`);
    assert(artifacts.timeline.videoTrack.length === 6);
    for (const suffix of [".srt", ".vtt", ".otio", ".xml"]) assert(artifacts.files.some((file:string) => file.endsWith(suffix)), `Missing ${suffix}`);
    const range = await fetch(base + "/api/media/stream?path=" + encodeURIComponent(job.result!.videoPath), { headers: { Range: "bytes=0-99" } });
    assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 100);
    results.push({ episode, durationSec: videoDuration, audioDurationSec: audioDuration, width: video.videoStream?.width, height: video.videoStream?.height, elapsedSec: (Date.now() - start) / 1000, files: artifacts.files, mock: true, qa: manifest.qaReport });
    await writeFile(join(reportDir, "progress.json"), JSON.stringify({ seriesId, results }, null, 2));
    if (episode === 1) {firstRequest = body; firstJob = job;}
  }
  const firstPath = join(firstJob!.result!.outputDir, "shots", "sc1_sh1.mp4");
  const before = { mtime: (await stat(firstPath)).mtimeMs, hash: createHash("sha256").update(await readFile(firstPath)).digest("hex") };
  const resumed = await request("/api/v1/jobs", firstRequest);
  await waitForJob(resumed.jobId);
  assert.equal((await stat(firstPath)).mtimeMs, before.mtime, "Clean resume regenerated the shot");
  assert.equal(createHash("sha256").update(await readFile(firstPath)).digest("hex"), before.hash);
  const bible = new BibleManager(resolve("data/series", seriesId, "story_bible.db"));
  try { assert.equal(bible.getCanonHistory(seriesId).length, 0, "Mock must not commit production canon"); } finally { bible.close(); }
  const report = { passed: true, scope: "mock software acceptance only; no AI quality claim", seriesId, base, results, cleanResumePreservedMedia: true, mockCanonUnchanged: true };
  await writeFile(join(reportDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(`ACCEPTANCE_PASSED=${join(reportDir, "report.json")}`);
  if (process.argv.includes("--serve")) { console.log("Studio remains open for UI verification."); await new Promise(() => {}); }
} catch (error) {
  await writeFile(join(reportDir, "failure.json"), JSON.stringify({ passed: false, seriesId, results, error: error instanceof Error ? error.message : String(error) }, null, 2));
  throw error;
} finally { await studio.close(); }
