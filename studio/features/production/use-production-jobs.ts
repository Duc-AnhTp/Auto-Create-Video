import {useEffect,useState} from "react";
import type {StudioJob} from "../../../src/contracts/studio.js";
import {request} from "../../shared/api/client.js";
import {subscribeJobs} from "../../shared/api/job-events.js";
export function useProductionJobs(options:{seriesId:string;episode:number;scopeKey:string;active:()=>boolean;onError:(message:string)=>void}){
 const [jobs,setJobs]=useState<StudioJob[]>([]);
 useEffect(()=>{const dispose=subscribeJobs({...options,onSnapshot:setJobs,onJob:job=>setJobs(old=>[job,...old.filter(j=>j.id!==job.id)].slice(0,200))});
 void request<{jobs:StudioJob[]}>("/api/v1/jobs").then(result=>{if(options.active())setJobs(result.jobs.filter(job=>job.request.seriesId===options.seriesId&&job.request.episodeNumber===options.episode));}).catch(error=>{if(options.active())options.onError(error instanceof Error?error.message:String(error));});return dispose;},[options.scopeKey]);
 return jobs;
}
