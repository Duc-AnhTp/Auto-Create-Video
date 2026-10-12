export type FailureDisposition="failed"|"needs_review"|"cancelled"|"lease_lost";
export class WorkflowError extends Error {
 constructor(readonly code:string,message=code,readonly disposition:FailureDisposition="failed",options?:ErrorOptions){super(message,options);this.name="WorkflowError";}
}
export function errorCode(error:unknown):string|undefined {if(error&&typeof error==="object"&&"code" in error&&typeof error.code==="string")return error.code;return undefined;}
export function failureDisposition(error:unknown):FailureDisposition {
 const ownershipCode=errorCode(error);
 if(ownershipCode==='WORKER_STOPPING'||isOwnershipError(error))return 'lease_lost';
 if(error instanceof WorkflowError)return error.disposition;
 const code=errorCode(error);if(!code)return "failed";
 if(code==="WORKER_STOPPING"||code==="WORKER_LEASE_LOST")return "lease_lost";
 if(code==="JOB_CANCELLED")return "cancelled";
 return reviewCodes.has(code)?"needs_review":"failed";
}
const reviewCodes=new Set(["BUDGET_EXCEEDED","PROVIDER_SUBMIT_UNCERTAIN","UNCERTAIN_TIMEOUT","CANON_APPROVAL_REQUIRED","QA_REVIEW_REQUIRED","QA_UNAVAILABLE","CONTINUITY_FAILED","FAILOVER_PROVIDER_UNAVAILABLE","REFERENCE_PROVENANCE_REQUIRED"]);

export function errorMessage(error:unknown):string {return error instanceof Error?error.message:String(error);}
export function isOwnershipError(error:unknown):boolean {return ['WORKER_LEASE_LOST','WORKER_LOCK_CONFLICT','JOB_LEASE_LOST'].includes(errorCode(error)??'');}
