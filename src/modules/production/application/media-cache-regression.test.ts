import { describe,it,expect } from 'vitest';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EpisodeRuntime } from "../../../bootstrap/episode-runtime.js";
import { measureRuntime } from "../../../platform/observability/runtime-metrics.js";

describe('episode dependency cache',()=>{
  it('complete resume performs no submit or encode; dialogue edits keep video attempts',async()=>{
    const root=await mkdtemp(join(tmpdir(),'episode-cache-')),pipeline=new EpisodeRuntime(join(root,'bible.db'));
    const source='TẬP 1: CACHE\nLogline: Bình minh.\nCẢNH 1: CÔNG VIÊN - NGÀY\nCÚ MÁY 1 (establishing, 2s): Mặt trời mọc.';
    const options={seriesId:'cache-offline',provider:'mock' as const,outputDir:join(root,'episode'),mockTts:true,dryRun:true,skipAudit:true,cinematicDirecting:false,exportResolution:'720p' as const};
    try {
      await pipeline.produceEpisode(source,options);
      const attempts=pipeline.getBible().listProviderJobs('cache-offline').length;
      const resumed=await measureRuntime(()=>pipeline.produceEpisode(source,{...options,resume:true}));
      expect(resumed.metrics.counters.providerSubmit??0).toBe(0);expect(resumed.metrics.counters.encode??0).toBe(0);
      await expect(pipeline.produceEpisode(source+'\nNGƯỜI KỂ: Ngày mới bắt đầu.',{...options,resume:true})).rejects.toMatchObject({code:'AUDIO_RESUME_REVIEW_REQUIRED'});
      await pipeline.produceEpisode(source+'\nNGƯỜI KỂ: Ngày mới bắt đầu.',{...options,resume:true,regenerateAudio:true});
      expect(pipeline.getBible().listProviderJobs('cache-offline')).toHaveLength(attempts);
    } finally {pipeline.close();await rm(root,{recursive:true,force:true});}
  },120_000);
});
