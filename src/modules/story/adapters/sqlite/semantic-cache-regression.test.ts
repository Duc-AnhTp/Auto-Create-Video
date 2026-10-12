import { describe,it,expect } from 'vitest';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStoryStore } from "../../../../bootstrap/sqlite-story-store.js";
import { SemanticMemoryEngine } from "../../application/semantic-memory.js";

describe('persistent semantic scope',()=>{
  it('keeps legacy unassigned characters and excludes another explicit series',()=>{
    const bible=new SqliteStoryStore(':memory:');try {
      bible.upsertSeriesMetadata({id:'s',title:'Legacy'});
      bible.upsertCharacter({id:'legacy',name:'Legacy',status:'deceased'});
      bible.upsertCharacter({id:'default',series_id:'default-series',name:'Default'});
      bible.upsertCharacter({id:'foreign',series_id:'other',name:'Foreign'});
      expect(bible.listCharactersForEpisode('s',1).map(character=>character.id).sort()).toEqual(['default','legacy']);
      expect(bible.getNegativeConstraints(2,'s').some(rule=>rule.includes('Legacy'))).toBe(true);
    }finally{bible.close();}
  });
  it('restores character and prop state when querying a past episode',()=>{
    const bible=new SqliteStoryStore(':memory:');try {
      bible.upsertSeriesMetadata({id:'s',title:'History'});bible.upsertCharacter({id:'c',series_id:'s',name:'C',status:'alive'});bible.upsertKeyProp({id:'key',series_id:'s',name:'Key',status:'intact',current_holder_id:'c'});
      bible.applyNarrativeDelta(5,{characterStatusUpdates:[{id:'c',status:'deceased'}],propUpdates:[{propId:'key',newHolderId:'c',status:'destroyed'}]},{seriesId:'s'});
      expect(bible.listCharactersForEpisode('s',1)[0].status).toBe('alive');expect(bible.listKeyPropsForEpisode('s',1)[0].status).toBe('intact');
      expect(bible.getNegativeConstraints(2,'s').some(rule=>rule.includes('đã chết')||rule.includes('phá hủy'))).toBe(false);
      expect(bible.listCharactersForEpisode('s',5)[0].status).toBe('deceased');
    }finally{bible.close();}
  });
  it('reuses an index, invalidates canon changes and excludes future world knowledge',()=>{
    const root=mkdtempSync(join(tmpdir(),'semantic-cache-')),path=join(root,'bible.db');let bible=new SqliteStoryStore(path);
    try {
      bible.upsertSeriesMetadata({id:'s',title:'Scope'});bible.upsertCharacter({id:'c',series_id:'s',name:'C',visual_summary:'chiếc chìa khóa'});bible.setWorldState('mandatory_rule','Không hồi sinh',0,'s');bible.setWorldState('future_secret','Kẻ phản bội là C',5,'s');
      const first=new SemanticMemoryEngine();first.indexStoryBible(bible,'s',1);const expected=first.queryRelevant('chìa khóa',{minSimilarity:0,topK:25,currentEpisode:1}).map(item=>item.id);expect(expected).not.toContain('rule_future_secret');
      const revision=bible.getRevision();bible.close();bible=new SqliteStoryStore(path);const restored=new SemanticMemoryEngine();restored.indexStoryBible(bible,'s',1);expect(restored.cacheHits).toBe(1);expect(restored.queryRelevant('chìa khóa',{minSimilarity:0,topK:25,currentEpisode:1}).map(item=>item.id)).toEqual(expected);
      const pruned=restored.pruneContextForEpisode('chìa khóa',bible.listCharacters('s'),[],[],0,{currentEpisode:1});expect(pruned.relevantRules.some(rule=>rule.includes('mandatory_rule'))).toBe(true);expect(pruned.relevantRules.some(rule=>rule.includes('future_secret'))).toBe(false);
      bible.upsertCharacter({id:'c',series_id:'s',name:'C',visual_summary:'chiếc la bàn'});expect(bible.getRevision()).toBeGreaterThan(revision);const changed=new SemanticMemoryEngine();changed.indexStoryBible(bible,'s',1);expect(changed.cacheHits).toBe(0);
      const future=new SemanticMemoryEngine();future.indexStoryBible(bible,'s',5);expect(future.queryRelevant('phản bội',{minSimilarity:0,topK:25,currentEpisode:5}).some(item=>item.id==='rule_future_secret')).toBe(true);
    }finally{bible.close();rmSync(root,{recursive:true,force:true});}
  });
});
