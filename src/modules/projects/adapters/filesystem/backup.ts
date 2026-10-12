import {log} from '../../../../platform/observability/logger.js';
import { WorkflowError } from "../../../../platform/workflow-error.js";
import { createHash,randomUUID } from "node:crypto";
import { createReadStream,existsSync } from "node:fs";
import { cp,mkdir,readdir,readFile,rename,stat,writeFile,rm } from "node:fs/promises";
import { join,resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { containedPath } from "../../../../platform/filesystem/containment.js";
import { ProjectPaths } from "../../../../platform/filesystem/project-paths.js";
import { SeriesId } from "../../../../contracts/requests.js";

interface Snapshot { version: 1|2; id: string; seriesId: string; createdAt: string; files: { path: string; sha256: string }[]; }
interface RestoreMove {live:string;staged:string;previous:string;hadPrevious:boolean;installed:boolean}
interface RestoreJournal {version:1;seriesId:string;pid:number;state:'installing'|'committed';moves:RestoreMove[]}
async function saveJournal(path:string,value:RestoreJournal){const tmp=path+'.tmp';await writeFile(tmp,JSON.stringify(value));await rename(tmp,path);}
export async function recoverProjectRestores(root=process.cwd()):Promise<string[]> {
  const folder=resolve(root,'data/maintenance');if(!existsSync(folder))return [];
  const recovered:string[]=[];
  for(const item of await readdir(folder,{withFileTypes:true})){
    if(!item.isFile()||!item.name.endsWith('.restore.json'))continue;
    const path=containedPath(root,join(folder,item.name)),journal=JSON.parse(await readFile(path,'utf8')) as RestoreJournal;
    SeriesId.parse(journal.seriesId);if(journal.version!==1||!Array.isArray(journal.moves))throw new Error('RESTORE_JOURNAL_INVALID');
    if(!Number.isInteger(journal.pid)||journal.pid<=0)throw new Error('RESTORE_JOURNAL_INVALID');
    try{process.kill(journal.pid,0);continue;}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')continue;}
    const allowed=new Set(projectParts(journal.seriesId,root,2).map(part=>resolve(part.live)));
    for(const move of journal.moves){
      containedPath(root,move.live);containedPath(root,move.staged);containedPath(root,move.previous);
      if(!allowed.has(resolve(move.live))||!move.staged.startsWith(move.live+'.restore-')||!move.previous.startsWith(move.live+'.before-restore-')||!/^[a-f0-9-]{36}$/.test(move.staged.slice((move.live+'.restore-').length))||move.staged.slice((move.live+'.restore-').length)!==move.previous.slice((move.live+'.before-restore-').length))throw new Error('RESTORE_JOURNAL_INVALID');
    }
    if(journal.state!=='committed')for(const move of [...journal.moves].reverse()){
      // The rename may have succeeded immediately before the journal write was interrupted.
      if(existsSync(move.previous)){
        if(existsSync(move.live)){if(existsSync(move.staged))await rm(move.staged,{recursive:true,force:true});await rename(move.live,move.staged);}
        await rename(move.previous,move.live);
      }else if(!move.hadPrevious&&existsSync(move.live)&&!existsSync(move.staged))await rename(move.live,move.staged);
    }
    await rm(path);recovered.push(journal.seriesId);
  }
  return recovered;
}
function projectParts(seriesId:string,root:string,version:1|2){return [["data","data/series"],["output","output/series"],...(version===2?[["characters","assets/characters"],["locations","assets/locations"],...(seriesId==="series"?[]:[["legacy-output","output"]])]:[])].map(([part,base])=>({part,live:new ProjectPaths(root).check(seriesId,resolve(root,base,seriesId),true)}));}
async function digest(path:string) { const hash=createHash("sha256"); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest("hex"); }
async function assertNoSymlinks(dir: string): Promise<void> {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw new WorkflowError("BACKUP_SYMLINK_UNSUPPORTED", "BACKUP_SYMLINK_UNSUPPORTED", "failed");
    if (item.isDirectory()) await assertNoSymlinks(join(dir, item.name));
  }
}
async function inventory(dir: string, prefix = ""): Promise<Snapshot["files"]> {
  const files: Snapshot["files"] = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw new WorkflowError("BACKUP_SYMLINK_UNSUPPORTED", "BACKUP_SYMLINK_UNSUPPORTED", "failed");
    const path = join(prefix, item.name);
    if (item.isDirectory()) files.push(...await inventory(join(dir,item.name),path));
    else files.push({ path, sha256: await digest(join(dir,item.name)) });
  }
  return files;
}
/** Call only while the series has no queued/running/paused/review jobs. */
export async function backupProject(seriesId: string, root = process.cwd()) {
  SeriesId.parse(seriesId);
  const data = containedPath(root, resolve(root,"data/series",seriesId));
  const output = containedPath(root, resolve(root,"output/series",seriesId));
  if (!existsSync(join(data,"story_bible.db"))) throw new WorkflowError("PROJECT_NOT_FOUND", "PROJECT_NOT_FOUND", "failed");
  const parts=projectParts(seriesId,root,2);
  // Enumerate every registered root before copying, verifying no unsupported symlinks exist.
  for(const {live} of parts)if(existsSync(live))await assertNoSymlinks(live);
  const id = randomUUID(), destination = resolve(root,"data/backups",seriesId,id);
  await mkdir(join(destination,"data"),{recursive:true});
  await cp(data,join(destination,"data"),{recursive:true,filter: source=>!/[\\/]story_bible\.db(?:-wal|-shm)?$/.test(source)});
  const db = new DatabaseSync(join(data,"story_bible.db"));
  try { db.exec("VACUUM INTO '"+join(destination,"data/story_bible.db").replace(/'/g,"''")+"'"); } finally { db.close(); }
  for(const {part,live} of parts)if(part!=="data"&&existsSync(live))await cp(live,join(destination,part),{recursive:true});
  const snapshot: Snapshot = {version:2,id,seriesId,createdAt:new Date().toISOString(),files:await inventory(destination)};
  await writeFile(join(destination,"snapshot.json"),JSON.stringify(snapshot,null,2));
  return snapshot;
}
export async function listBackups(seriesId: string, root = process.cwd()) {
  SeriesId.parse(seriesId);
  const dir = resolve(root,"data/backups",seriesId);
  if(!existsSync(dir))return [];
  containedPath(root,dir);
  const snapshots: Snapshot[]=[];
  for (const entry of await readdir(dir,{withFileTypes:true})) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    try { snapshots.push(JSON.parse(await readFile(containedPath(dir,join(dir,entry.name,"snapshot.json")),"utf8"))); } catch (caughtError) { log.warn("[backup] "+String(caughtError)); }
  }
  return snapshots.map(({id,createdAt,files})=>({id,createdAt,fileCount:files.length}));
}
export async function restoreProject(seriesId: string, id: string, root = process.cwd()) {
  SeriesId.parse(seriesId);
  if(!/^[a-f0-9-]{36}$/.test(id))throw new WorkflowError("INVALID_BACKUP_ID", "INVALID_BACKUP_ID", "failed");
  const snapshotDir=containedPath(root,resolve(root,"data/backups",seriesId,id));
  const snapshot:Snapshot=JSON.parse(await readFile(join(snapshotDir,"snapshot.json"),"utf8"));
  if(![1,2].includes(snapshot.version)||snapshot.seriesId!==seriesId||snapshot.id!==id)throw new WorkflowError("INVALID_BACKUP", "INVALID_BACKUP", "failed");
  for(const file of snapshot.files){
    if(await digest(containedPath(snapshotDir,join(snapshotDir,file.path)))!==file.sha256)throw new WorkflowError("BACKUP_CHECKSUM_MISMATCH", "BACKUP_CHECKSUM_MISMATCH", "failed");
  }
  const db=new DatabaseSync(join(snapshotDir,"data/story_bible.db"),{readOnly:true});
  try { if(Object.values(db.prepare("PRAGMA integrity_check").get()!)[0]!=="ok")throw new WorkflowError("BACKUP_DATABASE_INVALID", "BACKUP_DATABASE_INVALID", "failed"); } finally {db.close();}
  const token=randomUUID(), moves:RestoreMove[]=[];
  for(const {part,live} of projectParts(seriesId,root,snapshot.version)){
    const staged=live+".restore-"+token, previous=live+".before-restore-"+token;
    if(existsSync(join(snapshotDir,part)))await cp(join(snapshotDir,part),staged,{recursive:true});else await mkdir(staged,{recursive:true});
    moves.push({live,staged,previous,hadPrevious:existsSync(live),installed:false});
  }
  const journalDir=resolve(root,'data/maintenance');await mkdir(journalDir,{recursive:true});
  const journalPath=containedPath(root,join(journalDir,seriesId+'.restore.json'));
  const journal:RestoreJournal={version:1,seriesId,pid:process.pid,state:'installing',moves};
  await saveJournal(journalPath,journal);
  try {
    for(const move of moves){if(move.hadPrevious)await rename(move.live,move.previous);await rename(move.staged,move.live);move.installed=true;await saveJournal(journalPath,journal);}
    journal.state='committed';await saveJournal(journalPath,journal);await rm(journalPath);
  }catch(error){
    for(const move of [...moves].reverse()){
      if(move.installed)await rename(move.live,move.staged);
      if(existsSync(move.previous))await rename(move.previous,move.live);
    }
    await rm(journalPath,{force:true});throw error;
  }
  return {restored:id,previousDirectories:moves.filter(m=>m.hadPrevious).map(m=>m.previous)};
}
export async function projectUsage(seriesId:string,root=process.cwd()){
  SeriesId.parse(seriesId); let bytes=0,files=0;
  for(const {live:dir} of projectParts(seriesId,root,2)){if(!existsSync(dir))continue;
    const walk=async(path:string)=>{for(const item of await readdir(path,{withFileTypes:true})){if(item.isSymbolicLink())continue;const full=join(path,item.name);if(item.isDirectory())await walk(full);else{bytes+=(await stat(full)).size;files++;}}};await walk(dir);
  }return {bytes,files};
}

export function createProjectMaintenance(root: string): import('../../ports/project-maintenance.js').ProjectMaintenance {
 return { backup: seriesId => backupProject(seriesId, root), restore: (seriesId, id) => restoreProject(seriesId, id, root), list: seriesId => listBackups(seriesId, root), usage: seriesId => projectUsage(seriesId, root) };
}
