import { ZodError } from "zod";
import { HttpError } from "../../platform/errors.js";
import { errorCode } from "../../platform/workflow-error.js";
import { redact } from "../../platform/observability/redact.js";
const notFound=new Set(["TIMELINE_REQUIRED","TAKE_NOT_FOUND","SERIES_NOT_FOUND","JOB_NOT_FOUND","STORY_IMPORT_NOT_FOUND","ARTIFACT_NOT_FOUND","ATTEMPT_NOT_FOUND"]);
const conflicts=new Set(["PROJECT_BUSY","APPROVED_PLAN_REQUIRED","TAKE_VERSION_CONFLICT","MEDIA_MODE_MISMATCH","INPUT_MEDIA_REQUIRED","SPATIAL_FOLEY_DELIVERY_UNAVAILABLE","SERIES_BUSY","EPISODE_BUSY","INVALID_JOB_TRANSITION","DRAFT_CONFLICT","DISPATCH_ID_CONFLICT","REMOTE_ID_CONFLICT","WORKER_LOCK_CONFLICT","SQLITE_BUSY","LIFECYCLE_TRANSITION","WORKER_LOCK_CONFLICT"]);
const badRequest=new Set(["MASTER_ARTIFACT_REQUIRED"]);
export function applicationError(error:unknown){const code=errorCode(error);const status=error instanceof HttpError?error.status:error instanceof ZodError?400:code&&badRequest.has(code)?400:code&&notFound.has(code)?404:code&&conflicts.has(code)?409:500;
 return {status,error:{code:error instanceof HttpError?error.code:error instanceof ZodError?"INVALID_REQUEST":code??"INTERNAL_ERROR",message:redact(error instanceof Error?error.message:String(error))}};
}
