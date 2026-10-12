import {CosyVoiceClient} from '../modules/media/adapters/tts/cosyvoice-client.js';
import {ElevenLabsClient} from '../modules/media/adapters/tts/elevenlabs-client.js';
import {F5TtsClient} from '../modules/media/adapters/tts/f5tts-client.js';
import { EpisodeAudioAssembler } from "../modules/media/application/audio-assembler.js";
import { createDialogueTts } from "./episode-tts.js";
import { loadConfig } from "./config.js";
import { type Config } from "../contracts/config.js";
import type { FoleyGenerator } from "../modules/media/ports/foley.js";
import {hashFileOrString} from '../modules/production/adapters/filesystem/spec-fingerprint.js';
/** Owns only dependencies it creates; injected providers are used directly. */
export class AudioAssembler extends EpisodeAudioAssembler {
    constructor(options: {
        cfg?: Config;
        sfxDir?: string;
        bgmDir?: string;
        ambienceDir?: string;
        foleyGenerator?: FoleyGenerator;
        createTts?: ConstructorParameters<typeof EpisodeAudioAssembler>[0]["createTts"];
    } = {}) {
        const cfg = options.cfg ?? loadConfig({ validateProvider: false });
        super({ ...options, cfg, hashReference:hashFileOrString, resolveActingInstruction:(text,provider,explicit)=>explicit??(provider==='cosyvoice'?CosyVoiceClient.extractInlineEmotion(text).inlineEmotion:undefined), normalizeTtsText:(text,provider)=>provider==='elevenlabs'?ElevenLabsClient.cleanDialogueText(text):provider==='f5tts'?F5TtsClient.cleanDialogueText(text):provider==='cosyvoice'?CosyVoiceClient.extractInlineEmotion(text).cleanText:text, createTts: options.createTts ?? ((provider, voiceId, mockTts) => createDialogueTts(cfg, provider, voiceId, mockTts)) });
    }
}
