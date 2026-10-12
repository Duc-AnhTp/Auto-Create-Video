import {writeSync} from 'node:fs';
import {join} from 'node:path';
import {ProviderDispatchStore} from '../modules/production/adapters/sqlite/provider-dispatch-store.js';
import {reconcileProviderAttempts} from '../bootstrap/provider-recovery.js';
import '../platform/processes/media-runtime.js';
import {FileAudioGenerationStore} from '../modules/production/adapters/filesystem/audio-generation-store.js';
import {createValidMockMp3File} from '../modules/media/adapters/assets/mock-media-generator.js';
import {EpisodicScriptSchema} from '../contracts/episode.js';
import {createTimelineFixture} from './timeline-fixture.js';
const [mode,root]=process.argv.slice(2);
const store=new ProviderDispatchStore(join(root,'queue.db'));
function barrier():never {
 writeSync(1,'READY\n');
 // The parent kills this process at a precise boundary, without a timed race.
 Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
 throw new Error('Unexpected barrier release');
}
if(mode==='maintenance'){store.seriesCoordinator.beginMaintenance('series');barrier();}
else if(mode==='invoice'){
 store.acknowledgeInvoice=()=>barrier();
 await reconcileProviderAttempts(store,'crash-child');
 throw new Error('Invoice barrier not reached');
}else if(mode==='generation'){
 const generations=new FileAudioGenerationStore(),directory=await generations.prepare(root),audioPath=join(directory,'audio.mp3');
 await createValidMockMp3File(audioPath,3);
 const script=EpisodicScriptSchema.parse({seriesId:'series',episodeNumber:1,title:'Crash',logline:'Crash',scenes:[{sceneNumber:1,locationId:'room',locationName:'Room',shots:[{shotId:'s',durationSec:3,visualPrompt:'Room',dialogues:[]}]}]});
 const timeline=createTimelineFixture({seriesId:'series',targetTotalDurationSec:3,targetTotalFrames:72,videoTrack:[{shotId:'s',sceneId:'room',startSec:0,endSec:3,durationSec:3,startFrame:0,endFrame:72,durationFrames:72,visualPrompt:'Room',shotType:'medium',trimStartSec:0}]});
 await generations.commit({directory,audioPath,timeline,script,fingerprint:'fingerprint',mockTts:true,fps:24});
 barrier(); // All assets are staged; the checkpoint has not committed them.
}else throw new Error('Unknown crash mode');
