import type {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";
import type {SeriesOperationCoordinator} from "../../ports/series-operation-coordinator.js";
import {HttpError} from "../../../../platform/errors.js";

export class SqliteSeriesOperationCoordinator implements SeriesOperationCoordinator {
 constructor(private db:DatabaseSync){}
 recoverAbandoned():void {
  const dead=(pid:number)=>{try{process.kill(pid,0);return false;}catch(error){return (error as NodeJS.ErrnoException).code==='ESRCH';}};
  this.transaction(()=>{
   for(const row of this.db.prepare('SELECT id,pid FROM series_sessions').all())if(dead(Number(row.pid)))this.db.prepare('DELETE FROM series_sessions WHERE id=?').run(row.id);
   for(const row of this.db.prepare('SELECT series_id,pid FROM series_maintenance').all())if(dead(Number(row.pid))&&!this.db.prepare('SELECT id FROM series_sessions WHERE series_id=? LIMIT 1').get(row.series_id))this.db.prepare('DELETE FROM series_maintenance WHERE series_id=?').run(row.series_id);
  });
 }
 private transaction<T>(fn:()=>T):T {this.db.exec("BEGIN IMMEDIATE");try{const value=fn();this.db.exec("COMMIT");return value;}catch(error){this.db.exec("ROLLBACK");throw error;}}
 isUnderMaintenance(seriesId:string):boolean{return Boolean(this.db.prepare("SELECT token FROM series_maintenance WHERE series_id=?").get(seriesId));}
 enter(seriesId:string,maintenanceToken?:string):()=>void {
  const id=randomUUID();this.transaction(()=>{const lock=this.db.prepare("SELECT token FROM series_maintenance WHERE series_id=?").get(seriesId);if(lock&&lock.token!==maintenanceToken)throw new HttpError(409,"PROJECT_BUSY");this.db.prepare("INSERT INTO series_sessions VALUES(?,?,?,?)").run(id,seriesId,process.pid,Date.now());});
  let closed=false;return()=>{if(closed)return;this.db.prepare("DELETE FROM series_sessions WHERE id=?").run(id);closed=true;};
 }
 beginMaintenance(seriesId:string):{token:string;release():void} {
  const token=randomUUID();this.transaction(()=>{
   if(this.isUnderMaintenance(seriesId)||this.db.prepare("SELECT id FROM series_sessions WHERE series_id=? LIMIT 1").get(seriesId)||this.db.prepare("SELECT id FROM studio_jobs WHERE series_id=? AND status IN ('queued','running','paused','needs_review') LIMIT 1").get(seriesId)||this.db.prepare("SELECT id FROM studio_story_imports WHERE series_id=? AND status IN ('queued','running') LIMIT 1").get(seriesId))throw new HttpError(409,"PROJECT_BUSY");
   if(this.db.prepare("SELECT id FROM provider_dispatches WHERE series_id=? AND state IN ('reserved','submitting','submitted','running','uncertain') LIMIT 1").get(seriesId))throw new HttpError(409,"REMOTE_ATTEMPTS_ACTIVE");
   if(this.db.prepare("SELECT id FROM tts_attempts WHERE (json_extract(payload,'$.seriesId')=? OR json_extract(payload,'$.seriesId') IS NULL) AND state!='completed' LIMIT 1").get(seriesId))throw new HttpError(409,"REMOTE_ATTEMPTS_ACTIVE");
   this.db.prepare("INSERT INTO series_maintenance VALUES(?,?,?,?)").run(seriesId,token,process.pid,Date.now());
  });
  let closed=false;return {token,release:()=>{if(closed)return;this.db.prepare("DELETE FROM series_maintenance WHERE series_id=? AND token=?").run(seriesId,token);closed=true;}};
 }
}
