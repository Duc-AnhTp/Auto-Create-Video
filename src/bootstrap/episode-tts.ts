import type {Config,TtsProvider} from '../contracts/config.js';
import type {TtsClient} from '../contracts/tts.js';
import {createTtsClient} from './tts-client.js';
export function createDialogueTts(cfg:Config,provider:TtsProvider,voiceId:string,mockTts:boolean):TtsClient {
 return createTtsClient({...cfg,ttsProvider:provider,elevenlabsVoiceId:voiceId,lucylabVoiceId:voiceId,cosyvoiceVoiceId:voiceId},{mockTts});
}
