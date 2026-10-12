import {log} from '../../../../platform/observability/logger.js';
import type {DatabaseSync} from 'node:sqlite';
import type {ProviderJobRecord} from '../../../../contracts/story.js';
interface MigrationRepositorySession {db:DatabaseSync|null;store:{listProviderJobs(seriesId?: string, episodeNumber?: number): ProviderJobRecord[];
createOrUpdateProviderJob(job: ProviderJobRecord): void;}}
import { resolve } from "node:path";
import { ProductionRepository } from "./production-repository.js";

/** Called inside the Bible migration transaction; legacy evidence stays unknown. */
export function backfillProductionData(ctx:MigrationRepositorySession,versions:Set<number>):void {
  if (!ctx.db) return;
  const repository=new ProductionRepository(ctx.db);
  if(!versions.has(10)) {
    const references=ctx.db.prepare(`SELECT image_path AS path,series_id,entity_id FROM reference_assets
      UNION SELECT face_reference_image,series_id,id FROM characters WHERE face_reference_image IS NOT NULL
      UNION SELECT reference_image_path,series_id,id FROM locations WHERE reference_image_path IS NOT NULL`).all() as {path:string;series_id:string;entity_id:string}[];
    for(const row of references)if(row.path&&!repository.getReference(resolve(row.path)))repository.putReference({path:resolve(row.path),seriesId:row.series_id || (ctx.db.prepare("SELECT id FROM series_metadata LIMIT 1").get() as {id:string}|undefined)?.id || "legacy-unassigned",entityId:row.entity_id,provider:"unknown",mode:"unknown",sha256:"",embeddingSource:"unknown",source:"legacy migration: source evidence required"});
  }
  if(!versions.has(11)) {
    const jobs=ctx.store.listProviderJobs();
    for(const job of jobs) {
      let metadata:Record<string,unknown>={};try{metadata=JSON.parse(job.metadata_json??"{}");}catch (caughtError) { log.warn("[backfill] "+String(caughtError)); }
      if(metadata.attempt_group_id)continue;
      const id="legacy_"+job.id;
      repository.putGroup({id,seriesId:job.series_id,episodeNumber:job.episode_number,shotId:job.shot_id,specHash:job.spec_hash,primaryId:job.id,hedgeDueAt:Date.parse(job.created_at??"")||0,status:job.status==="completed"?"completed":job.status==="failed"?"failed":"needs_review",reason:"LEGACY_ATTEMPT",spec:(metadata.execution_spec??{}) as Record<string,unknown>,destinationPath:job.output_local_path,createdAt:job.created_at??new Date().toISOString()});
      ctx.store.createOrUpdateProviderJob({...job,metadata_json:JSON.stringify({...metadata,attempt_group_id:id,attempt_role:"primary"})});
    }
  }
}
