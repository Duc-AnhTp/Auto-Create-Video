import type { Config,TtsProvider } from "../../../contracts/config.js";
import type { TtsClient } from "../../../contracts/tts.js";
import type { Script } from "../../media/index.js";
export interface NewsDependencies {cfg:Config;templateDir:string;sfxDir:string;createTtsClient:(cfg:Config,options?:{speed?:number})=>TtsClient;startReviewServer:(options:{scriptPath:string;initialScript:Script})=>Promise<Script>;validateTtsProvider:(cfg:Config,provider:TtsProvider,options?:{requireVoiceId?:boolean})=>void}
