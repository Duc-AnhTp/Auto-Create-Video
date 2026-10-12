import { WorkflowError } from "../workflow-error.js";
import { existsSync,realpathSync } from "node:fs";
import { join, resolve, relative, isAbsolute,dirname } from "node:path";
import { containedPath } from "./containment.js";
import { HttpError } from "../errors.js";

export class ProjectPaths {
  constructor(readonly workspace = resolve(".")) {}
  roots(seriesId:string, references=false):string[] {
    if(!/^[a-zA-Z0-9_-]{1,100}$/.test(seriesId))throw new HttpError(400,"INVALID_SERIES");
    return [join(this.workspace,"data","series",seriesId),join(this.workspace,"output","series",seriesId),...(seriesId==="series"?[]:[join(this.workspace,"output",seriesId)]),
      ...(references?[join(this.workspace,"assets","characters",seriesId),join(this.workspace,"assets","locations",seriesId)]:[])];
  }
  check(seriesId:string,path:string,references=false):string {
    if(path.split(/[\\/]/).includes(".."))throw new HttpError(403,"PATH_FORBIDDEN");
    const target=resolve(path);
    for(let ancestor=target;ancestor!==dirname(ancestor);ancestor=dirname(ancestor)){
      if(existsSync(ancestor)&&relative(resolve(ancestor),realpathSync(ancestor))!=="")throw new HttpError(403,"PATH_FORBIDDEN");
      if(ancestor===this.workspace)break;
    }
    for(const root of this.roots(seriesId,references)) {
      const rel=relative(root,target);
      if(isAbsolute(rel)||rel===".."||rel.startsWith("../")||rel.startsWith("..\\"))continue;
      containedPath(this.workspace,root);
      return containedPath(existsSync(root)?root:this.workspace,target);
    }
    throw new HttpError(403,"PATH_FORBIDDEN");
  }
  postprocessOutput(seriesId:string,episode:number,jobId:string):string {
    if(!/^[a-zA-Z0-9_-]+$/.test(jobId))throw new WorkflowError("INVALID_JOB_ID", "INVALID_JOB_ID", "failed");
    return this.check(seriesId,join(this.roots(seriesId)[1],`ep-${String(episode).padStart(2,"0")}`,"postprocess",jobId));
  }
  episodeOutput(seriesId: string, episode: number): string {
    if (!Number.isInteger(episode) || episode <= 0) throw new HttpError(400, "INVALID_EPISODE");
    return this.check(seriesId, join(this.roots(seriesId)[1], `ep-${String(episode).padStart(2, "0")}`));
  }
  episodeTimeline(seriesId: string, episode: number): string | undefined {
    const directory = this.episodeOutput(seriesId, episode);
    for (const parts of [["timeline.json"], ["assembly", "timeline.json"], ["artifacts", "unified_timeline.json"], ["artifacts", "timeline.json"], ["unified_timeline.json"]]) {
      const file = this.check(seriesId, join(directory, ...parts));
      if (existsSync(file)) return file;
    }
    return undefined;
  }
  inferSeries(path:string):string {
    const rel=relative(this.workspace,resolve(path)).replace(/\\/g,"/");
    const match=rel.match(/^(?:data\/series\/|output\/series\/|assets\/(?:characters|locations)\/)([a-zA-Z0-9_-]+)\//)??rel.match(/^output\/([a-zA-Z0-9_-]+)\//);
    if(!match)throw new HttpError(403,"PATH_FORBIDDEN");return match[1];
  }
}
