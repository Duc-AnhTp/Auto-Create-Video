import {redact} from './redact.js';
const ts = () => new Date().toISOString().replace("T", " ").substring(0, 19);

export const log = {
  event: (event:string,fields:Record<string,string|number|boolean|null|undefined>)=>{
    const allowed=new Set(['jobId','seriesId','attemptId','generationId','code','state','leaseVersion','costSource','provider']);
    console.log(redact(JSON.stringify({timestamp:new Date().toISOString(),event,...Object.fromEntries(Object.entries(fields).filter(([key])=>allowed.has(key)))})));
  },
  step: (n: number, total: number, msg: string) =>
    console.log(`[${ts()}] [${n}/${total}] ${msg}`),
  info: (msg: string) => console.log(`[${ts()}] ${redact(msg)}`),
  warn: (msg: string) => console.warn(`[${ts()}] WARN ${redact(msg)}`),
  error: (msg: string, err?: unknown) => {
    console.error(`[${ts()}] ERROR ${redact(msg)}`);
    if (err instanceof Error) console.error(redact(err.stack??err.message));
    else if (err) console.error(redact(String(err)));
  },
};
