import { describe,it,expect,beforeAll,afterAll } from "vitest";
import { StudioServer } from "../../bootstrap/studio-server.js";
import axios from "axios";
describe("Studio v1 contracts", () => {
  const studio = new StudioServer({port:0,queuePath:":memory:",workersEnabled:false});
  let url:string;
  beforeAll(async()=>{url=await studio.start();});
  afterAll(async()=>{await studio.close();});
  it("returns an accepted job id and durable status",async()=>{
    const {data,status}=await axios.post(url+"/api/v1/jobs",{seriesId:"test-pilot",episodeNumber:1,rawScreenplay:"TẬP 1: Test"});
    expect(status).toBe(202); expect(data.jobId).toBeTruthy();
    expect((await axios.get(url+"/api/v1/jobs/"+data.jobId)).data.job.status).toBe("queued");
    expect((await axios.post(url+"/api/v1/jobs/"+data.jobId+"/pause",{})).data.job.status).toBe("paused");
  });
  it("accepts custom exportResolution in job request", async () => {
    const { data, status } = await axios.post(url + "/api/v1/jobs", {
      seriesId: "test-resolution",
      episodeNumber: 1,
      rawScreenplay: "TẬP 1: Test Resolution",
      exportResolution: "720p",
    });
    expect(status).toBe(202);
    const jobRes = await axios.get(url + "/api/v1/jobs/" + data.jobId);
    expect(jobRes.data.job.request.exportResolution).toBe("720p");
  });
  it("accepts large source text as a queued import without returning or exposing the source", async () => {
    const text = "đ".repeat(1_200_000);
    const { data, status } = await axios.post(url + "/api/v1/series/large-source-test/source", {
      title: "Large novel",
      text,
      episodes: 2,
    });
    expect(status).toBe(202);
    expect(data.job.request.text).toBe("");
    expect(JSON.stringify(data)).not.toContain(text.slice(0, 100));
    const statusResponse = await axios.get(url + "/api/v1/story-imports/" + data.jobId);
    expect(statusResponse.data.job.status).toBe("queued");
    expect(statusResponse.data.job.request.text).toBe("");
  });
  it("does not run the legacy producer directly when its durable queue rejects a duplicate episode", async () => {
    const endpoint = url + "/api/series/legacy-queue-lock/episodes/produce";
    const first = await axios.post(endpoint, {
      episodeNumber: 1,
      rawScreenplay: "TẬP 1: Queued job",
      provider: "mock",
      async: true,
    });
    expect(first.status).toBe(202);

    const duplicate = await axios.post(endpoint, {
      episodeNumber: 1,
      rawScreenplay: "TẬP 1: Duplicate attempt",
      provider: "mock",
      async: true,
    }, { validateStatus: () => true });

    expect(duplicate.status).toBe(409);
    expect(duplicate.data.error).toBe("EPISODE_BUSY");
    const jobs = await axios.get(url + "/api/v1/jobs");
    expect(jobs.data.jobs.filter((job: any) => job.request.seriesId === "legacy-queue-lock")).toHaveLength(1);
  });
  it("rejects traversal, unbudgeted production and cross-origin writes",async()=>{
    const request={seriesId:"../private",episodeNumber:1,rawScreenplay:"test"};
    expect((await axios.post(url+"/api/v1/jobs",request,{validateStatus:()=>true})).status).toBe(400);
    expect((await axios.post(url+"/api/v1/jobs",{...request,seriesId:"pilot",mode:"production",provider:"api_kling"},{validateStatus:()=>true})).status).toBe(400);
    expect((await axios.post(url+"/api/v1/jobs",request,{headers:{Origin:"https://evil.example"},validateStatus:()=>true})).status).toBe(403);
  });
  it("rejects oversize JSON",async()=>{
    expect((await axios.post(url+"/api/v1/jobs",{text:"x".repeat(2_200_000)},{validateStatus:()=>true})).status).toBe(413);
  });
  it("uses optimistic draft versioning",async()=>{
    const endpoint=url+"/api/v1/series/test-pilot/episodes/1/draft";
    expect((await axios.post(endpoint,{baseVersion:0,text:"saved"})).data.version).toBe(1);
    expect((await axios.post(endpoint,{baseVersion:0,text:"stale"},{validateStatus:()=>true})).status).toBe(409);
  });

  it("harmonizes multi-shot scene lighting and white balance", async () => {
    const endpoint = url + "/api/v1/series/test-pilot/scenes/scene_01/lighting/harmonize";
    const res = await axios.post(endpoint, {
      episodeNumber: 1,
      targetEnvironmentPreset: "golden_hour",
      keyLightAzimuthDeg: 45,
      keyLightElevationDeg: 25,
      shots: [
        { shotId: "shot_wide", shotType: "establishing", averageRgb: [180, 140, 95] },
        { shotId: "shot_ots_ba", shotType: "ots_b_a", averageRgb: [170, 142, 115] },
        { shotId: "shot_cu", shotType: "close_up", averageRgb: [160, 130, 90] },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.result.sceneId).toBe("scene_01");
    expect(res.data.result.masterShotId).toBe("shot_wide");
    expect(res.data.result.profiles.length).toBe(3);
    expect(res.data.result.davinciCdlManifestXml).toContain("<ColorDecisionList");
  });

  it("simulates directional 3D relighting and ComfyUI directives", async () => {
    const endpoint = url + "/api/v1/media/lighting/simulate-relight";
    const res = await axios.post(endpoint, {
      azimuthDeg: -45,
      elevationDeg: 30,
      intensity: 1.3,
      preset: "cyberpunk_night",
    });
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.relightingConfig).toBeDefined();
    expect(res.data.relightingConfig.keyLight.vector3D).toBeDefined();
    expect(res.data.filterGraph).toContain("eq=");
    expect(res.data.comfyUiDirectives).toBeDefined();
  });

  it("auto-cuts a 60s teaser trailer for season and exports NLE manifests", async () => {
    const endpoint = url + "/api/v1/series/test-pilot/season/trailer/auto-cut";
    const res = await axios.post(endpoint, {
      targetDurationSec: 60,
      seriesTitle: "HẠT BỤI ĐIỆN BIÊN",
      tagline: "Chiến Thắng Vang Dội",
      musicStyle: "epic_orchestral",
    }, { validateStatus: () => true });
    expect(res.status, JSON.stringify(res.data)).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.trailer.seriesId).toBe("test-pilot");
    expect(res.data.trailer.targetDurationSec).toBe(60);
    expect(res.data.trailer.cutsCount).toBeGreaterThan(5);
    expect(res.data.trailer.fcp7XmlPath).toContain(".xml");
    expect(res.data.trailer.cmx3600EdlPath).toContain(".edl");

    // Test GET trailer endpoint
    const getRes = await axios.get(url + "/api/v1/series/test-pilot/season/trailer");
    expect(getRes.status).toBe(200);
    expect(getRes.data.success).toBe(true);
    expect(getRes.data.trailer.targetDurationSec).toBe(60);
  });

  it("runs the multi-episode season demo and does not report mock lip-sync as measured alignment", async () => {
    const endpoint = url + "/api/v1/series/test-pilot/season/demo";
    const res = await axios.post(endpoint, {
      totalEpisodes: 2,
      seasonBudgetUsd: 40.0,
      enable4kPost: true,
      enableLightingHarmonization: true,
      enableEmotionalVoice: true,
      enableLipSync: true,
      generateSeasonTrailer: true,
      trailerTargetDurationSec: 30,
      trailerTagline: "Trận Đánh Cuối Cùng",
    }, { validateStatus: () => true });
    expect(res.status, JSON.stringify(res.data)).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.manifest.completedEpisodes).toBe(2);
    expect(res.data.manifest.episodes[0].lightingHarmonized).toBe(true);
    expect(res.data.manifest.episodes[0].lipSyncAligned).toBe(false);
    expect(res.data.manifest.trailerResult).toBeDefined();
    expect(res.data.manifest.trailerResult.targetDurationSec).toBe(30);
  });
});
