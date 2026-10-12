import { runMediaCommand, type MediaCommandOptions } from "../../../platform/processes/media-process-runner.js";
export function runFfmpeg(args:string[],options:MediaCommandOptions={}):Promise<string>{return runMediaCommand("ffmpeg",args,options);}
export function runFfprobe(args:string[],options:MediaCommandOptions={}):Promise<string>{return runMediaCommand("ffprobe",args,options);}
export async function isFfmpegAvailable():Promise<boolean>{try{await runFfmpeg(["-version"],{timeoutMs:5000});return true;}catch{return false;}}
