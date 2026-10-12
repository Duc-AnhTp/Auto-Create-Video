import { WorkflowError } from "../../../platform/workflow-error.js";
import { atomicWriteFile as writeFile } from "../../../platform/filesystem/atomic-publication.js";
import { readFile,mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { hashFile } from "./artifact-store.js";
import { probeVideoFile,probeAudioFile } from "./media-validator.js";
import { countRuntime } from "../../../platform/observability/runtime-metrics.js";
import { assertMediaOwnership } from "../../../platform/processes/media-process-runner.js";

export const RENDERER_VERSION="media-v4-fenced-cache";
export function renderFingerprint(value:unknown):string{return createHash("sha256").update(JSON.stringify({renderer:RENDERER_VERSION,value})).digest("hex");}
type CachedFile={path:string;sha256:string;kind:"video"|"audio"};
export class MediaArtifactCache {
  hits=0;misses=0;
  constructor(private manifestPath:string){}
  async hit(fingerprint:string):Promise<boolean>{
    if(process.env.MEDIA_RENDER_CACHE==="0"){this.misses++;return false;}
    try{const manifest=JSON.parse(await readFile(this.manifestPath,"utf8")) as {fingerprint:string;files:CachedFile[]};
      if(manifest.fingerprint!==fingerprint||!manifest.files?.length){this.misses++;return false;}
      for(const file of manifest.files){if(await hashFile(file.path)!==file.sha256||!(await(file.kind==="video"?probeVideoFile(file.path):probeAudioFile(file.path))).isValid){this.misses++;return false;}}
      this.hits++;countRuntime("cacheHit");return true;
    }catch{this.misses++;return false;}
  }
  async record(fingerprint: string, files: Array<{ path: string; kind: "video" | "audio"; sha256?: string }>): Promise<void> {
    const values: CachedFile[] = [];
    for (const file of files) {
      if (!(await (file.kind === "video" ? probeVideoFile(file.path) : probeAudioFile(file.path))).isValid) {
        throw new WorkflowError("CACHE_MEDIA_INVALID", "CACHE_MEDIA_INVALID", "failed");
      }
      const sha256 = (file.sha256 && /^[a-f0-9]{64}$/i.test(file.sha256))
        ? file.sha256
        : await hashFile(file.path);
      values.push({ path: file.path, kind: file.kind, sha256 });
    }
    await mkdir(dirname(this.manifestPath), { recursive: true });
    assertMediaOwnership();
    await writeFile(this.manifestPath, JSON.stringify({ fingerprint, files: values }), "utf8");
  }
}
