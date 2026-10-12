import "../src/platform/processes/media-runtime.js";
import { mkdir,writeFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { hostname,cpus } from 'node:os';
import { runFfmpeg,runFfprobe } from "../src/modules/media/adapters/ffmpeg.js";
import { HierarchicalAssembler,type HierarchicalAssemblerOptions } from "../src/modules/media/adapters/assembly/hierarchical-assembler.js";
import { measureRuntime,countRuntime } from "../src/platform/observability/runtime-metrics.js";
import { SqliteStoryStore } from "../src/bootstrap/sqlite-story-store.js";
import { SemanticMemoryEngine } from "../src/modules/story/application/semantic-memory.js";
import { PromptOptimizer } from "../src/modules/story/application/analysis/prompt-optimizer.js";
import { MicroScriptRepairer } from "../src/modules/story/application/analysis/micro-script-repairer.js";
import { probeVideoFile } from "../src/modules/media/adapters/media-validator.js";
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

process.env.OFFLINE_RUNTIME='1';
const destination=resolve('output/optimization-benchmark'),root=join(destination,new Date().toISOString().replace(/[:.]/g,'-')),runs=5;await mkdir(root,{recursive:true});
const records:Array<Record<string,unknown>>=[];
const validation:Array<Record<string,unknown>>=[],payloads:Array<Record<string,unknown>>=[];
const measure=async(dataset:string,variant:string,work:()=>Promise<unknown>)=>{const sample=await measureRuntime(work);if(variant==='resume'&&((sample.metrics.counters.encode??0)>0||(sample.metrics.counters.streamCopy??0)>0))throw new Error('BENCHMARK_RESUME_RENDERED');const synchronous=dataset.startsWith('context-')||dataset==='screenplay-20-scenes';records.push({dataset,variant,...sample.metrics,eventLoopLagP95Ms:synchronous?null:sample.metrics.eventLoopLagP95Ms,eventLoopLagStatus:synchronous?'unavailable_for_synchronous_sample':'measured',synchronousBlockingMs:synchronous?sample.metrics.elapsedMs:null});await writeFile(join(root,'samples.json'),JSON.stringify(records));return sample.value;};
for(const dataset of [{name:'vertical-45s',duration:45,width:72,height:128,episodes:1},{name:'horizontal-150s',duration:150,width:128,height:72,episodes:1},{name:'season-three-episodes',duration:45,width:128,height:72,episodes:3}]) {
  const directory=join(root,dataset.name);await mkdir(directory,{recursive:true});
  const clip=join(directory,'clip.mp4'),changed=join(directory,'changed.mp4');
  for(const [file,pattern] of [[clip,'testsrc2'],[changed,'testsrc']])await runFfmpeg(['-y','-f','lavfi','-i',`${pattern}=s=${dataset.width}x${dataset.height}:r=30`,'-t',String(dataset.duration),'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',file]);
  for(let repeat=0;repeat<runs;repeat++) {
    const bases:HierarchicalAssemblerOptions[]=Array.from({length:dataset.episodes},(_,ep)=>({seriesId:dataset.name,episodeNumber:ep+1,fps:30,width:dataset.width,height:dataset.height,aspectRatio:dataset.width<dataset.height?'9:16':'16:9',outputDir:join(directory,`run-${repeat}`,`ep-${ep+1}`),burnSubtitles:false,detectBlackFrames:false,allowMockMedia:false,scenes:[1,2].map(number=>({sceneNumber:number,sceneId:`scene-${number}`,shots:[{shotId:`shot-${number}`,sceneId:`scene-${number}`,takeId:'take-1',isApproved:true,sourceClipPath:clip,rawDurationSec:dataset.duration,trimEndSec:dataset.duration/2}]}))}));
    const assemble=async(options=bases)=>{for(const base of options){const manifest=await new HierarchicalAssembler(base).assemble(),probe=await probeVideoFile(manifest.masterOutputs.masterVideoPath);if(!probe.isValid||Math.abs(probe.durationSec-dataset.duration)>1/(base.fps??30))throw new Error('BENCHMARK_FRAME_DRIFT');}};
    await measure(dataset.name,'cold',()=>assemble());
    process.env.MEDIA_STREAM_COPY='0';
    try {await measure(dataset.name,'concat-encode-baseline',()=>assemble(bases.map(base=>({...base,outputDir:base.outputDir+'-encode-baseline'}))));}
    finally {delete process.env.MEDIA_STREAM_COPY;}
    await measure(dataset.name,'warm',()=>assemble());
    await measure(dataset.name,'resume',()=>assemble());
    await measure(dataset.name,'shot-edit',()=>assemble(bases.map(base=>({...base,scenes:base.scenes.map((scene,index)=>index===0?{...scene,shots:scene.shots.map(shot=>({...shot,sourceClipPath:changed,takeId:'take-2'}))}:scene)}))));
    await assemble();
    await measure(dataset.name,'dialogue-edit',()=>assemble(bases.map(base=>({...base,subtitleCues:[{subtitleId:'subtitle-new',speakerName:'Người kể',durationSec:1,dialogueId:'dialogue-new',shotId:'shot-1',displayText:'Lời thoại đã sửa',startSec:0,endSec:1,startFrame:0,endFrame:30}]}))));
    await measure(dataset.name,'render-options',()=>assemble(bases.map(base=>({...base,fps:24}))));
    // Compare compatible filters on the same source, encoder and target dimensions.
    const resize=`scale=${dataset.width*2}:${dataset.height*2}:flags=lanczos`,grade='eq=brightness=0.02:saturation=1.05';
    await measure(dataset.name,'filters-two-encodes',async()=>{for(const [input,filter,output] of [[clip,resize,join(directory,'resize.mp4')],[join(directory,'resize.mp4'),grade,join(directory,'grade.mp4')]])await runFfmpeg(['-y','-i',input,'-vf',filter,'-c:v','libx264','-preset','ultrafast','-crf','18',output]);});
    await measure(dataset.name,'filters-fused',()=>runFfmpeg(['-y','-i',clip,'-vf',resize+','+grade,'-c:v','libx264','-preset','ultrafast','-crf','18',join(directory,'fused.mp4')]));
    const fused=await probeVideoFile(join(directory,'fused.mp4')),separate=await probeVideoFile(join(directory,'grade.mp4'));
    if(!fused.isValid||!separate.isValid||Math.abs(fused.durationSec-dataset.duration)>1/30||Math.abs(separate.durationSec-dataset.duration)>1/30)throw new Error('BENCHMARK_FILTER_FRAME_DRIFT');
    const quality=await runFfmpeg(['-i',join(directory,'grade.mp4'),'-i',join(directory,'fused.mp4'),'-filter_complex','[0:v][1:v]ssim','-f','null','-'],{captureStderr:true,durationSec:dataset.duration});
    validation.push({dataset:dataset.name,repeat,duration:fused.durationSec,ssimBetweenOutputs:Number(quality.match(/All:([\d.]+)/)?.[1])||null});
  }
}
for(const size of [1000,10000]) {
  const bible=new SqliteStoryStore(join(root,`context-${size}.db`));bible.upsertSeriesMetadata({id:'context',title:'Fixed benchmark'});
  const source='Nhân vật tìm thấy chiếc chìa khóa trong phòng.';
  {
    for(let index=0;index<size-1;index++)bible.upsertCharacter({id:`entity-${index}`,series_id:'context',name:`Nhân vật ${index}`,visual_summary:`Công nghệ, chiếc chìa khóa ${index}, bí mật hành tinh`,status:'alive',role:'supporting'});
    bible.upsertSourceWork({id:'source',series_id:'context',title:'Fixture source',source_type:'novel',current_revision:1,content_hash:createHash('sha256').update(source).digest('hex'),raw_text:source,normalized_text:source});
    bible.upsertStoryBeat({id:'mandatory',series_id:'context',source_id:'source',beat_order:1,name:'Tìm chìa khóa',description:source,participating_characters_json:'["entity-0"]',is_flashback:false,is_mandatory:true,source_citations_json:JSON.stringify([{charStart:0,charEnd:source.length,excerpt:source}])});
    bible.setWorldState('mandatory_rule','Không hồi sinh',0,'context');bible.setWorldState('future_secret','Bí mật ở tập 99',99,'context');
  }
  try{for(let repeat=0;repeat<runs;repeat++){
    await measure(`context-${size}`,'full-index',async()=>{const engine=new SemanticMemoryEngine();engine.indexStoryBible(bible,'context',repeat+1);return engine.queryRelevant('Chiếc chìa khóa bí mật',{topK:25,currentEpisode:repeat+1});});
    const engine=new SemanticMemoryEngine();await measure(`context-${size}`,'cached-index',async()=>{engine.indexStoryBible(bible,'context',repeat+1);return engine.queryRelevant('Chiếc chìa khóa bí mật',{topK:25,currentEpisode:repeat+1});});
    const characters=bible.listCharacters('context'),raw=characters.map(character=>`${character.name}: ${character.visual_summary}`).join('\n');
    await measure(`context-${size}`,'pruning-off',async()=>{payloads.push({dataset:`context-${size}`,variant:'pruning-off',characters:characters.length,payloadCharacters:raw.length,estimatedTokens:PromptOptimizer.estimateTokens(raw)});});
    await measure(`context-${size}`,'pruning-on',async()=>{const pruned=engine.pruneContextForEpisode('Chiếc chìa khóa bí mật',characters,[],[],3000,{currentEpisode:repeat+1});
      if(!pruned.relevantRules.some(rule=>rule.includes('mandatory_rule'))||pruned.relevantRules.some(rule=>rule.includes('future_secret'))||!pruned.relevantBeats.some(beat=>beat.id==='mandatory'&&beat.source_citations_json===JSON.stringify([{charStart:0,charEnd:source.length,excerpt:source}])))throw new Error('BENCHMARK_CANON_COVERAGE_DRIFT');
      payloads.push({dataset:`context-${size}`,variant:'pruning-on',characters:pruned.relevantCharacters.length,estimatedTokens:pruned.estimatedTokens,mandatoryCanonRetained:true,sourceCitationRetained:true,futureKnowledgeExcluded:true});});
    const prompt={seriesMeta:bible.getSeriesMetadata('context'),dynamicUserPrompt:raw,episodeNumber:repeat+1};
    await measure(`context-${size}`,'prompt-cache-off',async()=>{payloads.push({dataset:`context-${size}`,variant:'prompt-cache-off',payloadCharacters:raw.length,cacheMarker:false,actualUsage:'unavailable'});});
    await measure(`context-${size}`,'prompt-cache-on',async()=>{const structured=PromptOptimizer.buildCacheablePromptStructure(prompt);payloads.push({dataset:`context-${size}`,variant:'prompt-cache-on',cacheMarker:structured.isCacheEligible,estimatedStaticTokens:structured.estimatedStaticTokens,estimatedDynamicTokens:structured.estimatedDynamicTokens,actualUsage:'unavailable'});});
  }}finally{bible.close();}
}
const script=Array.from({length:20},(_,index)=>`CẢNH ${index+1}: PHÒNG - NGÀY\nCÚ MÁY 1 (medium, 4s): Nhân vật bước vào phòng. ${'Ánh sáng xuyên qua cửa sổ. '.repeat(20)}`).join('\n');
for(let repeat=0;repeat<runs;repeat++){
  await measure('screenplay-20-scenes','repair-full',async()=>{countRuntime('llmMockRequest');payloads.push({dataset:'screenplay-20-scenes',variant:'repair-full',inputCharacters:script.length,outputCharacters:script.length,actualUsage:'unavailable'});});
  await measure('screenplay-20-scenes','micro-repair',()=>MicroScriptRepairer.executeSurgicalRepair(script,{sceneNumber:10,violationType:'fixture',violationMessage:'Thiếu cửa sổ',fixInstruction:'Giữ cửa sổ'},async(prompt,system)=>{countRuntime('llmMockRequest');const output=MicroScriptRepairer.extractSceneBlocks(script).find(scene=>scene.sceneNumber===10)!.rawContent;payloads.push({dataset:'screenplay-20-scenes',variant:'micro-repair',inputCharacters:prompt.length+system.length,outputCharacters:output.length,actualUsage:'unavailable'});return output;}));
}
const groups=new Map<string,typeof records>();for(const row of records){const key=`${row.dataset}/${row.variant}`;groups.set(key,[...groups.get(key)??[],row]);}
const summaries=[...groups].map(([key,rows])=>{const times=rows.map(row=>Number(row.elapsedMs)).sort((a,b)=>a-b);return {key,samples:rows.length,medianMs:times[Math.floor(times.length/2)],minMs:times[0],maxMs:times.at(-1),peakRssBytes:Math.max(...rows.map(row=>Number(row.peakRssBytes))),counters:rows.map(row=>row.counters)};});
const report={fixtureVersion:2,createdAt:new Date().toISOString(),root,node:process.version,ffmpeg:(await runFfmpeg(['-version'])).split('\n')[0],ffprobe:(await runFfprobe(['-version'])).split('\n')[0],sourceHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),host:hostname(),cpu:cpus()[0]?.model,dimensions:'72x128 vertical / 128x72 horizontal offline fixtures; not production 1080p/4K',rssScope:'Node process RSS; FFmpeg child RSS excluded',encodeCounterScope:'encode counts media output processes without stream copy; streamCopy includes video-copy/audio-encode mux',eventLoopLagScope:'Node histogram, 10ms resolution for async media work; synchronous context/repair samples report blocking duration and leave histogram p95 unavailable',runs,providerVerification:'unverified',tokenUsage:'unavailable',dollarSavings:null,summaries,records,validation,payloads};
await writeFile(join(root,'report.json'),JSON.stringify(report,null,2));await writeFile(join(destination,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({report:join(destination,'report.json'),measurements:records.length}));
