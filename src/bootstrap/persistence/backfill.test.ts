import { describe,it,expect } from 'vitest';
import { mkdtempSync,readdirSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteStoryStore } from "../sqlite-story-store.js";

describe('v9 production migration',()=>{
  it('snapshots consistently, marks legacy references unknown and preserves paid amounts',()=>{
    const root=mkdtempSync(join(tmpdir(),'production-migration-')),path=join(root,'bible.db'),image=join(root,'legacy.png');
    let bible=new SqliteStoryStore(path);bible.upsertSeriesMetadata({id:'legacy',title:'Legacy'});bible.upsertCharacter({id:'c',series_id:'legacy',name:'C',face_reference_image:image,face_embedding_json:'[0.1,0.2]'});
    bible.createOrUpdateProviderJob({id:'paid',series_id:'legacy',episode_number:1,shot_id:'shot',provider:'api_kling',spec_hash:'legacy',status:'completed',cost_category:'confirmed',estimated_cost_usd:1,reserved_cost_usd:0,confirmed_cost_usd:0.7,uncertain_cost_usd:0,attempt_count:1,max_attempts:1,is_retryable:false});bible.close();
    const db=new DatabaseSync(path);db.exec('DELETE FROM canon_migrations WHERE version>9; DELETE FROM production_references; DELETE FROM provider_attempt_groups;');db.close();
    try{bible=new SqliteStoryStore(path);expect(bible.getAppliedMigrations().at(-1)?.version).toBe(13);expect(bible.getReference(resolve(image))?.mode).toBe('unknown');expect(bible.getReference(resolve(image))?.embeddingSource).toBe('unknown');expect(bible.getProviderJob('paid')?.confirmed_cost_usd).toBe(0.7);expect(bible.listGroups()[0].primaryId).toBe('paid');expect(readdirSync(root).some(name=>name.includes('.pre-v13-'))).toBe(true);bible.close();bible=new SqliteStoryStore(path);expect(bible.getAppliedMigrations().at(-1)?.version).toBe(13);}finally{bible.close();rmSync(root,{recursive:true,force:true});}
  });
  it('a newer schema is rejected without resetting its version',()=>{
    const root=mkdtempSync(join(tmpdir(),'future-schema-')),path=join(root,'bible.db'),bible=new SqliteStoryStore(path);bible.close();
    const db=new DatabaseSync(path);db.prepare('INSERT INTO canon_migrations VALUES(?,?,?)').run(99,'future','2026-01-01');db.close();
    try{expect(()=>new SqliteStoryStore(path)).toThrow('UNSUPPORTED_BIBLE_SCHEMA');const verify=new DatabaseSync(path);expect(verify.prepare('SELECT MAX(version) AS version FROM canon_migrations').get()?.version).toBe(99);verify.close();}finally{rmSync(root,{recursive:true,force:true});}
  });
});
