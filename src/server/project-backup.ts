import { DatabaseSync } from "node:sqlite";
import { cp, mkdir, readdir, rename, writeFile, readFile, stat } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { SeriesId } from "./studio-contract.js";
import { containedPath } from "./http-safety.js";

interface Snapshot { version: 1; id: string; seriesId: string; createdAt: string; files: { path: string; sha256: string }[]; }
async function digest(path:string) { const hash=createHash("sha256"); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest("hex"); }
async function inventory(dir: string, prefix = ""): Promise<Snapshot["files"]> {
  const files: Snapshot["files"] = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw new Error("BACKUP_SYMLINK_UNSUPPORTED");
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
  if (!existsSync(join(data,"story_bible.db"))) throw new Error("PROJECT_NOT_FOUND");
  // Enumerate first to reject links outside the project before copying.
  await inventory(data); if (existsSync(output)) await inventory(output);
  const id = randomUUID(), destination = resolve(root,"data/backups",seriesId,id);
  await mkdir(join(destination,"data"),{recursive:true});
  await cp(data,join(destination,"data"),{recursive:true,filter: source=>!/[\\/]story_bible\.db(?:-wal|-shm)?$/.test(source)});
  const db = new DatabaseSync(join(data,"story_bible.db"));
  try { db.exec("VACUUM INTO '"+join(destination,"data/story_bible.db").replace(/'/g,"''")+"'"); } finally { db.close(); }
  if (existsSync(output)) await cp(output,join(destination,"output"),{recursive:true});
  const snapshot: Snapshot = {version:1,id,seriesId,createdAt:new Date().toISOString(),files:await inventory(destination)};
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
    try { snapshots.push(JSON.parse(await readFile(containedPath(dir,join(dir,entry.name,"snapshot.json")),"utf8"))); } catch { /* Incomplete snapshots are not restorable. */ }
  }
  return snapshots.map(({id,createdAt,files})=>({id,createdAt,fileCount:files.length}));
}
export async function restoreProject(seriesId: string, id: string, root = process.cwd()) {
  SeriesId.parse(seriesId);
  if(!/^[a-f0-9-]{36}$/.test(id))throw new Error("INVALID_BACKUP_ID");
  const snapshotDir=containedPath(root,resolve(root,"data/backups",seriesId,id));
  const snapshot:Snapshot=JSON.parse(await readFile(join(snapshotDir,"snapshot.json"),"utf8"));
  if(snapshot.version!==1||snapshot.seriesId!==seriesId||snapshot.id!==id)throw new Error("INVALID_BACKUP");
  for(const file of snapshot.files){
    if(await digest(containedPath(snapshotDir,join(snapshotDir,file.path)))!==file.sha256)throw new Error("BACKUP_CHECKSUM_MISMATCH");
  }
  const db=new DatabaseSync(join(snapshotDir,"data/story_bible.db"),{readOnly:true});
  try { if(Object.values(db.prepare("PRAGMA integrity_check").get()!)[0]!=="ok")throw new Error("BACKUP_DATABASE_INVALID"); } finally {db.close();}
  const token=randomUUID(), moves:{live:string;staged:string;previous:string;hadPrevious:boolean;installed:boolean}[]=[];
  for(const [part,base] of [["data","data/series"],["output","output/series"]]){
    const live=containedPath(root,resolve(root,base,seriesId));
    const staged=live+".restore-"+token, previous=live+".before-restore-"+token;
    if(existsSync(join(snapshotDir,part)))await cp(join(snapshotDir,part),staged,{recursive:true});else await mkdir(staged,{recursive:true});
    moves.push({live,staged,previous,hadPrevious:existsSync(live),installed:false});
  }
  try {
    for(const move of moves){if(move.hadPrevious)await rename(move.live,move.previous);await rename(move.staged,move.live);move.installed=true;}
  }catch(error){
    for(const move of [...moves].reverse()){
      if(move.installed)await rename(move.live,move.staged);
      if(existsSync(move.previous))await rename(move.previous,move.live);
    }
    throw error;
  }
  return {restored:id,previousDirectories:moves.filter(m=>m.hadPrevious).map(m=>m.previous)};
}
export async function projectUsage(seriesId:string,root=process.cwd()){
  SeriesId.parse(seriesId); let bytes=0,files=0;
  for(const base of ["data/series","output/series"]){const dir=containedPath(root,resolve(root,base,seriesId));if(!existsSync(dir))continue;
    const walk=async(path:string)=>{for(const item of await readdir(path,{withFileTypes:true})){if(item.isSymbolicLink())continue;const full=join(path,item.name);if(item.isDirectory())await walk(full);else{bytes+=(await stat(full)).size;files++;}}};await walk(dir);
  }return {bytes,files};
}
