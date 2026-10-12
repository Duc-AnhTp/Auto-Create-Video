import { afterEach,beforeEach,describe,expect,it } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join,resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { ProjectPaths } from "../../platform/filesystem/project-paths.js";
import { JobStore } from "../../modules/production/adapters/sqlite/job-store.js";
import { SqliteStoryStore } from "../../bootstrap/sqlite-story-store.js";
import { ProviderDispatchStore } from "../../modules/production/adapters/sqlite/provider-dispatch-store.js";
import { ArtifactStore,hashFile,recordReference,readReference,hashEmbedding } from "../../modules/media/adapters/artifact-store.js";
import { renderFingerprint } from "../../modules/media/adapters/artifact-cache.js";
import { withMediaContext } from "../../platform/processes/media-process-runner.js";
import { createValidMockMp4File } from "../../modules/media/adapters/assets/mock-media-generator.js";
import { executeProductionJob } from "../../bootstrap/job-executor.js";
import { resolveDemoPolicy,resolveExecutionPolicy } from "../../modules/production/domain/execution-policy.js";
import { CharacterTurnaroundBridge } from "../../modules/production/application/character-turnaround-bridge.js";
import { runFfmpeg } from "../../modules/media/adapters/ffmpeg.js";
import { MediaJobService } from "../../bootstrap/media-jobs.js";
import { PostprocessRequestSchema } from "../../contracts/requests.js";

