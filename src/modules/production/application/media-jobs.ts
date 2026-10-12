import type { MediaFactories } from "../../media/index.js";
import { WorkflowError } from "../../../platform/workflow-error.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ArtifactStoreStore } from "../../media/index.js";
import { ProjectPaths } from "../../../platform/filesystem/project-paths.js";

import { PostprocessRequestSchema,PostprocessOptionsSchema,type ProductionRequest } from "../../../contracts/requests.js";
import type { JobStore } from "../adapters/sqlite/job-store.js";
import { z } from "zod";

export const LegacyPostprocessSchema=PostprocessOptionsSchema.extend({episodeNumber:z.number().int().positive(),inputMasterVideoPath:z.string().optional(),outputDir:z.string().optional(),mockFallback:z.boolean().optional()}).strict();
export class EnqueueMediaJob {
  constructor(private queue:Pick<JobStore,"enqueue"|"invalidateCompleted">,private openStore:(path:string)=>ArtifactStoreStore & {close():void;findArtifact(path:string):import("../../../contracts/production.js").ProductionArtifact|null},private media:Pick<MediaFactories,"createArtifactStore">,private paths=new ProjectPaths()){}
  private async withArtifacts<T>(seriesId:string,fn:(store:ReturnType<MediaFactories["createArtifactStore"]>)=>Promise<T>):Promise<T>{
    const path=this.paths.check(seriesId,resolve("data","series",seriesId,"story_bible.db"));
    if(!existsSync(path))throw new WorkflowError("SERIES_NOT_FOUND","SERIES_NOT_FOUND");const bible=this.openStore(path);
    try{return await fn(this.media.createArtifactStore(bible,this.paths));}finally{bible.close();}
  }
  async enqueue(input:Extract<ProductionRequest,{kind:"postprocess"}>){
    return this.withArtifacts(input.seriesId,async artifacts=>{
      const artifact=await artifacts.resolve(input.inputArtifactId,input.seriesId,input.episodeNumber);
      if(!["master","delivery"].includes(artifact.kind))throw new WorkflowError("MASTER_ARTIFACT_REQUIRED","MASTER_ARTIFACT_REQUIRED");
      if(artifact.mode==="production"&&input.options.enableSpatialFoley)throw new WorkflowError("SPATIAL_FOLEY_DELIVERY_UNAVAILABLE","SPATIAL_FOLEY_DELIVERY_UNAVAILABLE");
      const job=this.queue.enqueue({...input,mode:artifact.mode,inputSha256:artifact.sha256});
      if(job.status==="succeeded"){
        try{if(!job.result?.artifactIds?.length)throw new WorkflowError("DELIVERY_ARTIFACT_REQUIRED", "DELIVERY_ARTIFACT_REQUIRED", "failed");for(const id of job.result.artifactIds)await artifacts.resolve(id,input.seriesId,input.episodeNumber);}
        catch{return this.queue.invalidateCompleted(job.id);}
      }
      return job;
    });
  }
  async enqueueLegacy(seriesId:string,raw:unknown){
    const body=LegacyPostprocessSchema.parse(raw);
    if(body.inputMasterVideoPath)this.paths.check(seriesId,body.inputMasterVideoPath);
    if(body.outputDir)this.paths.check(seriesId,body.outputDir);
    const inputArtifactId=await this.withArtifacts(seriesId,async artifacts=>{
      const artifact=body.inputMasterVideoPath?artifacts.latestMaster(seriesId,body.episodeNumber):artifacts.latestMaster(seriesId,body.episodeNumber);
      // An explicit legacy path must resolve to the registered artifact rather than another episode's master.
      const bible=this.openStore(resolve("data","series",seriesId,"story_bible.db"));
      try {const selected=body.inputMasterVideoPath?bible.findArtifact(resolve(body.inputMasterVideoPath)):artifact;
        if(!selected)throw new WorkflowError("INPUT_MEDIA_REQUIRED","INPUT_MEDIA_REQUIRED");
        if(body.mockFallback!==undefined&&body.mockFallback!==(selected.mode==="mock"))throw new WorkflowError("MEDIA_MODE_MISMATCH","MEDIA_MODE_MISMATCH");return selected.id;
      }finally{bible.close();}
    });
    const {episodeNumber,inputMasterVideoPath,outputDir,mockFallback,...options}=body;
    return this.enqueue(PostprocessRequestSchema.parse({kind:"postprocess",seriesId,episodeNumber,inputArtifactId,options}));
  }
}
