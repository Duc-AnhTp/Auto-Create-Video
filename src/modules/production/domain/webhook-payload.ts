import type {VideoJobStatus} from '../../../contracts/video.js';
export function normalizeWebhookPayload(payload:unknown):VideoJobStatus|null {
  const record=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
  const root=record(payload),data=record(root.data),result=record(root.task_result??data.task_result),content=record(root.content);
  const jobId=root.task_id??root.id??root.job_id??root.jobId??data.task_id??data.id??root.name;
  if(typeof jobId!=="string"||!jobId)return null;
  const rawState=root.task_status??root.status??data.task_status??data.status??root.state??"";if(typeof rawState!=="string")return null;
  const state=rawState.toUpperCase(),failed=["FAILED","ERROR","CANCELLED","CANCELED"].includes(state)||Boolean(root.error);
  const completed=!failed&&(["SUCCEED","SUCCEEDED","COMPLETED","SUCCESS","DONE"].includes(state)||root.done===true);
  if(!failed&&!completed)return null;
  const videos=Array.isArray(result.videos)?result.videos:Array.isArray(root.videos)?root.videos:[];
  const first=videos[0],output=Array.isArray(root.output)?root.output[0]:undefined;
  const url=root.video_url??root.url??root.videoUrl??record(first).url??(typeof first==="string"?first:undefined)??data.video_url??content.video_url??output;
  if(completed&&typeof url!=="string")return null;
  const invoice=root.invoiced_cost_usd??root.invoiced_cost??result.invoiced_cost_usd??(root.isConfirmedInvoice===true?root.cost_usd:undefined);
  const cost=typeof invoice==="number"||typeof invoice==="string"&&invoice.trim()?Number(invoice):NaN;
  return {jobId,status:failed?"failed":"completed",videoUrl:typeof url==="string"?url:undefined,error:failed?String(record(root.error).message??root.message??root.failure_reason??"Provider failed"):undefined,invoicedCostUsd:Number.isFinite(cost)&&cost>=0?cost:undefined,isConfirmedInvoice:Number.isFinite(cost)&&cost>=0};
}
