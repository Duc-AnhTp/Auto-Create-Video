import { describe, expect, it } from "vitest";
import { applicationError } from "../apps/http/application-error.js";
import { WorkflowError, failureDisposition } from "./workflow-error.js";

describe("structured workflow failures", () => {
  it('maps ownership codes to lease loss even when a producer used the default disposition',()=>{expect(failureDisposition(new WorkflowError('JOB_LEASE_LOST','lost'))).toBe('lease_lost');expect(failureDisposition({code:'WORKER_LOCK_CONFLICT'})).toBe('lease_lost');});
  it("maps a conflict by code even when its message is translated", () => {
    const failure = applicationError(new WorkflowError("DRAFT_CONFLICT", "Bản nháp đã được thay đổi"));
    expect(failure.status).toBe(409);
    expect(failure.error.code).toBe("DRAFT_CONFLICT");
  });

  it("does not classify an unrelated message as a budget or QA failure", () => {
    expect(failureDisposition(new Error("Could not write the budget QA log"))).toBe("failed");
    expect(applicationError(new Error("BUSY status display failed")).status).toBe(500);
  });

  it("preserves uncertainty and lease loss independently of the message", () => {
    expect(failureDisposition({ code: "PROVIDER_SUBMIT_UNCERTAIN", message: "remote response lost" })).toBe("needs_review");
    expect(failureDisposition(new WorkflowError("WORKER_LEASE_LOST", "Quyền sở hữu đã chuyển", "lease_lost"))).toBe("lease_lost");
  });
  it('preserves a typed business code when mapping a bad request',()=>{expect(applicationError(new WorkflowError('MASTER_ARTIFACT_REQUIRED','Master required'))).toMatchObject({status:400,error:{code:'MASTER_ARTIFACT_REQUIRED'}});});
});
