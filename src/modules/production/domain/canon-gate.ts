export interface CanonEvidence {
  mockMedia: boolean; mockAudio: boolean; mockVisualQa: boolean;
  auditPassed: boolean; faceWarnings: number; faceFailures: number; faceUnavailable: number;
  unapprovedShots: number; beatCoveragePassed: boolean; billingUncertain: boolean; budgetExceeded: boolean;
}
export type CanonBlockReason = 'MOCK_PROVENANCE'|'QA_GATE_FAILED'|'TAKE_APPROVAL_REQUIRED'|'BEAT_COVERAGE_FAILED'|'BILLING_RECONCILIATION_REQUIRED';
export function evaluateCanonGate(evidence: CanonEvidence): CanonBlockReason[] {
 const reasons:CanonBlockReason[]=[];
 if(evidence.mockMedia||evidence.mockAudio||evidence.mockVisualQa)reasons.push('MOCK_PROVENANCE');
 if(!evidence.auditPassed||evidence.faceWarnings>0||evidence.faceFailures>0||evidence.faceUnavailable>0)reasons.push('QA_GATE_FAILED');
 if(evidence.unapprovedShots>0)reasons.push('TAKE_APPROVAL_REQUIRED');
 if(!evidence.beatCoveragePassed)reasons.push('BEAT_COVERAGE_FAILED');
 if(evidence.billingUncertain||evidence.budgetExceeded)reasons.push('BILLING_RECONCILIATION_REQUIRED');
 return reasons;
}
