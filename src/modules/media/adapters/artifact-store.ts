import { WorkflowError } from "../../../platform/workflow-error.js";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { ArtifactStoreStore } from "../ports/artifact-store-store.js";
import type { ProductionArtifact, Provenance, ReferenceProvenance } from "../../../contracts/production.js";
import { probeVideoFile } from "./media-validator.js";
import { runFfprobe } from "./ffmpeg.js";
import { assertMediaOwnership,publishMedia } from "../../../platform/processes/media-process-runner.js";
import { ProjectPaths } from "../../../platform/filesystem/project-paths.js";
import { countRuntime } from "../../../platform/observability/runtime-metrics.js";

export async function hashFile(path:string):Promise<string> {
  countRuntime("hash");const hash=createHash("sha256");for await(const chunk of createReadStream(path)){hash.update(chunk);countRuntime("hashBytes",chunk.length);}return hash.digest("hex");
}
export function hashEmbedding(embedding:number[]):string {return createHash("sha256").update(JSON.stringify(embedding)).digest("hex");}
export async function validateReference(path:string,mode:Provenance):Promise<void> {
  const info=await stat(path);if(!info.isFile()||info.size===0)throw new WorkflowError("REFERENCE_IMAGE_INVALID", "REFERENCE_IMAGE_INVALID", "failed");
  if(mode!=="mock") {
    const probe=JSON.parse(await runFfprobe(["-v","error","-show_entries","stream=width,height","-of","json",path]));
    if(!probe.streams?.some((s:{width:number;height:number})=>s.width>0&&s.height>0))throw new WorkflowError("REFERENCE_IMAGE_INVALID", "REFERENCE_IMAGE_INVALID", "failed");
  }
}
export async function recordReference(bible:ArtifactStoreStore,reference:Omit<ReferenceProvenance,"sha256">):Promise<void> {
  const path=resolve(reference.path);await validateReference(path,reference.mode);
  bible.putReference({...reference,path,sha256:await hashFile(path)});
}
export async function readReference(bible:ArtifactStoreStore,path:string,allowMock:boolean):Promise<ReferenceProvenance|null> {
  const reference=bible.getReference(resolve(path));
  if(!reference || !allowMock&&reference.mode!=="production")return null;
  try {await validateReference(path,reference.mode);return await hashFile(path)===reference.sha256?reference:null;}catch{return null;}
}
export class ArtifactStore {
  constructor(private bible:ArtifactStoreStore,private paths=new ProjectPaths()){}
  async register(path:string,options:{seriesId:string;episodeNumber:number;kind:ProductionArtifact["kind"];mode:Provenance;approved?:boolean;source?:string}):Promise<ProductionArtifact> {
    path=this.paths.check(options.seriesId,path,options.kind==="image");
    const info=await stat(path);if(!info.isFile()||info.size===0)throw new WorkflowError("INPUT_MEDIA_REQUIRED", "INPUT_MEDIA_REQUIRED", "failed");
    let probe:Record<string,unknown>|undefined;
    if(["master","delivery","shot"].includes(options.kind)) {const result=await probeVideoFile(path);if(!result.isValid)throw new WorkflowError("INPUT_MEDIA_INVALID", "INPUT_MEDIA_INVALID", "failed");probe={...result};}
    const sha256=await hashFile(path);assertMediaOwnership();
    let artifact:ProductionArtifact|undefined;publishMedia(()=>{artifact=this.bible.putArtifact({id:randomUUID(),...options,path,sha256,sizeBytes:info.size,ready:true,approved:options.approved??false,probe,createdAt:new Date().toISOString()});});return artifact!;
  }
  async resolve(id:string,seriesId:string,episode:number):Promise<ProductionArtifact> {
    const artifact=this.bible.getArtifact(id);
    if(!artifact||artifact.seriesId!==seriesId||artifact.episodeNumber!==episode)throw new WorkflowError("ARTIFACT_NOT_FOUND", "ARTIFACT_NOT_FOUND", "failed");
    this.paths.check(seriesId,artifact.path,artifact.kind==="image");
    if(!artifact.ready||!artifact.approved||artifact.mode==="unknown"||await hashFile(artifact.path)!==artifact.sha256)throw new WorkflowError("ARTIFACT_REVIEW_REQUIRED", "ARTIFACT_REVIEW_REQUIRED", "needs_review");
    if(["master","delivery","shot"].includes(artifact.kind)&&!(await probeVideoFile(artifact.path)).isValid)throw new WorkflowError("INPUT_MEDIA_INVALID", "INPUT_MEDIA_INVALID", "failed");
    return artifact;
  }
  latestMaster(seriesId:string,episode:number):ProductionArtifact|null {
    return this.bible.listArtifacts(seriesId,episode).find(a=>["master","delivery"].includes(a.kind)&&a.ready&&a.approved&&a.mode!=="unknown")??null;
  }
}
