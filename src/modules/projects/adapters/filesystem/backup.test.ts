import {describe,it,expect} from "vitest";
import {mkdtemp,mkdir,writeFile,readFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import { SqliteStoryStore } from "../../../../bootstrap/sqlite-story-store.js";
import {backupProject,restoreProject,projectUsage} from "./backup.js";

describe("project backup registered roots",()=>{
  it("snapshots SQLite, references and both output layouts, then restores verified bytes",async()=>{
    const root=await mkdtemp(join(tmpdir(),"backup-roots-")),paths=["data/series/s","output/series/s","output/s","assets/characters/s","assets/locations/s"];
    try{
      for(const path of paths){await mkdir(join(root,path),{recursive:true});await writeFile(join(root,path,"fixture.txt"),"original");}
      const bible=new SqliteStoryStore(join(root,paths[0],"story_bible.db"));bible.upsertSeriesMetadata({id:"s",title:"Snapshot"});bible.close();
      const snapshot=await backupProject("s",root);expect(snapshot.version).toBe(2);expect(snapshot.files.some(file=>file.path.startsWith("characters"))).toBe(true);
      for(const path of paths)await writeFile(join(root,path,"fixture.txt"),"changed");
      const result=await restoreProject("s",snapshot.id,root);expect(result.previousDirectories).toHaveLength(5);
      for(const path of paths)expect(await readFile(join(root,path,"fixture.txt"),"utf8")).toBe("original");
      expect((await projectUsage("s",root)).files).toBeGreaterThanOrEqual(6);
      await writeFile(join(root,"data/backups/s",snapshot.id,"characters/fixture.txt"),"corrupt");await expect(restoreProject("s",snapshot.id,root)).rejects.toThrow("BACKUP_CHECKSUM_MISMATCH");
      expect(await readFile(join(root,paths[0],"fixture.txt"),"utf8")).toBe("original");
    }finally{await rm(root,{recursive:true,force:true});}
  });
});
