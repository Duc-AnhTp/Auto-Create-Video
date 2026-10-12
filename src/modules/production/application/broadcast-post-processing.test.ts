import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { SuperResolutionEngine } from "../../media/adapters/super-resolution.js";
import {
  CdlGradingEngine,
  CINEMATIC_LOOK_PRESETS,
  type AscCdl,
} from "../../media/adapters/cdl-grading-engine.js";
import { SpatialFoleyEngine, type SpatialAudioCue } from "../../media/adapters/audio/spatial-foley-engine.js";
import { BroadcastQcEnhancer } from "../../media/adapters/broadcast-qc-enhancer.js";
import { SqliteStoryStore } from "../../../bootstrap/sqlite-story-store.js";
import { ArtifactStore } from "../../media/adapters/artifact-store.js";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { CinematicPostPipeline } from "../../media/application/cinematic-post-pipeline.js";
import { StudioApi } from "../../../bootstrap/studio-api.js";
import { createValidMockMp4File } from "../../media/adapters/assets/mock-media-generator.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "cinematic-post-test-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("Option 2: Broadcast Cinematic Post-Processing Suite", () => {
  // ── 1. 4K Super-Resolution & Upscaling Engine ──
  describe("SuperResolutionEngine", () => {
    it("computes standard and vertical cinema 4K dimensions accurately", () => {
      const w4k = SuperResolutionEngine.computeTargetDimensions("16:9", "4k");
      expect(w4k).toEqual({ width: 3840, height: 2160 });

      const v4k = SuperResolutionEngine.computeTargetDimensions("9:16", "4k");
      expect(v4k).toEqual({ width: 2160, height: 3840 });

      const w1080 = SuperResolutionEngine.computeTargetDimensions("16:9", "1080p");
      expect(w1080).toEqual({ width: 1920, height: 1080 });

      const custom = SuperResolutionEngine.computeTargetDimensions("16:9", "custom", {
        width: 2560,
        height: 1440,
      });
      expect(custom).toEqual({ width: 2560, height: 1440 });
    });

    it("generates comprehensive FFmpeg filter graph with Lanczos4, unsharp, color space, and film grain", () => {
      const dim = { width: 3840, height: 2160 };
      const filter = SuperResolutionEngine.buildFfmpegFilterGraph(dim, {
        algorithm: "lanczos4",
        colorSpace: "bt709",
        filmGrainIntensity: 0.15,
        unsharpStrength: 0.8,
        bitDepth: 10,
        denoisePrePass: true,
      });

      expect(filter).toContain("hqdn3d=1.5:1.5:2.5:2.5");
      expect(filter).toContain("scale=3840:2160:flags=lanczos+accurate_rnd+full_chroma_int");
      expect(filter).toContain("unsharp=5:5:0.80:3:3:0.40");
      expect(filter).toContain("colorspace=all=bt709:trc=bt709:space=bt709:fast=0");
      expect(filter).toContain("noise=alls=6:allf=t+u");
      expect(filter).toContain("format=yuv420p10le");
    });

    it("executes upscaleVideo and produces mock 4K artifact with correct properties", async () => {
      const inVideo = join(tmp, "input_720p.mp4");
      const outVideo = join(tmp, "output_4k.mp4");
      await createValidMockMp4File(inVideo, 3.0, 720, 1280);

      const result = await SuperResolutionEngine.upscaleVideo(inVideo, outVideo, {
        targetStandard: "4k",
        aspectRatio: "16:9",
        filmGrainIntensity: 0.15,
        bitDepth: 10,
        mockFallback: true,
      });

      expect(existsSync(outVideo)).toBe(true);
      expect(result.outputResolution).toEqual({ width: 3840, height: 2160 });
      expect(result.bitDepth).toBe(10);
      expect(result.hasFilmGrain).toBe(true);
      expect(result.colorSpace).toBe("bt709");
    });
  });

  // ── 2. ASC CDL Color Grading Engine & 3D LUT Generation ──
  describe("CdlGradingEngine", () => {
    it("transforms RGB pixels strictly according to ASC CDL SOP and Saturation math", () => {
      const cdl: AscCdl = {
        slope: [1.1, 1.0, 0.9],
        offset: [-0.02, 0.01, 0.05],
        power: [1.05, 1.0, 0.95],
        saturation: 1.2,
      };

      const [rOut, gOut, bOut] = CdlGradingEngine.transformRgbPixel(0.5, 0.5, 0.5, cdl);
      expect(rOut).toBeGreaterThan(0.0);
      expect(rOut).toBeLessThanOrEqual(1.0);
      expect(gOut).toBeGreaterThan(0.0);
      expect(bOut).toBeGreaterThan(0.0);

      // Verify zero-floor clamping on deep shadows
      const [rDark] = CdlGradingEngine.transformRgbPixel(0.0, 0.0, 0.0, {
        ...cdl,
        offset: [-0.5, -0.5, -0.5],
      });
      expect(rDark).toBe(0.0);
    });

    it("generates Adobe / DaVinci Resolve compliant 3D LUT (.cube) content", () => {
      const cdl = CINEMATIC_LOOK_PRESETS.kodak_2383.cdl;
      const cubeStr = CdlGradingEngine.generateCubeLutContent(cdl, "Kodak2383", 17);

      expect(cubeStr).toContain('TITLE "Kodak2383"');
      expect(cubeStr).toContain("LUT_3D_SIZE 17");
      expect(cubeStr).toContain("DOMAIN_MIN 0.0 0.0 0.0");
      expect(cubeStr).toContain("DOMAIN_MAX 1.0 1.0 1.0");

      const lines = cubeStr.split("\n").filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("TITLE") && !l.startsWith("LUT_") && !l.startsWith("DOMAIN_"));
      // 17 * 17 * 17 = 4913 RGB triples
      expect(lines.length).toBe(17 * 17 * 17);
    });

    it("generates DaVinci Resolve compatible ASC CDL XML", () => {
      const cdl = CINEMATIC_LOOK_PRESETS.teal_orange.cdl;
      const xml = CdlGradingEngine.generateAscCdlXml(cdl, "SHOT_HERO_01");

      expect(xml).toContain('<ColorCorrection id="SHOT_HERO_01">');
      expect(xml).toContain("<Slope>1.1600 1.0000 0.8400</Slope>");
      expect(xml).toContain("<Saturation>1.2500</Saturation>");
    });

    it("applies CDL grade and exports both .cube LUT and XML files", async () => {
      const inVideo = join(tmp, "in_raw.mp4");
      const outVideo = join(tmp, "out_graded.mp4");
      await createValidMockMp4File(inVideo, 2.0);

      const res = await CdlGradingEngine.applyCdlGrade(inVideo, outVideo, "kodak_2383", {
        lutSize: 17,
        mockFallback: true,
      });

      expect(existsSync(outVideo)).toBe(true);
      expect(existsSync(res.lutPath)).toBe(true);
      expect(existsSync(res.xmlPath)).toBe(true);
      expect(res.presetApplied).toBe("kodak_2383");
      expect(res.filterGraphString).toContain("lut3d=");
    });
  });

  // ── 3. Spatial Action Foley Engine ──
  describe("SpatialFoleyEngine", () => {
    it("conserves acoustic power according to Constant-Power Panning Law (L^2 + R^2 = 1.0)", () => {
      // Center position x = 0
      const centerGains = SpatialFoleyEngine.calculateSpatialGains(0.0, "close_up");
      const powerCenter = Math.pow(centerGains.leftGain, 2) + Math.pow(centerGains.rightGain, 2);
      expect(powerCenter).toBeCloseTo(1.0, 2);
      expect(centerGains.leftGain).toBeCloseTo(0.7071, 2);
      expect(centerGains.rightGain).toBeCloseTo(0.7071, 2);

      // Far Left position x = -1
      const leftGains = SpatialFoleyEngine.calculateSpatialGains(-1.0, "close_up");
      expect(leftGains.leftGain).toBeCloseTo(1.0, 2);
      expect(leftGains.rightGain).toBeCloseTo(0.0, 2);

      // Far Right position x = +1
      const rightGains = SpatialFoleyEngine.calculateSpatialGains(1.0, "close_up");
      expect(rightGains.leftGain).toBeCloseTo(0.0, 2);
      expect(rightGains.rightGain).toBeCloseTo(1.0, 2);
    });

    it("applies distance attenuation and high-frequency rolloff correctly", () => {
      const cu = SpatialFoleyEngine.calculateSpatialGains(0.0, "close_up");
      const med = SpatialFoleyEngine.calculateSpatialGains(0.0, "medium");
      const wide = SpatialFoleyEngine.calculateSpatialGains(0.0, "wide");

      expect(cu.distanceGain).toBe(1.0);
      expect(cu.cutoffHz).toBe(20000);

      expect(med.distanceGain).toBe(0.75);
      expect(med.cutoffHz).toBe(12000);

      expect(wide.distanceGain).toBe(0.5);
      expect(wide.cutoffHz).toBe(4500);

      const filterWide = SpatialFoleyEngine.buildSpatialFfmpegFilter(wide, 0.8);
      expect(filterWide).toContain("pan=stereo");
      expect(filterWide).toContain("lowpass=f=4500");
    });

    it("renders spatial foley track from audio cues", async () => {
      const inVideo = join(tmp, "foley_src.mp4");
      const outStem = join(tmp, "spatial_foley.mp3");
      await createValidMockMp4File(inVideo, 4.0);

      const cues: SpatialAudioCue[] = [
        {
          id: "cue_01",
          actionPrompt: "Bước chân trên sàn đá",
          sourceX: -0.5,
          distance: "medium",
          offsetSec: 0.5,
          durationSec: 2.0,
        },
        {
          id: "cue_02",
          actionPrompt: "Tiếng then cửa sắt",
          sourceX: 0.8,
          distance: "close_up",
          offsetSec: 1.5,
          durationSec: 1.5,
        },
      ];

      const res = await SpatialFoleyEngine.renderSpatialFoleyTrack(inVideo, cues, outStem, {
        mockFallback: true,
      });

      expect(existsSync(outStem)).toBe(true);
      expect(res.cuesProcessed).toBe(2);
      expect(res.spatialManifest.length).toBe(2);
      expect(res.spatialManifest[0].gains.combinedLeft).toBeGreaterThan(
        res.spatialManifest[0].gains.combinedRight
      );
      expect(res.spatialManifest[1].gains.combinedRight).toBeGreaterThan(
        res.spatialManifest[1].gains.combinedLeft
      );
    });
  });

  // ── 4. Broadcast QC Enhancer & Auto-Conformance ──
  describe("BroadcastQcEnhancer", () => {
    it("resolves target loudness parameters for EBU R128 and Streaming", () => {
      const ebu = BroadcastQcEnhancer.getTargetParams("broadcast_ebu_r128");
      expect(ebu.targetLufs).toBe(-23.0);
      expect(ebu.targetTp).toBe(-1.0);
      expect(ebu.targetLra).toBe(14.0);

      const streaming = BroadcastQcEnhancer.getTargetParams("streaming_youtube_tiktok");
      expect(streaming.targetLufs).toBe(-14.0);
      expect(streaming.targetTp).toBe(-1.0);
      expect(streaming.targetLra).toBe(11.0);
    });

    it("conforms delivery package with 2-pass loudnorm and studio legal clamping", async () => {
      const inVideo = join(tmp, "unconformed_master.mp4");
      const outVideo = join(tmp, "conformed_master.mp4");
      await createValidMockMp4File(inVideo, 3.0);

      const conf = await BroadcastQcEnhancer.conformDeliveryPackage(inVideo, outVideo, {
        standard: "broadcast_ebu_r128",
        clampVideoLegalRange: true,
        mockFallback: true,
      });

      expect(existsSync(outVideo)).toBe(true);
      expect(conf.standard).toBe("broadcast_ebu_r128");
      expect(conf.videoClampedToLegal).toBe(true);
      expect(conf.postConformLoudness.integratedLufs).toBe(-23.0);
      expect(conf.postConformLoudness.truePeakDbtp).toBe(-1.0);
      expect(conf.qcReport).toBeDefined();
    });
  });

  // ── 5. End-to-End Cinematic Post-Processing Pipeline ──
  describe("CinematicPostPipeline", () => {
    it("executes all 4 phases into a unified master deliverable package", async () => {
      const inMaster = join(tmp, "rough_master.mp4");
      await createValidMockMp4File(inMaster, 4.0, 720, 1280);

      const pipelineRes = await CinematicPostPipeline.executePostPipeline({
        seriesId: "test_series_cinematic",
        episodeNumber: 1,
        inputMasterVideoPath: inMaster,
        outputDir: join(tmp, "cinematic_output"),
        resolutionStandard: "4k",
        aspectRatio: "16:9",
        filmGrainIntensity: 0.18,
        enableCdlGrading: true,
        cdlPreset: "kodak_2383",
        enableSpatialFoley: true,
        enableBroadcastConformance: true,
        deliveryStandard: "broadcast_ebu_r128",
        clampLegalRange: true,
        mockFallback: true,
      });

      expect(pipelineRes.status).toBe("WARN"); // Mock artifacts are never reported as production-verified.
      expect(pipelineRes.stagesCompleted).toContain("super_resolution_4k");
      expect(pipelineRes.stagesCompleted).toContain("cdl_grading_kodak_2383");
      expect(pipelineRes.stagesCompleted).toContain("spatial_foley_panning");
      expect(pipelineRes.stagesCompleted).toContain("broadcast_qc_conformance");

      // Verify all artifact deliverables exist
      expect(existsSync(pipelineRes.artifacts.finalDeliveryMasterPath)).toBe(true);
      expect(existsSync(pipelineRes.artifacts.upscaledVideoPath!)).toBe(true);
      expect(existsSync(pipelineRes.artifacts.gradedVideoPath!)).toBe(true);
      expect(existsSync(pipelineRes.artifacts.lutCubePath!)).toBe(true);
      expect(existsSync(pipelineRes.artifacts.cdlXmlPath!)).toBe(true);
      expect(existsSync(pipelineRes.artifacts.spatialFoleyStemPath!)).toBe(true);
      expect(existsSync(pipelineRes.artifacts.qcReportPath!)).toBe(true);
    });
  });

  // ── 6. Studio API REST Endpoints ──
  describe("Studio API Integration", () => {
    let api: StudioApi;

    beforeEach(() => {
      api = new StudioApi(":memory:", false);
    });

    afterEach(async () => {
      await api.close();
    });

    it("serves cinematic post presets list via GET /api/v1/series/:id/cinematic-post/presets", async () => {
      let responseData: any = null;
      let statusCode = 0;

      const req: any = {
        method: "GET",
        headers: { host: "127.0.0.1:3456" },
      };
      const res: any = {
        writeHead(status: number) {
          statusCode = status;
        },
        end(payload: string) {
          responseData = JSON.parse(payload);
        },
      };

      const url = new URL("http://127.0.0.1:3456/api/v1/series/series_test/cinematic-post/presets");
      const handled = await api.handle(req, res, url);

      expect(handled).toBe(true);
      expect(statusCode).toBe(200);
      expect(responseData.success).toBe(true);
      expect(responseData.presets.length).toBeGreaterThan(4);
      expect(responseData.resolutionStandards).toBeDefined();
      expect(responseData.deliveryStandards).toBeDefined();
    });

    it("evaluates real-time color swatches via POST /api/v1/series/:id/cinematic-post/lut-preview", async () => {
      let responseData: any = null;
      let statusCode = 0;

      const bodyData = JSON.stringify({
        preset: "teal_orange",
      });

      const req: any = Object.assign(Readable.from([Buffer.from(bodyData)]), {
        method: "POST",
        headers: { host: "127.0.0.1:3456", "content-type": "application/json" },
      });
      const res: any = {
        writeHead(status: number) {
          statusCode = status;
        },
        end(payload: string) {
          responseData = JSON.parse(payload);
        },
      };

      const url = new URL("http://127.0.0.1:3456/api/v1/series/series_test/cinematic-post/lut-preview");
      const handled = await api.handle(req, res, url);

      expect(handled).toBe(true);
      expect(statusCode).toBe(200);
      expect(responseData.success).toBe(true);
      expect(responseData.preview.length).toBeGreaterThan(3);
      expect(responseData.preview[0].transformedRgb).toBeDefined();
    });

    it("queues cinematic post and returns a durable job ID", async () => {
      const seriesId="post-api-"+randomUUID(),root=resolve("data","series",seriesId);
      const bible=new SqliteStoryStore(join(root,"story_bible.db"));
      const fixture=join(root,"input.mp4");
      await createValidMockMp4File(fixture,1,64,64);
      await new ArtifactStore(bible).register(fixture,{seriesId,episodeNumber:1,kind:"master",mode:"mock",approved:true});bible.close();
      let responseData: any = null;
      let statusCode = 0;

      const bodyData = JSON.stringify({
        episodeNumber: 1,
        resolutionStandard: "4k",
        filmGrainIntensity: 0.15,
        cdlPreset: "fuji_eterna",
        enableSpatialFoley: true,
        enableBroadcastConformance: true,
        mockFallback: true,
      });

      const req: any = Object.assign(Readable.from([Buffer.from(bodyData)]), {
        method: "POST",
        headers: { host: "127.0.0.1:3456", "content-type": "application/json" },
      });
      const res: any = {
        writeHead(status: number) {
          statusCode = status;
        },
        end(payload: string) {
          responseData = JSON.parse(payload);
        },
      };

      const url = new URL(`http://127.0.0.1:3456/api/v1/series/${seriesId}/cinematic-post/process`);
      const handled = await api.handle(req, res, url);

      expect(handled).toBe(true);
      expect(statusCode).toBe(202);
      expect(responseData.jobId).toBeTruthy();
      rmSync(root,{recursive:true,force:true});
    });
  });
});
