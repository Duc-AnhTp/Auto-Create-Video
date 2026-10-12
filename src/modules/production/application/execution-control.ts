import type {ExecutionContext} from '../../../contracts/execution.js';
import {WorkflowError, failureDisposition, isOwnershipError} from '../../../platform/workflow-error.js';
export async function checkExecution(context:ExecutionContext):Promise<void>{
 context.assertOwnership?.();
 await context.checkpoint?.();
 if(context.signal?.aborted)throw new WorkflowError('JOB_CANCELLED','Execution cancelled','cancelled');
}

/** Failure handling must not publish a checkpoint after ownership or control has changed. */
export function guardFailureStateWrite(context: ExecutionContext, error: unknown): void {
 context.assertOwnership?.();
 if (isOwnershipError(error) || ['lease_lost', 'cancelled'].includes(failureDisposition(error))) throw error;
 if (context.signal?.aborted) throw new WorkflowError('JOB_CANCELLED', 'Execution cancelled', 'cancelled', { cause: error });
}