describe("production boundaries F02/F04/F05/F08",()=>{
  let temporary:string;
  beforeEach(async()=>{temporary=await mkdtemp(join(tmpdir(),"production-boundaries-"));});
  afterEach(async()=>{await rm(temporary,{recursive:true,force:true});});
  it("resolves mock before provider and rejects production intent in the demo",()=>{
    expect(resolveExecutionPolicy("mock","api_kling").provider).toBe("mock");
    expect(()=>resolveDemoPolicy({mockVideo:false})).toThrow();expect(()=>resolveDemoPolicy({provider:"api_runway"})).toThrow();
  });
  it("rejects traversal, outside paths, cross-series and junction ancestors before writing",async()=>{
    const paths=new ProjectPaths(temporary),root=join(temporary,"output","series","s");await mkdir(root,{recursive:true});const outside=join(temporary,"output","series","other");await mkdir(outside,{recursive:true});
    for(const path of [join(outside,"file.mp4"),join(temporary,"outside.mp4"),root+"/../other/file.mp4"])expect(()=>paths.check("s",path)).toThrow("PATH_FORBIDDEN");
    expect(()=>paths.check("series",join(temporary,"output","series","other","file.mp4"))).toThrow("PATH_FORBIDDEN");
    const link=join(root,"alias");await symlink(outside,link,process.platform==="win32"?"junction":"dir");expect(()=>paths.check("s",join(link,"new","file.mp4"))).toThrow("PATH_FORBIDDEN");expect(existsSync(join(outside,"new"))).toBe(false);
    const parentAlias=join(temporary,"data");await symlink(join(temporary,"output"),parentAlias,process.platform==="win32"?"junction":"dir");expect(()=>paths.check("s",join(parentAlias,"series","s","not-created.mp4"))).toThrow("PATH_FORBIDDEN");
  });
  it("a stale queue owner cannot heartbeat, checkpoint or publish after reclaim",async()=>{
    const path=join(temporary,"queue.db"),first=new JobStore(path),second=new JobStore(path);
    try{const job=first.enqueue({seriesId:"s",rawScreenplay:"TẬP 1: Offline"});const old=first.claim("first")!;
      const db=new DatabaseSync(path);db.prepare("UPDATE studio_jobs SET lease_until=0 WHERE id=?").run(job.id);db.close();const fresh=second.claim("second")!;
      expect(fresh.leaseVersion).toBeGreaterThan(old.leaseVersion!);expect(first.heartbeat(job.id,"first",old.leaseVersion)).toBe(false);expect(()=>first.update(job.id,"first",{progress:{step:1,total:1,message:"stale"}},undefined,old.leaseVersion)).toThrow("WORKER_LEASE_LOST");
      const candidate=join(temporary,"candidate.mp4");await createValidMockMp4File(candidate,1,64,64);
      await expect(withMediaContext({assertOwnership:()=>{if(!first.isOwner(job.id,"first",old.leaseVersion))throw new Error("WORKER_LEASE_LOST");}},()=>runFfmpeg(["-y","-i",candidate,"-c","copy",join(temporary,"published.mp4")]))).rejects.toThrow("WORKER_LEASE_LOST");expect(existsSync(join(temporary,"published.mp4"))).toBe(false);
    }finally{first.close();second.close();}
  });
  it("real reference images with synthetic embeddings do not enable face consistency",async()=>{
    const bible=new SqliteStoryStore(join(temporary,"bible.db")),image=join(temporary,"real.png");
    try{await runFfmpeg(["-y","-f","lavfi","-i","color=c=red:s=64x64","-frames:v","1",image]);bible.upsertSeriesMetadata({id:"s",title:"Offline"});const vector=Array(512).fill(0.1);bible.upsertCharacter({id:"c",series_id:"s",name:"Character",face_reference_image:image,face_embedding_json:JSON.stringify(vector)});
      await recordReference(bible,{path:image,seriesId:"s",entityId:"c",provider:"fixture",mode:"production",embeddingSource:"synthetic",embeddingHash:hashEmbedding(vector)});
      const spec=await CharacterTurnaroundBridge.bindTurnaroundToSpec({shotId:"shot",backend:"api_kling",characterId:"c",durationSec:1,prompt:"fixture"},bible,"s",{allowMock:false,autoGenerate:false});expect(spec.characterReferenceImage).toBe(image);expect(spec.applyFaceConsistency).toBe(false);expect(spec.faceEmbedding).toBeUndefined();
      await writeFile(image,"corrupt");expect(await readReference(bible,image,false)).toBeNull();
    }finally{bible.close();}
  });
  it("postprocess resume preserves needs_review and rejects a missing delivery manifest",async()=>{
    const seriesId="post-resume-"+randomUUID(),data=resolve("data","series",seriesId),outputs=resolve("output","series",seriesId);await mkdir(data,{recursive:true});const bible=new SqliteStoryStore(join(data,"story_bible.db")),dispatch=new ProviderDispatchStore(join(temporary,"queue.db"));
    try{const inputPath=join(data,"input.mp4");await createValidMockMp4File(inputPath,1,64,64);const input=await new ArtifactStore(bible).register(inputPath,{seriesId,episodeNumber:1,kind:"master",mode:"production",approved:true,source:"offline media fixture"});const id=randomUUID(),complete=join(new ProjectPaths().postprocessOutput(seriesId,1,id),"complete");await mkdir(complete,{recursive:true});const candidate=join(complete,"master_delivery.mp4");await copyFile(inputPath,candidate);const options={enableSpatialFoley:false};
      await writeFile(join(complete,"delivery-manifest.json"),JSON.stringify({fingerprint:renderFingerprint({input:input.sha256,mode:input.mode,options}),sha256:await hashFile(candidate),ready:false,qaStatus:"NEEDS_REVIEW",postprocess:{status:"WARN"}}));
      const queue=new JobStore(":memory:");const job=queue.enqueue({kind:"postprocess",seriesId,episodeNumber:1,inputArtifactId:input.id,inputSha256:input.sha256,mode:"production",options});queue.close();job.id=id;
      const context={checkpoint:async()=>undefined,assertOwnership:()=>undefined,signal:new AbortController().signal,progress:()=>undefined};const result=await executeProductionJob(job,context,{dispatchStore:dispatch});expect(result.ready).toBe(false);expect(result.result.qaStatus).toBe("NEEDS_REVIEW");
      await rm(join(complete,"delivery-manifest.json"));await expect(executeProductionJob(job,context,{dispatchStore:dispatch})).rejects.toThrow("DELIVERY_REVIEW_REQUIRED");
    }finally{bible.close();dispatch.close();await rm(data,{recursive:true,force:true});await rm(outputs,{recursive:true,force:true});}
  });
  it("completed postprocess dedup validates delivery before returning success",async()=>{
    const seriesId="post-dedup-"+randomUUID(),data=resolve("data","series",seriesId);await mkdir(data,{recursive:true});
    const bible=new SqliteStoryStore(join(data,"story_bible.db")),queue=new JobStore(join(temporary,"queue.db"));
    try{
      const inputPath=join(data,"input.mp4"),deliveryPath=join(data,"delivery.mp4");await createValidMockMp4File(inputPath,1,64,64);await copyFile(inputPath,deliveryPath);
      const artifacts=new ArtifactStore(bible),input=await artifacts.register(inputPath,{seriesId,episodeNumber:1,kind:"master",mode:"mock",approved:true}),delivery=await artifacts.register(deliveryPath,{seriesId,episodeNumber:1,kind:"delivery",mode:"mock",approved:true});
      const service=new MediaJobService(queue),request=PostprocessRequestSchema.parse({kind:"postprocess",seriesId,episodeNumber:1,inputArtifactId:input.id,options:{enableSpatialFoley:false}});
      const job=await service.enqueue(request);queue.claim("worker");queue.update(job.id,"worker",{result:{videoPath:deliveryPath,audioPath:"",outputDir:data,isMock:true,artifactIds:[delivery.id]}},"succeeded");
      expect((await service.enqueue(request)).status).toBe("succeeded");await writeFile(deliveryPath,"corrupt");
      const invalid=await service.enqueue(request);expect(invalid.id).toBe(job.id);expect(invalid.status).toBe("needs_review");expect(invalid.error?.code).toBe("DELIVERY_REVIEW_REQUIRED");
    }finally{bible.close();queue.close();await rm(data,{recursive:true,force:true});}
  });
});
